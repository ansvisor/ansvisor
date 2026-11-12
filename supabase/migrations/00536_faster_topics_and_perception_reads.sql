-- ============================================================================
-- 00536: faster topics_overview_window and mentions_perception_live
-- ============================================================================
-- The morning health report (server/src/lib/health) timed, on production:
--   * topics_overview_window at 90 days: 12.62 s, past the statement timeout;
--   * mentions_perception_live at 30 days: 6.96 s, near it.
-- Both already read daily rollups for whole days (00236, 00290), but rollups
-- at the answer's own grain: one row per prompt, engine, region and day
-- (insights_prompt_daily, insights_competitor_prompt_daily), and one per
-- term, entity, platform, region and day (mentions_terms_daily). A day of
-- those is about a day of answers, so 90 days (and the 90 before, for the
-- change) read about as many index entries as the answers themselves, and the
-- time grew with the window.
--
-- Neither read uses the engine or the region when none is picked: the Topics
-- tab has no such filter, and Perception's unfiltered view sums them all. So
-- three small rollups hold the same figures with those summed, rewritten by
-- the same nightly refreshes, for the same days, in the same transaction:
--   * topics_prompt_daily: insights_prompt_daily per (brand, day, prompt);
--   * topics_competitor_daily: insights_competitor_prompt_daily's mention
--     counts per (brand, day, prompt, competitor);
--   * mentions_terms_daily_all: mentions_terms_daily per (brand, entity, day,
--     term), keyed for the read by entity and day, and by term and day for
--     the 15 brand terms' window before.
-- The prompts' topics are still joined at read time, so moving a prompt to
-- another topic moves its history as before.
--
-- The reads return the same results:
--   * topics_overview_window: windows of two days or more read
--     topics_prompt_daily instead of insights_prompt_daily, and the window's
--     competitor mentions summed per (prompt, competitor) from
--     topics_competitor_daily before the topics and names are joined. The
--     24-hour window still reads the answers. Sums of sums, a max of maxes,
--     and a prompt counted once when any of its rows counted it.
--   * mentions_perception_live: with no platform, country, topic or search,
--     the shown entities' terms and the brand's 15 terms' window before come
--     from mentions_terms_daily_all. A filtered view reads as before.
--     It also runs without JIT: the phrase check's row estimate is far off,
--     so the planner compiled the query, which took longer than reading it.
-- Signatures, results, grants and the brand access check (00434) are
-- unchanged.
--
-- The new tables are backfilled from the rollups at the end. On production
-- the backfill reads each source rollup once; apply this outside the nightly
-- refresh. A refresh already running when it applies finishes with the
-- definitions it started with, so re-run refresh_insights_daily and
-- refresh_mention_terms_daily for those brands' days if one did.

-- ── Topics: the prompt's day, every engine and region summed ───────────────

create table if not exists public.topics_prompt_daily (
  brand_id           uuid not null references public.brands(id) on delete cascade,
  day                date not null,
  prompt_id          uuid not null,
  answer_count       integer not null,
  mention_answers    integer,
  citation_answers   integer,
  mentioning_answers integer,
  total_mentions     bigint,
  total_citations    bigint,
  sum_inv_position   numeric,
  position_count     integer,
  max_created_at     timestamptz,
  -- Every figure in the key's leaf, so the read is index-only.
  constraint topics_prompt_daily_pkey primary key (brand_id, day, prompt_id)
    include (answer_count, mention_answers, citation_answers, mentioning_answers,
             total_mentions, total_citations, sum_inv_position, position_count,
             max_created_at)
);

create table if not exists public.topics_competitor_daily (
  brand_id      uuid not null references public.brands(id) on delete cascade,
  day           date not null,
  prompt_id     uuid not null,
  competitor_id text not null,
  mention_count integer not null,
  constraint topics_competitor_daily_pkey primary key (brand_id, day, prompt_id, competitor_id)
    include (mention_count)
);

-- ── Perception: a day's terms, every platform and region summed ────────────

create table if not exists public.mentions_terms_daily_all (
  brand_id uuid not null references public.brands(id) on delete cascade,
  entity   text not null,
  day      date not null,
  term     text not null,
  answers  integer not null,
  -- The entity first, as mentions_terms_daily: the read joins the shown
  -- entities to it.
  constraint mentions_terms_daily_all_pkey primary key (brand_id, entity, day, term)
    include (answers)
);

-- The brand's 15 terms shown, over the window before: each term's days.
create index if not exists mentions_terms_daily_all_term
  on public.mentions_terms_daily_all (brand_id, entity, term, day)
  include (answers);

-- Read by the security definer functions and written by the refreshes only,
-- as their sources (00066, 00231).
alter table public.topics_prompt_daily enable row level security;
alter table public.topics_competitor_daily enable row level security;
alter table public.mentions_terms_daily_all enable row level security;

-- Each refresh deletes and rewrites a range of days; vacuumed about daily,
-- as 00236 and 00290 have their sources, so the reads stay index-only.
alter table public.topics_prompt_daily set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);
alter table public.topics_competitor_daily set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);
alter table public.mentions_terms_daily_all set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);

comment on table public.topics_prompt_daily is
  'insights_prompt_daily per (brand, day, prompt), every engine and region summed: the Topics tab''s windows of two days or more (topics_overview_window, 00536). Rewritten with it by refresh_insights_daily.';
comment on table public.topics_competitor_daily is
  'insights_competitor_prompt_daily''s mention counts per (brand, day, prompt, competitor), every engine and region summed: the Topics tab''s competitor share (topics_overview_window, 00536). Rewritten with it by refresh_insights_daily.';
comment on table public.mentions_terms_daily_all is
  'mentions_terms_daily per (brand, entity, day, term), every platform and region summed: the Perception tab''s unfiltered live read (mentions_perception_live, 00536). Rewritten with it by refresh_mention_terms_daily.';

-- ── refresh_insights_daily (00164), the Topics rollups appended ──────────

create or replace function public.refresh_insights_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  -- The range's bounds as instants, so the answers are found through
  -- (brand_id, created_at) rather than by reading all of the brand's.
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
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

  insert into public.insights_brand_daily (
    brand_id, day, model_used, platform, region,
    answer_count, mention_answers, citation_answers, mentioning_answers,
    sum_visibility, sum_visibility_visible, total_mentions, total_citations,
    positive_count, sum_inv_position, position_count, max_created_at,
    negative_count, sum_position)
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
    max(pr.created_at),
    count(*) filter (where pr.sentiment = 'negative'),
    sum(pr.mention_position) filter (where pr.mention_position > 0)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and pr.created_at >= v_from
    and pr.created_at < v_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation,
    mention_answers, citation_answers, mentioning_answers, positive_count,
    total_mentions, total_citations, sum_inv_position, position_count,
    negative_count, sum_position,
    sum_visibility, sum_visibility_visible, max_created_at)
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
    count(*) filter (where pr.sentiment = 'positive'),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position > 0),
    count(*) filter (where pr.mention_position > 0),
    count(*) filter (where pr.sentiment = 'negative'),
    sum(pr.mention_position) filter (where pr.mention_position > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to
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
    and pr.created_at >= v_from
    and pr.created_at < v_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.model_used, pr.platform, pr.region;

  -- Sightings only, as in 00098; the measures follow insights_competitor_daily.
  insert into public.insights_competitor_prompt_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region, mention_count,
    mention_answers, citation_answers, sum_inv_position, position_count,
    sum_visibility, total_citations)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    sum(coalesce((cm.value->>'mention_count')::int, 0)),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position')::numeric > 0),
    count(*) filter (where (cm.value->>'mention_position')::numeric > 0),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to
    and cm.value ? 'competitor_id'
    and (coalesce((cm.value->>'mention_count')::int, 0) > 0
      or coalesce((cm.value->>'citation_count')::int, 0) > 0
      or coalesce((cm.value->>'visibility_score')::numeric, 0) > 0)
  group by 2, cm.value->>'competitor_id', pr.prompt_id, pr.model_used, pr.platform, pr.region;

  -- 00536: the same days at each prompt's grain, every engine and region
  -- summed, for the Topics tab's longer windows (topics_overview_window).
  delete from public.topics_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.topics_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.topics_prompt_daily (
    brand_id, day, prompt_id, answer_count, mention_answers, citation_answers,
    mentioning_answers, total_mentions, total_citations, sum_inv_position,
    position_count, max_created_at)
  select d.brand_id, d.day, d.prompt_id,
         sum(d.answer_count), sum(d.mention_answers), sum(d.citation_answers),
         sum(d.mentioning_answers), sum(d.total_mentions), sum(d.total_citations),
         sum(d.sum_inv_position), sum(d.position_count), max(d.max_created_at)
  from public.insights_prompt_daily d
  where d.brand_id = p_brand_id and d.day between p_day_from and p_day_to
  group by d.brand_id, d.day, d.prompt_id;

  insert into public.topics_competitor_daily (
    brand_id, day, prompt_id, competitor_id, mention_count)
  select d.brand_id, d.day, d.prompt_id, d.competitor_id, sum(d.mention_count)
  from public.insights_competitor_prompt_daily d
  where d.brand_id = p_brand_id and d.day between p_day_from and p_day_to
  group by d.brand_id, d.day, d.prompt_id, d.competitor_id;
end;
$$;

-- ── refresh_mention_terms_daily (00246), the every-platform terms added ──

create or replace function public.refresh_mention_terms_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to   date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  -- One rebuild per brand at a time: a run's refresh and the deleted-prompt
  -- rebuild can cover the same days. The lock releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms_daily:' || p_brand_id::text, 0));

  -- The terms' key leads with the entity, so their rows go by the entities
  -- those days name (the same rows the entities' come from), before those.
  delete from public.mentions_terms_daily
    where brand_id = p_brand_id
      and entity in (
        select distinct e.entity
        from public.mentions_entities_daily e
        where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to)
      and day between p_day_from and p_day_to;
  -- 00536: their every-platform sums, by the same entities and days.
  delete from public.mentions_terms_daily_all
    where brand_id = p_brand_id
      and entity in (
        select distinct e.entity
        from public.mentions_entities_daily e
        where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to)
      and day between p_day_from and p_day_to;
  delete from public.mentions_entities_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.mentions_entities_daily (
    brand_id, day, platform, region, entity, answers, with_brand)
  select p_brand_id, x.day, x.platform, x.region, x.entity,
         count(*), count(*) filter (where x.with_brand)
  from (
    select (t.created_at at time zone 'utc')::date as day, t.platform, t.region, t.entity,
           bool_or(t.entity = 'brand') over (partition by t.result_id) as with_brand
    from public.mentions_answer_terms t
    where t.brand_id = p_brand_id
      and t.created_at >= v_from
      and t.created_at < v_to
  ) x
  group by x.day, x.platform, x.region, x.entity;

  with c as materialized (
    select (t.created_at at time zone 'utc')::date as day, t.platform, t.region, t.entity,
           term, count(*)::integer as answers
    from public.mentions_answer_terms t
    cross join lateral unnest(t.terms) as term
    where t.brand_id = p_brand_id
      and t.created_at >= v_from
      and t.created_at < v_to
    group by 1, 2, 3, 4, 5
  ),
  -- The terms among any entity's 200 most frequent of a day, platform and
  -- region, kept for every entity there. coalesce rather than "is not
  -- distinct from", so the join below can hash.
  keep as (
    select distinct r.day, r.platform, coalesce(r.region, '') as region_key, r.term
    from (
      select c.day, c.platform, c.region, c.term,
             row_number() over (
               partition by c.day, c.platform, c.region, c.entity
               order by c.answers desc, c.term) as rn
      from c
    ) r
    where r.rn <= 200
  )
  insert into public.mentions_terms_daily (
    brand_id, day, platform, region, entity, term, answers)
  select p_brand_id, c.day, c.platform, c.region, c.entity, c.term, c.answers
  from c
  join keep k on k.day = c.day and k.platform = c.platform
             and k.region_key = coalesce(c.region, '') and k.term = c.term;

  -- 00536: the same terms summed over every platform and region, which the
  -- Perception tab's unfiltered live read sums (mentions_perception_live).
  insert into public.mentions_terms_daily_all (brand_id, entity, day, term, answers)
  select d.brand_id, d.entity, d.day, d.term, sum(d.answers)
  from public.mentions_terms_daily d
  where d.brand_id = p_brand_id
    and d.entity in (
      select distinct e.entity
      from public.mentions_entities_daily e
      where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to)
    and d.day between p_day_from and p_day_to
  group by d.brand_id, d.entity, d.day, d.term
  on conflict (brand_id, entity, day, term) do update set answers = excluded.answers;

  -- The brand's precomputed default views (00241) now count from rollups
  -- older than these: set aside, as forget_mentions_perception_snapshots
  -- does, so the tab reads the rollups live until the server refreshes
  -- them, never older figures. Last, in the same transaction: a refresh
  -- that started before this (and read the old rollups) can't write over
  -- it, as its computed_at is earlier.
  update public.mentions_perception_snapshots
  set day_to = date '1970-01-01', computed_at = clock_timestamp()
  where brand_id = p_brand_id;
end;
$$;

-- ── topics_overview_window (00434), the longer windows from the Topics rollups

create or replace function public.topics_overview_window(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null
)
returns table (
  topic_id              uuid,
  answers               bigint,
  mention_answers       bigint,
  citation_answers      bigint,
  pos_sum               double precision,
  pos_n                 bigint,
  prev_answers          bigint,
  prev_mention_answers  bigint,
  prev_citation_answers bigint,
  prev_pos_sum          double precision,
  prev_pos_n            bigint,
  total_mentions        bigint,
  total_citations       bigint,
  comp_mentions         bigint,
  active_prompts        bigint,
  visible_prompts       bigint,
  last_run_at           timestamptz,
  competitors           jsonb,
  daily                 jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_to        timestamptz := coalesce(p_date_to, now());
  v_from      timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  -- Whole days the window spans, at least one, with an hour of slack: a
  -- rolling 7 days starts where the browser put it and ends at now(), a
  -- moment later, which must not make it 8 (lib/topic-trend.ts counts alike).
  v_days      integer;
  -- The rollup days of a longer window, and of the window before it.
  v_day_to    date;
  v_day_from  date;
  v_prev_from date;
begin
  if auth.role() is distinct from 'service_role'
     and not public.can_access_brand(p_brand_id) then
    return;
  end if;

  v_days := greatest(1, ceil(extract(epoch from (v_to - v_from)) / 86400.0 - 1.0 / 24)::integer);

  if v_days < 2 then
    return query
    with
    topic_prompts as (
      select p.id as prompt_id, p.topic_id
      from public.prompts p
      join public.prompt_sets ps on ps.id = p.prompt_set_id
      where ps.brand_id = p_brand_id
        and p.topic_id is not null
    ),
    -- Both windows' answers from idx_prompt_results_brand_created_metrics
    -- (00232) alone: every column read here is in the index, so the answers'
    -- rows (and their competitor_mentions) stay unread.
    rows as materialized (
      select tp.topic_id,
             pr.prompt_id,
             pr.created_at,
             (pr.created_at >= v_from)                        as in_window,
             coalesce(pr.mention_count, 0)                    as mentions,
             coalesce(pr.citation_count, 0)                   as citations,
             pr.mention_position,
             (coalesce(pr.mention_count, 0) > 0
               or coalesce(pr.citation_count, 0) > 0)         as visible
      from public.prompt_results pr
      join topic_prompts tp on tp.prompt_id = pr.prompt_id
      where pr.brand_id = p_brand_id
        and pr.platform <> 'chatgpt-shopping'
        and pr.created_at >= v_from - (v_to - v_from)
        and pr.created_at <= v_to
    ),
    -- The competitor share is the window's alone, so only the window's
    -- answers are read for their competitor_mentions: half the rows 00156
    -- read, and none of the window before.
    comps as (
      select tp.topic_id,
             cm.value->>'competitor_id'                              as competitor_id,
             min(c.name)                                             as name,
             sum(coalesce((cm.value->>'mention_count')::int, 0))::bigint as mentions
      from public.prompt_results pr
      join topic_prompts tp on tp.prompt_id = pr.prompt_id
      cross join lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
      join public.competitors c on c.id::text = cm.value->>'competitor_id' and c.brand_id = p_brand_id
      where pr.brand_id = p_brand_id
        and pr.platform <> 'chatgpt-shopping'
        and pr.created_at >= v_from
        and pr.created_at <= v_to
      group by tp.topic_id, cm.value->>'competitor_id'
      having sum(coalesce((cm.value->>'mention_count')::int, 0)) > 0
    ),
    comp_totals as (
      select topic_id,
             sum(mentions)::bigint as comp_mentions,
             jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions))
               as competitors
      from comps
      group by topic_id
    ),
    main as (
      select r.topic_id,
             count(*) filter (where r.in_window)::bigint                          as answers,
             count(*) filter (where r.in_window and r.mentions > 0)::bigint       as mention_answers,
             count(*) filter (where r.in_window and r.citations > 0)::bigint      as citation_answers,
             coalesce(sum(1.0 / r.mention_position)
               filter (where r.in_window and r.mention_position > 0), 0)::double precision
                                                                                   as pos_sum,
             count(*) filter (where r.in_window and r.mention_position > 0)::bigint
                                                                                   as pos_n,
             count(*) filter (where not r.in_window)::bigint                      as prev_answers,
             count(*) filter (where not r.in_window and r.mentions > 0)::bigint   as prev_mention_answers,
             count(*) filter (where not r.in_window and r.citations > 0)::bigint  as prev_citation_answers,
             coalesce(sum(1.0 / r.mention_position)
               filter (where not r.in_window and r.mention_position > 0), 0)::double precision
                                                                                   as prev_pos_sum,
             count(*) filter (where not r.in_window and r.mention_position > 0)::bigint
                                                                                   as prev_pos_n,
             coalesce(sum(r.mentions) filter (where r.in_window), 0)::bigint      as total_mentions,
             coalesce(sum(r.citations) filter (where r.in_window), 0)::bigint     as total_citations,
             count(distinct r.prompt_id) filter (where r.in_window)::bigint       as active_prompts,
             count(distinct r.prompt_id) filter (where r.in_window and r.visible)::bigint
                                                                                   as visible_prompts,
             max(r.created_at) filter (where r.in_window)                         as last_run_at
      from rows r
      group by r.topic_id
    )
    select m.topic_id,
           m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
           m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
           m.total_mentions, m.total_citations,
           coalesce(ct.comp_mentions, 0)::bigint,
           m.active_prompts, m.visible_prompts, m.last_run_at,
           coalesce(ct.competitors, '{}'::jsonb),
           '{}'::jsonb
    from main m
    left join comp_totals ct on ct.topic_id = m.topic_id
    where m.answers > 0;
    return;
  end if;

  v_day_to := (v_to at time zone 'UTC')::date;
  v_day_from := v_day_to - (v_days - 1);
  v_prev_from := v_day_from - v_days;

  return query
  with
  topic_prompts as (
    select p.id as prompt_id, p.topic_id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and p.topic_id is not null
  ),
  -- The brand's prompts' days of both windows, every engine and region
  -- already summed (00536), read by (brand_id, day) and only then matched to
  -- the topics' prompts.
  prompt_rows as materialized (
    select d.prompt_id,
           d.day,
           d.answer_count,
           d.mention_answers,
           d.citation_answers,
           d.mentioning_answers,
           d.total_mentions,
           d.total_citations,
           d.sum_inv_position,
           d.position_count,
           d.max_created_at
    from public.topics_prompt_daily d
    where d.brand_id = p_brand_id
      and d.day between v_prev_from and v_day_to
  ),
  days as (
    select tp.topic_id,
           r.prompt_id,
           r.day,
           (r.day >= v_day_from) as in_window,
           r.answer_count,
           r.mention_answers,
           r.citation_answers,
           r.mentioning_answers,
           r.total_mentions,
           r.total_citations,
           r.sum_inv_position,
           r.position_count,
           r.max_created_at
    from prompt_rows r
    join topic_prompts tp on tp.prompt_id = r.prompt_id
  ),
  -- Each prompt's competitor mentions over the window, summed before the
  -- topics and names are joined (00536).
  sightings as materialized (
    select cpd.prompt_id, cpd.competitor_id, sum(cpd.mention_count)::bigint as mention_count
    from public.topics_competitor_daily cpd
    where cpd.brand_id = p_brand_id
      and cpd.day between v_day_from and v_day_to
    group by cpd.prompt_id, cpd.competitor_id
  ),
  comps as (
    select tp.topic_id,
           s.competitor_id,
           min(c.name)                   as name,
           sum(s.mention_count)::bigint  as mentions
    from sightings s
    join topic_prompts tp     on tp.prompt_id = s.prompt_id
    join public.competitors c on c.id::text = s.competitor_id and c.brand_id = p_brand_id
    group by tp.topic_id, s.competitor_id
    having sum(s.mention_count) > 0
  ),
  comp_totals as (
    select topic_id,
           sum(mentions)::bigint as comp_mentions,
           jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions))
             as competitors
    from comps
    group by topic_id
  ),
  -- A point per UTC day, keyed as the client builds its keys
  -- (Date.toISOString()).
  daily as (
    select x.topic_id,
           jsonb_object_agg(x.day, jsonb_build_object('visible', x.visible, 'count', x.count))
             as daily
    from (
      select topic_id,
             to_char(day, 'YYYY-MM-DD')     as day,
             sum(mentioning_answers)::bigint as visible,
             sum(answer_count)::bigint       as count
      from days
      where in_window
      group by topic_id, day
    ) x
    group by x.topic_id
  ),
  -- Each topic's last answer in the window, from the rollups (00164).
  last_runs as (
    select topic_id, max(max_created_at) as last_run_at
    from days
    where in_window
    group by topic_id
  ),
  main as (
    select topic_id,
           coalesce(sum(answer_count) filter (where in_window), 0)::bigint         as answers,
           coalesce(sum(mention_answers) filter (where in_window), 0)::bigint      as mention_answers,
           coalesce(sum(citation_answers) filter (where in_window), 0)::bigint     as citation_answers,
           coalesce(sum(sum_inv_position) filter (where in_window), 0)::double precision
                                                                                   as pos_sum,
           coalesce(sum(position_count) filter (where in_window), 0)::bigint       as pos_n,
           coalesce(sum(answer_count) filter (where not in_window), 0)::bigint     as prev_answers,
           coalesce(sum(mention_answers) filter (where not in_window), 0)::bigint  as prev_mention_answers,
           coalesce(sum(citation_answers) filter (where not in_window), 0)::bigint as prev_citation_answers,
           coalesce(sum(sum_inv_position) filter (where not in_window), 0)::double precision
                                                                                   as prev_pos_sum,
           coalesce(sum(position_count) filter (where not in_window), 0)::bigint   as prev_pos_n,
           coalesce(sum(total_mentions) filter (where in_window), 0)::bigint       as total_mentions,
           coalesce(sum(total_citations) filter (where in_window), 0)::bigint      as total_citations,
           count(distinct prompt_id) filter (where in_window and answer_count > 0)::bigint
                                                                                   as active_prompts,
           count(distinct prompt_id) filter (where in_window and mentioning_answers > 0)::bigint
                                                                                   as visible_prompts
    from days
    group by topic_id
  )
  select m.topic_id,
         m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
         m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
         m.total_mentions, m.total_citations,
         coalesce(ct.comp_mentions, 0)::bigint,
         m.active_prompts, m.visible_prompts, lr.last_run_at,
         coalesce(ct.competitors, '{}'::jsonb),
         coalesce(dl.daily, '{}'::jsonb)
  from main m
  left join comp_totals ct on ct.topic_id = m.topic_id
  left join daily dl       on dl.topic_id = m.topic_id
  left join last_runs lr   on lr.topic_id = m.topic_id
  where m.answers > 0;
end;
$$;

-- ── mentions_perception_live (00290), unfiltered whole days from the summed terms

create or replace function public.mentions_perception_live(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null,
  p_platform  text default null,
  p_region    text default null,
  p_topic_id  uuid default null,
  p_search    text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
-- 00536: no JIT. The phrase check's estimate passes jit_above_cost, and
-- compiling took longer than the read (about 0.1 s of 0.12 s).
set jit to 'off'
as $$
declare
  v_to         timestamptz := coalesce(p_date_to, now());
  v_from       timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_days       integer;
  v_day_to     date;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_search     text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_rollup     boolean;
  -- The rollups with no platform or region: the every-platform terms (00536).
  v_all        boolean;
  v_start_day  date;
  v_end_day    date;
  v_prev_day   date;
  v_result     jsonb;
begin
  v_days := greatest(1, ceil(extract(epoch from v_to - v_from) / 86400.0 - 1.0 / 24)::integer);
  if v_days < 2 then
    v_start := v_from;
    v_end   := v_to + interval '1 microsecond';
  else
    v_day_to := (v_to at time zone 'utc')::date;
    v_start  := (v_day_to - (v_days - 1))::timestamp at time zone 'utc';
    v_end    := (v_day_to + 1)::timestamp at time zone 'utc';
  end if;
  v_prev_start := v_start - (v_end - v_start);
  -- Whole UTC days with no topic or search read the daily rollups (00231);
  -- a window under two days, or a filter on the prompts, reads the answers'
  -- terms as before. The branch not taken is pruned (plan_cache_mode).
  v_rollup    := v_days >= 2 and p_topic_id is null and v_search is null;
  v_all       := v_rollup and p_platform is null and p_region is null;
  v_start_day := (v_start at time zone 'utc')::date;
  v_end_day   := (v_end at time zone 'utc')::date;
  v_prev_day  := (v_prev_start at time zone 'utc')::date;

  with
  prompts_in as (
    select p.id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  rows_in as (
    select t.result_id, t.entity, t.terms, (t.created_at >= v_start) as cur
    from public.mentions_answer_terms t
    join prompts_in pi on pi.id = t.prompt_id
    where not v_rollup
      and t.brand_id = p_brand_id
      and t.created_at >= v_prev_start
      and t.created_at < v_end
      and (p_platform is null or t.platform = p_platform)
      and (p_region is null or t.region = p_region)
  ),
  entity_counts as (
    select entity,
           count(*) filter (where cur)     as mentions,
           count(*) filter (where not cur) as prev_mentions
    from rows_in
    group by entity
    union all
    select d.entity,
           coalesce(sum(d.answers) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.answers) filter (where d.day < v_start_day), 0)
    from public.mentions_entities_daily d
    where v_rollup
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity
  ),
  shown as (
    select 'brand'::text as entity, 0 as rank
    union all
    select * from (
      select ec.entity, row_number() over (order by ec.mentions desc, ec.entity)::int
      from entity_counts ec
      join public.competitors co on co.id::text = ec.entity and co.brand_id = p_brand_id
      where ec.mentions > 0
      order by ec.mentions desc, ec.entity
      limit 4
    ) top_competitors
  ),
  -- The shown entities' terms in the window. The window before is read
  -- only for the brand's terms shown (brand_prev).
  term_counts_all as (
    select r.entity, term, count(*) as answers
    from rows_in r
    join shown s on s.entity = r.entity
    cross join lateral unnest(r.terms) as term
    where r.cur
    group by r.entity, term
    union all
    select d.entity, d.term, sum(d.answers)
    from public.mentions_terms_daily d
    join shown s on s.entity = d.entity
    where v_rollup
      and not v_all
      and d.brand_id = p_brand_id
      and d.day >= v_start_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity, d.term
    union all
    select d.entity, d.term, sum(d.answers)
    from public.mentions_terms_daily_all d
    join shown s on s.entity = d.entity
    where v_all
      and d.brand_id = p_brand_id
      and d.day >= v_start_day
      and d.day < v_end_day
    group by d.entity, d.term
  ),
  -- Each entity's 60 most frequent terms are the candidates.
  candidates as (
    select entity, term, answers
    from (
      select t.*, row_number() over (partition by t.entity order by t.answers desc, t.term) as rn
      from term_counts_all t
      where t.answers > 0
    ) ranked
    where rn <= 60
  ),
  -- A word that nearly always comes in one phrase is that phrase: "fresh" and
  -- "roast" give way to "fresh roast" when it has 80% of their answers.
  term_counts as (
    select c.*
    from candidates c
    where position(' ' in c.term) > 0
       or not exists (
         select 1 from candidates p
         where p.entity = c.entity
           and position(' ' in p.term) > 0
           and (p.term like c.term || ' %' or p.term like '% ' || c.term)
           and p.answers >= 0.8 * c.answers)
  ),
  brand_terms as (
    select term, answers
    from term_counts
    where entity = 'brand' and answers > 0
    order by answers desc, term
    limit 15
  ),
  -- Those terms' answers in the window before, for their trend.
  brand_prev as (
    select term, count(*) as prev_answers
    from rows_in r
    cross join lateral unnest(r.terms) as term
    where not r.cur
      and r.entity = 'brand'
      and term in (select bt.term from brand_terms bt)
    group by term
    union all
    select d.term, sum(d.answers)
    from public.mentions_terms_daily d
    where v_rollup
      and not v_all
      and d.brand_id = p_brand_id
      and d.entity = 'brand'
      and d.day >= v_prev_day
      and d.day < v_start_day
      and d.term in (select bt.term from brand_terms bt)
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.term
    union all
    -- Each of the 15 terms' own days (mentions_terms_daily_all_term).
    select d.term, sum(d.answers)
    from public.mentions_terms_daily_all d
    where v_all
      and d.brand_id = p_brand_id
      and d.entity = 'brand'
      and d.term in (select bt.term from brand_terms bt)
      and d.day >= v_prev_day
      and d.day < v_start_day
    group by d.term
  ),
  -- The terms that tell the brands apart most: the widest spread between the
  -- highest and lowest share of mentions, then the highest shares.
  attributes as (
    select u.term
    from (select distinct term from term_counts) u
    cross join shown s
    left join term_counts_all tc on tc.entity = s.entity and tc.term = u.term
    left join entity_counts ec on ec.entity = s.entity
    group by u.term
    order by
      max(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0))
        - min(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      sum(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      u.term
    limit 8
  ),
  -- A competitor's rows in answers that name the brand too, in one pass.
  co as (
    select x.entity,
           count(*) filter (where x.cur)     as co_mentions,
           count(*) filter (where not x.cur) as prev_co_mentions
    from (
      select r.entity, r.cur,
             bool_or(r.entity = 'brand') over (partition by r.result_id) as with_brand
      from rows_in r
    ) x
    where x.entity <> 'brand' and x.with_brand
    group by x.entity
    union all
    select d.entity,
           coalesce(sum(d.with_brand) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.with_brand) filter (where d.day < v_start_day), 0)
    from public.mentions_entities_daily d
    where v_rollup
      and d.entity <> 'brand'
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity
    having sum(d.with_brand) > 0
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', v_start, 'to', v_end, 'days', v_days),
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entity', s.entity,
               'name', case when s.entity = 'brand' then b.name else co.name end,
               'is_brand', s.entity = 'brand',
               'mentions', coalesce(ec.mentions, 0),
               'prev_mentions', coalesce(ec.prev_mentions, 0))
             order by s.rank)
      from shown s
      left join entity_counts ec on ec.entity = s.entity
      left join public.brands b on s.entity = 'brand' and b.id = p_brand_id
      left join public.competitors co on co.id::text = s.entity and co.brand_id = p_brand_id
    ), '[]'::jsonb),
    'brand_terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', bt.term, 'answers', bt.answers,
               'prev_answers', coalesce(bp.prev_answers, 0))
             order by bt.answers desc, bt.term)
      from brand_terms bt
      left join brand_prev bp on bp.term = bt.term
    ), '[]'::jsonb),
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', a.term,
               'values', (
                 select jsonb_agg(jsonb_build_object(
                          'entity', s.entity, 'answers', coalesce(tc.answers, 0))
                        order by s.rank)
                 from shown s
                 left join term_counts_all tc on tc.entity = s.entity and tc.term = a.term)))
      from attributes a
    ), '[]'::jsonb),
    'co_mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'competitor_id', c.entity,
               'name', comp.name,
               'co_mentions', c.co_mentions,
               'prev_co_mentions', c.prev_co_mentions)
             order by c.co_mentions desc, comp.name)
      from co c
      join public.competitors comp on comp.id::text = c.entity and comp.brand_id = p_brand_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.refresh_insights_daily(uuid, date, date)
  from public, anon, authenticated;
revoke execute on function public.refresh_mention_terms_daily(uuid, date, date)
  from public, anon, authenticated;
revoke all on function public.mentions_perception_live(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mentions_perception_live(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to service_role;

-- ── Backfill, from the rollups as they stand ───────────────────────────────

insert into public.topics_prompt_daily (
  brand_id, day, prompt_id, answer_count, mention_answers, citation_answers,
  mentioning_answers, total_mentions, total_citations, sum_inv_position,
  position_count, max_created_at)
select d.brand_id, d.day, d.prompt_id,
       sum(d.answer_count), sum(d.mention_answers), sum(d.citation_answers),
       sum(d.mentioning_answers), sum(d.total_mentions), sum(d.total_citations),
       sum(d.sum_inv_position), sum(d.position_count), max(d.max_created_at)
from public.insights_prompt_daily d
group by d.brand_id, d.day, d.prompt_id
on conflict do nothing;

insert into public.topics_competitor_daily (
  brand_id, day, prompt_id, competitor_id, mention_count)
select d.brand_id, d.day, d.prompt_id, d.competitor_id, sum(d.mention_count)
from public.insights_competitor_prompt_daily d
group by d.brand_id, d.day, d.prompt_id, d.competitor_id
on conflict do nothing;

insert into public.mentions_terms_daily_all (brand_id, entity, day, term, answers)
select d.brand_id, d.entity, d.day, d.term, sum(d.answers)
from public.mentions_terms_daily d
group by d.brand_id, d.entity, d.day, d.term
on conflict do nothing;

analyze public.topics_prompt_daily;
analyze public.topics_competitor_daily;
analyze public.mentions_terms_daily_all;
