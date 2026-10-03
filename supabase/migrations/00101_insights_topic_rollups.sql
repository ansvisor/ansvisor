-- Topic-filtered Insights reads move onto the daily rollups.
--
-- Every Insights read that filters by topic still scanned raw prompt_results:
-- the rollups (00066) only carried the brand measures at brand grain, so
-- dailyWindow() sent any call with a topic to the raw RPCs. On the largest
-- topic (91 prompts, ~27k results) competitor_aggregates took 7.2s alone and
-- 11-15s next to the page's other reads — past the authenticated role's 8s
-- statement timeout. #861 kept the page up by running those reads under the
-- service role. Most of the cost is unpacking competitor_mentions jsonb.
--
-- The prompt-grain tables gain the measures the read functions need, and the
-- seven *_daily read functions take p_topic_id. With a topic they read the
-- prompt-grain tables, keyed through prompts.topic_id at read time, so a
-- prompt moved to another topic still takes its history along — the reason
-- topic filters stayed on the raw path. Without a topic they read exactly
-- what they read before: insights_brand_daily also counts results with no
-- prompt, which the prompt-grain tables leave out.
--
--   * insights_prompt_daily gains the brand measures insights_brand_daily
--     holds. The new columns are nullable with no default, so a row the
--     backfill has not rewritten yet reads as NULL, not as a plausible zero.
--     Topic reads must not be switched on until
--       select count(*) from insights_prompt_daily where max_created_at is null
--     returns 0 (backfill-insights-daily.js reports it).
--   * insights_competitor_prompt_measures_daily is new: the per-competitor
--     measures at prompt grain, dense like insights_competitor_daily — every
--     competitor in an answer's jsonb gets a row, sightings or not. A
--     sightings-only table cannot reproduce the comparison's per-competitor
--     answer count or its ordering, and drops competitors a topic's answers
--     list but never mention. insights_competitor_prompt_daily stays sparse:
--     its readers (00066, topics_overview_aggregates) treat a row's existence
--     as "visible".
--   * Both prompt-grain tables were indexed on (brand_id, day) only, so a
--     topic read would scan the whole brand's window and then filter. Each
--     gets (brand_id, prompt_id, day), and the reads resolve the topic's
--     prompts first, so cost follows the topic, not the brand.
--   * refresh_insights_daily takes a per-brand transaction lock. Delete +
--     insert is not safe against itself: two overlapping refreshes of the
--     same brand-day (a backfill chunk and a run stamping) each delete before
--     the other's insert commits, and the day's rows land twice.
--   * The position measures skip positions that are not positive. Positions
--     are 1-based by construction (response-parser.js), so for real data this
--     is the same set the raw RPCs average over (IS NOT NULL); it only stops a
--     single bad 0 from dividing by zero and aborting the brand's whole
--     refresh. The report RPCs (00063) already guard this way.
--   * The read functions gain a parameter, which CREATE OR REPLACE would add
--     as a second overload next to the old one. PostgREST resolves by named
--     arguments, so every call that omits p_topic_id — every brand-level
--     read — would match both and fail as ambiguous. The old signatures are
--     dropped first.

-- ─── Tables ─────────────────────────────────────────────────────────────────

alter table public.insights_prompt_daily
  add column if not exists mention_answers        integer,
  add column if not exists citation_answers       integer,
  add column if not exists mentioning_answers     integer,
  add column if not exists sum_visibility         numeric,
  add column if not exists sum_visibility_visible numeric,
  add column if not exists total_mentions         bigint,
  add column if not exists total_citations        bigint,
  add column if not exists positive_count         integer,
  add column if not exists sum_inv_position       numeric,
  add column if not exists position_count         integer,
  add column if not exists max_created_at         timestamptz;

create index if not exists idx_insights_prompt_daily_brand_prompt_day
  on public.insights_prompt_daily (brand_id, prompt_id, day);

create index if not exists idx_insights_competitor_prompt_daily_brand_prompt_day
  on public.insights_competitor_prompt_daily (brand_id, prompt_id, day);

-- Per-competitor additive measures at prompt grain. Same columns and meaning
-- as insights_competitor_daily, plus prompt_id.
create table if not exists public.insights_competitor_prompt_measures_daily (
  brand_id         uuid not null references public.brands(id) on delete cascade,
  day              date not null,
  competitor_id    text not null,
  prompt_id        uuid not null,
  model_used       text,
  platform         text,
  region           text,
  answer_count     integer not null,
  sum_visibility   numeric,
  total_mentions   bigint not null,
  total_citations  bigint not null,
  mention_answers  integer not null,
  citation_answers integer not null,
  sum_inv_position numeric,
  position_count   integer not null
);

create index if not exists idx_insights_competitor_prompt_measures_daily_brand_prompt_day
  on public.insights_competitor_prompt_measures_daily (brand_id, prompt_id, day);

-- The refresh deletes by (brand_id, day).
create index if not exists idx_insights_competitor_prompt_measures_daily_brand_day
  on public.insights_competitor_prompt_measures_daily (brand_id, day);

alter table public.insights_competitor_prompt_measures_daily enable row level security;

create policy "Users can read own org competitor prompt measures"
  on public.insights_competitor_prompt_measures_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

-- ─── Refresh ────────────────────────────────────────────────────────────────

create or replace function public.refresh_insights_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
as $$
begin
  -- One refresh per brand at a time; the lock releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_insights_daily:' || p_brand_id::text, 0));

  delete from public.insights_brand_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_prompt_measures_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.insights_brand_daily (
    brand_id, day, model_used, platform, region,
    answer_count, mention_answers, citation_answers, mentioning_answers,
    sum_visibility, sum_visibility_visible, total_mentions, total_citations,
    positive_count, sum_inv_position, position_count, max_created_at)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.model_used, pr.platform, pr.region,
    count(*),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    count(*) filter (where pr.sentiment = 'positive'),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position > 0),
    count(*) filter (where pr.mention_position > 0),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation,
    mention_answers, citation_answers, mentioning_answers,
    sum_visibility, sum_visibility_visible, total_mentions, total_citations,
    positive_count, sum_inv_position, position_count, max_created_at)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    count(*),
    bool_or(pr.mention_count > 0),
    bool_or(pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    count(*) filter (where pr.sentiment = 'positive'),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position > 0),
    count(*) filter (where pr.mention_position > 0),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.prompt_id, pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_daily (
    brand_id, day, competitor_id, model_used, platform, region,
    answer_count, sum_visibility, total_mentions, total_citations,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.model_used, pr.platform, pr.region,
    count(*),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'mention_count')::int, 0)), 0),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position')::numeric > 0),
    count(*) filter (where (cm.value->>'mention_position')::numeric > 0)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_prompt_measures_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region,
    answer_count, sum_visibility, total_mentions, total_citations,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    count(*),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'mention_count')::int, 0)), 0),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position')::numeric > 0),
    count(*) filter (where (cm.value->>'mention_position')::numeric > 0)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.prompt_id, pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_prompt_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region, mention_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    sum(coalesce((cm.value->>'mention_count')::int, 0))
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
    and (coalesce((cm.value->>'mention_count')::int, 0) > 0
      or coalesce((cm.value->>'citation_count')::int, 0) > 0
      or coalesce((cm.value->>'visibility_score')::numeric, 0) > 0)
  group by 2, cm.value->>'competitor_id', pr.prompt_id, pr.model_used, pr.platform, pr.region;
end;
$$;

revoke execute on function public.refresh_insights_daily(uuid, date, date)
  from public, anon, authenticated;

-- ─── Read functions ─────────────────────────────────────────────────────────
--
-- Payloads are unchanged. Each source the function reads becomes a pair of
-- branches gated on p_topic_id: the brand-grain table when it is null (the
-- read is then exactly what it was), the prompt-grain table restricted to the
-- topic's current prompts when it is set. The gate references only a
-- parameter, so the planner turns it into a one-time filter and the unused
-- branch is never scanned.
--
-- The gate must stay a branch of its own: folding it into one predicate
-- ("p_topic_id is null or prompt_id = any (...)") stops the planner from
-- using the (brand_id, prompt_id, day) index and scans the whole brand.
--
-- The topic's prompts are resolved once per call (topic_prompts), the same
-- set the raw RPCs' EXISTS (prompts.topic_id = p_topic_id) admits.
--
-- At prompt grain the competitor measure table holds about one row per
-- answer and competitor, so per-row work matters: each function folds
-- competitor rows to the grain it reports at before joining competitors.

drop function if exists public.insights_aggregates_daily(uuid, text, text[], text, date, date);
drop function if exists public.visible_prompt_stats_daily(uuid, text, text[], text, date, date);
drop function if exists public.tracked_prompt_count_daily(uuid, text, text[], text, date, date);
drop function if exists public.ai_visibility_aggregates_daily(uuid, text, text[], text, date, date);
drop function if exists public.competitor_aggregates_daily(uuid, text, text[], text, date, date);
drop function if exists public.share_of_voice_aggregates_daily(uuid, text, text[], text, date, date);
drop function if exists public.visibility_rate_trend_daily(uuid, text, text[], text, date, date);

-- insights_aggregates over rollups.
create function public.insights_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  filtered as (
    select d.model_used, d.answer_count, d.sum_visibility, d.total_mentions,
           d.total_citations, d.positive_count, d.mentioning_answers, d.max_created_at
    from public.insights_brand_daily d
    where p_topic_id is null
      and d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    union all
    select d.model_used, d.answer_count, d.sum_visibility, d.total_mentions,
           d.total_citations, d.positive_count, d.mentioning_answers, d.max_created_at
    from public.insights_prompt_daily d, topic_prompts tp
    where p_topic_id is not null
      and d.brand_id = p_brand_id
      and d.prompt_id = any (tp.ids)
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  totals as (
    select
      coalesce(sum(answer_count), 0)       as total_results,
      coalesce(sum(sum_visibility), 0)     as sum_visibility,
      coalesce(sum(total_mentions), 0)     as total_mentions,
      coalesce(sum(total_citations), 0)    as total_citations,
      coalesce(sum(positive_count), 0)     as positive_count,
      coalesce(sum(mentioning_answers), 0) as mentioning_results,
      max(max_created_at)                  as last_checked_at
    from filtered
  ),
  by_model as (
    select
      coalesce(model_used, 'unknown') as model_used,
      sum(sum_visibility)             as sum_visibility,
      sum(answer_count)               as result_count
    from filtered
    group by coalesce(model_used, 'unknown')
  )
  select jsonb_build_object(
    'total_results',      t.total_results,
    'sum_visibility',     t.sum_visibility,
    'total_mentions',     t.total_mentions,
    'total_citations',    t.total_citations,
    'positive_count',     t.positive_count,
    'mentioning_results', t.mentioning_results,
    'last_checked_at',    t.last_checked_at,
    'by_model', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',     bm.model_used,
                'sum_visibility', bm.sum_visibility,
                'result_count',   bm.result_count)
              order by bm.result_count desc, bm.model_used)
       from by_model bm),
      '[]'::jsonb)
  )
  from totals t;
$$;

-- visible_prompt_stats over rollups.
create function public.visible_prompt_stats_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_rows as (
    select bd.mentioning_answers, bd.sum_visibility_visible
    from public.insights_brand_daily bd
    where p_topic_id is null
      and bd.brand_id = p_brand_id
      and (p_platform is null or bd.platform = p_platform)
      and (p_models is null or bd.model_used = any (p_models))
      and (p_region is null or bd.region = p_region)
      and (p_day_from is null or bd.day >= p_day_from)
      and (p_day_to is null or bd.day <= p_day_to)
    union all
    select pd.mentioning_answers, pd.sum_visibility_visible
    from public.insights_prompt_daily pd, topic_prompts tp
    where p_topic_id is not null
      and pd.brand_id = p_brand_id
      and pd.prompt_id = any (tp.ids)
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
  ),
  visible_rows as (
    select pd.prompt_id
    from public.insights_prompt_daily pd
    where p_topic_id is null
      and pd.brand_id = p_brand_id
      and (pd.has_mention or pd.has_citation)
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
    union all
    select pd.prompt_id
    from public.insights_prompt_daily pd, topic_prompts tp
    where p_topic_id is not null
      and pd.brand_id = p_brand_id
      and pd.prompt_id = any (tp.ids)
      and (pd.has_mention or pd.has_citation)
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
  )
  select jsonb_build_object(
    'visible_prompts',
      (select count(distinct prompt_id) from visible_rows),
    'visible_results',
      coalesce((select sum(mentioning_answers) from brand_rows), 0),
    'sum_visibility_visible',
      coalesce((select sum(sum_visibility_visible) from brand_rows), 0)
  );
$$;

-- tracked_prompt_count over rollups.
create function public.tracked_prompt_count_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns integer
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  )
  select count(distinct r.prompt_id)::integer
  from (
    select pd.prompt_id
    from public.insights_prompt_daily pd
    where p_topic_id is null
      and pd.brand_id = p_brand_id
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
    union all
    select pd.prompt_id
    from public.insights_prompt_daily pd, topic_prompts tp
    where p_topic_id is not null
      and pd.brand_id = p_brand_id
      and pd.prompt_id = any (tp.ids)
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
  ) r
$$;

-- ai_visibility_aggregates over rollups. Liveness join preserved; it runs on
-- the per-competitor totals rather than per row, which matters at prompt
-- grain (one row per answer and competitor).
create function public.ai_visibility_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_rows as (
    select d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_brand_daily d
    where p_topic_id is null
      and d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    union all
    select d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_prompt_daily d, topic_prompts tp
    where p_topic_id is not null
      and d.brand_id = p_brand_id
      and d.prompt_id = any (tp.ids)
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_rows as (
    select cd.competitor_id, cd.mention_answers, cd.citation_answers,
           cd.sum_inv_position, cd.position_count
    from public.insights_competitor_daily cd
    where p_topic_id is null
      and cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    union all
    select cd.competitor_id, cd.mention_answers, cd.citation_answers,
           cd.sum_inv_position, cd.position_count
    from public.insights_competitor_prompt_measures_daily cd, topic_prompts tp
    where p_topic_id is not null
      and cd.brand_id = p_brand_id
      and cd.prompt_id = any (tp.ids)
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
  ),
  brand_agg as (
    select
      coalesce(sum(answer_count), 0)    as answers,
      coalesce(sum(mention_answers), 0) as mention_answers,
      coalesce(sum(citation_answers), 0) as citation_answers,
      sum(sum_inv_position) / nullif(sum(position_count), 0) as position_factor
    from brand_rows
  ),
  comp_totals as (
    select competitor_id,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from comp_rows
    group by competitor_id
  ),
  comp_agg as (
    select ct.competitor_id, c.name, ct.mention_answers, ct.citation_answers,
           ct.sum_inv_position / nullif(ct.position_count, 0) as position_factor
    from comp_totals ct
    join public.competitors c
      on c.id::text = ct.competitor_id and c.brand_id = p_brand_id
  )
  select jsonb_build_object(
    'answers',          b.answers,
    'mention_answers',  b.mention_answers,
    'citation_answers', b.citation_answers,
    'position_factor',  b.position_factor,
    'by_competitor', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'competitor_id',    ca.competitor_id,
                'name',             ca.name,
                'mention_answers',  ca.mention_answers,
                'citation_answers', ca.citation_answers,
                'position_factor',  ca.position_factor)
              order by ca.mention_answers desc, ca.competitor_id)
       from comp_agg ca),
      '[]'::jsonb)
  )
  from brand_agg b;
$$;

-- competitor_aggregates over rollups. Competitor measures fold to one row per
-- (competitor, engine) first, and the liveness join runs on that; the
-- visible-prompt sightings fold to distinct (competitor, engine, prompt).
-- Sightings of competitors that no longer exist need no join of their own:
-- they only ever attach to rows that passed the liveness join. Engine keys
-- join with IS NOT DISTINCT FROM because model_used can be null.
create function public.competitor_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_days as (
    select d.model_used, d.platform, d.answer_count, d.sum_visibility,
           d.total_mentions, d.total_citations
    from public.insights_brand_daily d
    where p_topic_id is null
      and d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    union all
    select d.model_used, d.platform, d.answer_count, d.sum_visibility,
           d.total_mentions, d.total_citations
    from public.insights_prompt_daily d, topic_prompts tp
    where p_topic_id is not null
      and d.brand_id = p_brand_id
      and d.prompt_id = any (tp.ids)
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  prompt_days as (
    select d.model_used, d.platform, d.prompt_id, d.has_mention, d.has_citation
    from public.insights_prompt_daily d
    where p_topic_id is null
      and d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    union all
    select d.model_used, d.platform, d.prompt_id, d.has_mention, d.has_citation
    from public.insights_prompt_daily d, topic_prompts tp
    where p_topic_id is not null
      and d.brand_id = p_brand_id
      and d.prompt_id = any (tp.ids)
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_engine as (
    select r.competitor_id, r.model_used, r.platform,
           sum(r.sum_visibility)  as sum_visibility,
           sum(r.answer_count)    as row_count,
           sum(r.total_mentions)  as total_mentions,
           sum(r.total_citations) as total_citations
    from (
      select cd.competitor_id, cd.model_used, cd.platform, cd.answer_count,
             cd.sum_visibility, cd.total_mentions, cd.total_citations
      from public.insights_competitor_daily cd
      where p_topic_id is null
        and cd.brand_id = p_brand_id
        and (p_platform is null or cd.platform = p_platform)
        and (p_models is null or cd.model_used = any (p_models))
        and (p_region is null or cd.region = p_region)
        and (p_day_from is null or cd.day >= p_day_from)
        and (p_day_to is null or cd.day <= p_day_to)
      union all
      select cd.competitor_id, cd.model_used, cd.platform, cd.answer_count,
             cd.sum_visibility, cd.total_mentions, cd.total_citations
      from public.insights_competitor_prompt_measures_daily cd, topic_prompts tp
      where p_topic_id is not null
        and cd.brand_id = p_brand_id
        and cd.prompt_id = any (tp.ids)
        and (p_platform is null or cd.platform = p_platform)
        and (p_models is null or cd.model_used = any (p_models))
        and (p_region is null or cd.region = p_region)
        and (p_day_from is null or cd.day >= p_day_from)
        and (p_day_to is null or cd.day <= p_day_to)
    ) r
    group by r.competitor_id, r.model_used, r.platform
  ),
  live_engine as (
    select ce.*, c.name
    from comp_engine ce
    join public.competitors c
      on c.id::text = ce.competitor_id and c.brand_id = p_brand_id
  ),
  comp_sightings as (
    select distinct s.competitor_id, s.model_used, s.platform, s.prompt_id
    from (
      select cpd.competitor_id, cpd.model_used, cpd.platform, cpd.prompt_id
      from public.insights_competitor_prompt_daily cpd
      where p_topic_id is null
        and cpd.brand_id = p_brand_id
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
      union all
      select cpd.competitor_id, cpd.model_used, cpd.platform, cpd.prompt_id
      from public.insights_competitor_prompt_daily cpd, topic_prompts tp
      where p_topic_id is not null
        and cpd.brand_id = p_brand_id
        and cpd.prompt_id = any (tp.ids)
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
    ) s
  ),
  brand_totals as (
    select
      coalesce((select sum(answer_count) from brand_days), 0)    as row_count,
      coalesce((select sum(sum_visibility) from brand_days), 0)  as sum_visibility,
      coalesce((select sum(total_mentions) from brand_days), 0)  as total_mentions,
      coalesce((select sum(total_citations) from brand_days), 0) as total_citations,
      (select count(distinct prompt_id) from prompt_days)        as prompt_count,
      (select count(distinct prompt_id) from prompt_days
        where has_mention or has_citation)                       as visible_prompts
  ),
  by_brand_provider as (
    select b.model_used, b.platform, b.sum_visibility, b.row_count,
           p.prompt_count, p.visible_prompts
    from (
      select model_used, platform,
             sum(sum_visibility) as sum_visibility,
             sum(answer_count)   as row_count
      from brand_days group by model_used, platform
    ) b
    join (
      select model_used, platform,
             count(distinct prompt_id) as prompt_count,
             count(distinct prompt_id)
               filter (where has_mention or has_citation) as visible_prompts
      from prompt_days group by model_used, platform
    ) p on p.model_used is not distinct from b.model_used
       and p.platform is not distinct from b.platform
  ),
  visible_by_comp as (
    select competitor_id, count(distinct prompt_id) as visible_prompts
    from comp_sightings group by competitor_id
  ),
  visible_by_comp_engine as (
    select competitor_id, model_used, platform, count(*) as visible_prompts
    from comp_sightings group by competitor_id, model_used, platform
  ),
  by_competitor as (
    select
      le.competitor_id,
      max(le.name)              as name,
      sum(le.sum_visibility)    as sum_visibility,
      sum(le.row_count)         as row_count,
      coalesce(sum(le.total_mentions), 0)::bigint  as total_mentions,
      coalesce(sum(le.total_citations), 0)::bigint as total_citations,
      coalesce(max(v.visible_prompts), 0)          as visible_prompts
    from live_engine le
    left join visible_by_comp v on v.competitor_id = le.competitor_id
    group by le.competitor_id
  ),
  by_competitor_provider as (
    select
      le.model_used, le.platform, le.competitor_id,
      le.name                            as competitor_name,
      le.sum_visibility,
      le.row_count,
      coalesce(v.visible_prompts, 0)     as visible_prompts
    from live_engine le
    left join visible_by_comp_engine v
      on v.competitor_id = le.competitor_id
     and v.model_used is not distinct from le.model_used
     and v.platform is not distinct from le.platform
  )
  select jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'brand_prompt_count',    b.prompt_count,
    'brand_visible_prompts', b.visible_prompts,
    'by_competitor', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'competitor_id',   bc.competitor_id,
                'name',            bc.name,
                'sum_visibility',  bc.sum_visibility,
                'row_count',       bc.row_count,
                'total_mentions',  bc.total_mentions,
                'total_citations', bc.total_citations,
                'visible_prompts', bc.visible_prompts)
              order by bc.row_count desc, bc.competitor_id)
       from by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',      bbp.model_used,
                'platform',        bbp.platform,
                'sum_visibility',  bbp.sum_visibility,
                'row_count',       bbp.row_count,
                'prompt_count',    bbp.prompt_count,
                'visible_prompts', bbp.visible_prompts)
              order by bbp.platform nulls last, bbp.model_used nulls last)
       from by_brand_provider bbp),
      '[]'::jsonb),
    'by_competitor_provider', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',      bcp.model_used,
                'platform',        bcp.platform,
                'competitor_id',   bcp.competitor_id,
                'competitor_name', bcp.competitor_name,
                'sum_visibility',  bcp.sum_visibility,
                'row_count',       bcp.row_count,
                'visible_prompts', bcp.visible_prompts)
              order by bcp.platform nulls last, bcp.model_used nulls last, bcp.competitor_id)
       from by_competitor_provider bcp),
      '[]'::jsonb)
  )
  from brand_totals b;
$$;

-- share_of_voice_aggregates over rollups. No competitors join anywhere — the
-- raw RPC sums every jsonb element regardless of liveness (00066). Both sides
-- fold to (day, engine) once; the totals, per-engine and per-day series are
-- all read from those.
create function public.share_of_voice_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_days as (
    select r.day, r.model_used, r.platform, sum(r.total_mentions) as total_mentions
    from (
      select d.day, d.model_used, d.platform, d.total_mentions
      from public.insights_brand_daily d
      where p_topic_id is null
        and d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
      union all
      select d.day, d.model_used, d.platform, d.total_mentions
      from public.insights_prompt_daily d, topic_prompts tp
      where p_topic_id is not null
        and d.brand_id = p_brand_id
        and d.prompt_id = any (tp.ids)
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ) r
    group by r.day, r.model_used, r.platform
  ),
  comp_days as (
    select r.day, r.model_used, r.platform, sum(r.total_mentions) as total_mentions
    from (
      select d.day, d.model_used, d.platform, d.total_mentions
      from public.insights_competitor_daily d
      where p_topic_id is null
        and d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
      union all
      select d.day, d.model_used, d.platform, d.total_mentions
      from public.insights_competitor_prompt_measures_daily d, topic_prompts tp
      where p_topic_id is not null
        and d.brand_id = p_brand_id
        and d.prompt_id = any (tp.ids)
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ) r
    group by r.day, r.model_used, r.platform
  ),
  totals as (
    select
      coalesce((select sum(total_mentions) from brand_days), 0)::bigint as total_brand_mentions,
      coalesce((select sum(total_mentions) from comp_days), 0)::bigint  as total_competitor_mentions
  ),
  by_platform as (
    select b.model_used, b.platform,
           b.brand_mentions,
           coalesce(c.competitor_mentions, 0) as competitor_mentions
    from (
      select model_used, platform,
             coalesce(sum(total_mentions), 0)::bigint as brand_mentions
      from brand_days group by model_used, platform
    ) b
    left join (
      select model_used, platform,
             coalesce(sum(total_mentions), 0)::bigint as competitor_mentions
      from comp_days group by model_used, platform
    ) c on c.model_used is not distinct from b.model_used
       and c.platform is not distinct from b.platform
  ),
  by_day as (
    select b.day,
           b.brand_mentions,
           coalesce(c.competitor_mentions, 0) as competitor_mentions
    from (
      select to_char(day, 'YYYY-MM-DD') as day,
             coalesce(sum(total_mentions), 0)::bigint as brand_mentions
      from brand_days group by day
    ) b
    left join (
      select to_char(day, 'YYYY-MM-DD') as day,
             coalesce(sum(total_mentions), 0)::bigint as competitor_mentions
      from comp_days group by day
    ) c on c.day = b.day
  )
  select jsonb_build_object(
    'total_brand_mentions',      t.total_brand_mentions,
    'total_competitor_mentions', t.total_competitor_mentions,
    'by_platform', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',          bp.model_used,
                'platform',            bp.platform,
                'brand_mentions',      bp.brand_mentions,
                'competitor_mentions', bp.competitor_mentions)
              order by bp.platform nulls last, bp.model_used nulls last)
       from by_platform bp),
      '[]'::jsonb),
    'by_day', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'day',                 bd.day,
                'brand_mentions',      bd.brand_mentions,
                'competitor_mentions', bd.competitor_mentions)
              order by bd.day)
       from by_day bd),
      '[]'::jsonb)
  )
  from totals t;
$$;

-- visibility_rate_trend over rollups. Liveness join preserved, on the
-- per-day competitor totals; visible sightings attach to those rows only.
create function public.visibility_rate_trend_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_rows as (
    select d.day, d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_brand_daily d
    where p_topic_id is null
      and d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    union all
    select d.day, d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_prompt_daily d, topic_prompts tp
    where p_topic_id is not null
      and d.brand_id = p_brand_id
      and d.prompt_id = any (tp.ids)
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  brand_daily as (
    select day,
           sum(answer_count)     as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) / nullif(sum(position_count), 0) as position_factor,
           sum(position_count)   as position_n
    from brand_rows
    group by day
  ),
  prompt_daily as (
    select r.day,
           count(distinct r.prompt_id) as prompt_count,
           count(distinct r.prompt_id)
             filter (where r.has_mention or r.has_citation) as visible_prompts
    from (
      select d.day, d.prompt_id, d.has_mention, d.has_citation
      from public.insights_prompt_daily d
      where p_topic_id is null
        and d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
      union all
      select d.day, d.prompt_id, d.has_mention, d.has_citation
      from public.insights_prompt_daily d, topic_prompts tp
      where p_topic_id is not null
        and d.brand_id = p_brand_id
        and d.prompt_id = any (tp.ids)
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ) r
    group by r.day
  ),
  comp_totals as (
    select r.day, r.competitor_id,
           sum(r.mention_answers)  as mention_answers,
           sum(r.citation_answers) as citation_answers,
           sum(r.sum_inv_position) / nullif(sum(r.position_count), 0) as position_factor,
           sum(r.position_count)   as position_n
    from (
      select cd.day, cd.competitor_id, cd.mention_answers, cd.citation_answers,
             cd.sum_inv_position, cd.position_count
      from public.insights_competitor_daily cd
      where p_topic_id is null
        and cd.brand_id = p_brand_id
        and (p_platform is null or cd.platform = p_platform)
        and (p_models is null or cd.model_used = any (p_models))
        and (p_region is null or cd.region = p_region)
        and (p_day_from is null or cd.day >= p_day_from)
        and (p_day_to is null or cd.day <= p_day_to)
      union all
      select cd.day, cd.competitor_id, cd.mention_answers, cd.citation_answers,
             cd.sum_inv_position, cd.position_count
      from public.insights_competitor_prompt_measures_daily cd, topic_prompts tp
      where p_topic_id is not null
        and cd.brand_id = p_brand_id
        and cd.prompt_id = any (tp.ids)
        and (p_platform is null or cd.platform = p_platform)
        and (p_models is null or cd.model_used = any (p_models))
        and (p_region is null or cd.region = p_region)
        and (p_day_from is null or cd.day >= p_day_from)
        and (p_day_to is null or cd.day <= p_day_to)
    ) r
    group by r.day, r.competitor_id
  ),
  comp_daily as (
    select ct.*
    from comp_totals ct
    join public.competitors c
      on c.id::text = ct.competitor_id and c.brand_id = p_brand_id
  ),
  comp_visible as (
    select r.day, r.competitor_id, count(distinct r.prompt_id) as visible_prompts
    from (
      select cpd.day, cpd.competitor_id, cpd.prompt_id
      from public.insights_competitor_prompt_daily cpd
      where p_topic_id is null
        and cpd.brand_id = p_brand_id
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
      union all
      select cpd.day, cpd.competitor_id, cpd.prompt_id
      from public.insights_competitor_prompt_daily cpd, topic_prompts tp
      where p_topic_id is not null
        and cpd.brand_id = p_brand_id
        and cpd.prompt_id = any (tp.ids)
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
    ) r
    group by r.day, r.competitor_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'day',              bd.day,
      'prompt_count',     coalesce(pd.prompt_count, 0),
      'visible_prompts',  coalesce(pd.visible_prompts, 0),
      'answers',          bd.answers,
      'mention_answers',  bd.mention_answers,
      'citation_answers', bd.citation_answers,
      'position_factor',  bd.position_factor,
      'position_n',       bd.position_n,
      'competitors', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'competitor_id',    cd.competitor_id,
                  'visible_prompts',  coalesce(cv.visible_prompts, 0),
                  'mention_answers',  cd.mention_answers,
                  'citation_answers', cd.citation_answers,
                  'position_factor',  cd.position_factor,
                  'position_n',       cd.position_n)
                order by cd.competitor_id)
         from comp_daily cd
         left join comp_visible cv
           on cv.day = cd.day and cv.competitor_id = cd.competitor_id
         where cd.day = bd.day),
        '[]'::jsonb)
    ) order by bd.day),
    '[]'::jsonb)
  from brand_daily bd
  left join prompt_daily pd on pd.day = bd.day;
$$;

-- PostgREST caches function signatures; make it see the new ones now.
notify pgrst, 'reload schema';
