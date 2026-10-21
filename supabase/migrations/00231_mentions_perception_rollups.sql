-- ============================================================================
-- 00231: the Perception tab reads daily rollups (Mentions & Sentiment, MS-09)
-- ============================================================================
-- mentions_perception (00161) read every answer's terms for the window and
-- the window before it, unnested per call: 30 days read 60 days of
-- mentions_answer_terms. On production the Perception tab's 30 and 90 days
-- failed on every try at the authenticated 8 s timeout (2026-10-21, the
-- Ansvisor brand; ~10 s cold at 30 days on the largest brand in #1124's
-- review). The terms are now counted once a day, when they are written:
--
--   * mentions_entities_daily: per brand, UTC day, platform and region, the
--     answers naming each entity ('brand' or a competitor's id), and how many
--     of those name the brand too. Exact: the tab's mention counts, its top
--     competitors and its co-mentions come from here.
--   * mentions_terms_daily: per brand, day, platform, region and entity, the
--     answers each term is next to, the day's 200 most frequent terms per
--     entity only. The tab lists each entity's 60 most frequent terms of a
--     window at most, which a day's 200 hold; a rarer term's count can come
--     out short on the days it missed them, the price of a bounded table.
--   * refresh_mention_terms_daily(brand, from, to) rebuilds a day range from
--     mentions_answer_terms. refresh_mention_terms (00161) calls it after
--     writing the same days' terms, in the same transaction; the server's
--     deleted-prompt rebuild calls it for the days a deleted prompt leaves
--     (its terms rows went with its answers). Service-role only.
--   * mentions_perception reads the rollups for whole UTC days (two days or
--     more) without a topic or a search; under two days, or filtered to some
--     prompts, it reads the answers' terms as before. Same jsonb, same rules.
--
-- The rollups are filled for every brand's history below, 14 days a call.

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.mentions_entities_daily (
  brand_id   uuid not null references public.brands(id) on delete cascade,
  day        date not null,
  platform   text not null,
  region     text,
  -- 'brand', or the competitor's id.
  entity     text not null,
  -- Answers naming it.
  answers    integer not null,
  -- Of those, answers naming the brand too.
  with_brand integer not null
);

create index if not exists idx_mentions_entities_daily_brand_day
  on public.mentions_entities_daily (brand_id, day);

create table if not exists public.mentions_terms_daily (
  brand_id uuid not null references public.brands(id) on delete cascade,
  day      date not null,
  platform text not null,
  region   text,
  entity   text not null,
  term     text not null,
  -- Answers whose sentences naming the entity hold the term.
  answers  integer not null
);

create index if not exists idx_mentions_terms_daily_brand_day
  on public.mentions_terms_daily (brand_id, day);

-- Read through mentions_perception (security definer) only.
alter table public.mentions_entities_daily enable row level security;
alter table public.mentions_terms_daily enable row level security;

comment on table public.mentions_entities_daily is
  'Mentions Perception (00231): per brand, UTC day, platform, region and entity, the answers naming it and those naming the brand too. Rebuilt from mentions_answer_terms by refresh_mention_terms_daily.';
comment on table public.mentions_terms_daily is
  'Mentions Perception (00231): per brand, UTC day, platform, region and entity, the answers next to each of its day''s 200 most frequent terms. Rebuilt from mentions_answer_terms by refresh_mention_terms_daily.';

-- ─── Refresh ────────────────────────────────────────────────────────────────

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

  delete from public.mentions_entities_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.mentions_terms_daily
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

  insert into public.mentions_terms_daily (
    brand_id, day, platform, region, entity, term, answers)
  select p_brand_id, r.day, r.platform, r.region, r.entity, r.term, r.answers
  from (
    select c.*,
           row_number() over (
             partition by c.day, c.platform, c.region, c.entity
             order by c.answers desc, c.term) as rn
    from (
      select (t.created_at at time zone 'utc')::date as day, t.platform, t.region, t.entity,
             term, count(*)::integer as answers
      from public.mentions_answer_terms t
      cross join lateral unnest(t.terms) as term
      where t.brand_id = p_brand_id
        and t.created_at >= v_from
        and t.created_at < v_to
      group by 1, 2, 3, 4, 5
    ) c
  ) r
  where r.rn <= 200;
end;
$$;

revoke execute on function public.refresh_mention_terms_daily(uuid, date, date)
  from public, anon, authenticated;

-- 00161's terms refresh, unchanged but for the rollups at its end.

create or replace function public.refresh_mention_terms(
  p_brand_id uuid,
  p_day_from date,
  p_day_to   date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  -- The range's bounds as instants, so the answers are found by range.
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  -- One refresh per brand at a time, as refresh_mentions_daily (00192): a
  -- run's refresh and the nightly sweep can cover the same days, and the
  -- second insert would fail on the (result_id, entity) key. The lock
  -- releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms:' || p_brand_id::text, 0));

  delete from public.mentions_answer_terms
    where brand_id = p_brand_id and created_at >= v_from and created_at < v_to;

  -- The terms next to each entity an answer names, matched by the same names
  -- tracking counts: the brand's name and domains, each competitor's name
  -- and domain.
  with brand_names as (
    select array_remove(array[b.name] || coalesce(
             (select array_agg(bd.domain) from public.brand_domains bd where bd.brand_id = b.id),
             '{}'), null) as names
    from public.brands b
    where b.id = p_brand_id
  ),
  competitor_names as (
    select c.id::text as entity, array_remove(array[c.name, nullif(c.domain, '')], null) as names
    from public.competitors c
    where c.brand_id = p_brand_id
  ),
  name_words as (
    select coalesce(array_agg(distinct w), '{}') as words
    from (
      select regexp_split_to_table(lower(n), '[^[:alnum:]-]+') as w
      from (
        select unnest(names) as n from brand_names
        union all
        select unnest(names) from competitor_names
      ) all_names
    ) split
    where w <> ''
  )
  insert into public.mentions_answer_terms (
    brand_id, result_id, created_at, prompt_id, platform, region, entity, terms)
  select
    p_brand_id, pr.id, pr.created_at, pr.prompt_id, pr.platform, pr.region, e.entity,
    public.mention_terms(
      pr.response,
      e.names,
      (select words from name_words) || regexp_split_to_array(lower(p.text), '[^[:alnum:]-]+'))
  from public.prompt_results pr
  join public.prompts p on p.id = pr.prompt_id
  cross join lateral (
    select 'brand'::text as entity, (select names from brand_names) as names
    where pr.mention_count > 0
    union all
    select cn.entity, cn.names
    from competitor_names cn
    where exists (
      select 1
      from jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
      where cm.value->>'competitor_id' = cn.entity
        and coalesce((cm.value->>'mention_count')::int, 0) > 0)
  ) e
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to;

  -- The Perception tab's daily rollups of the same days (00231), in the
  -- same transaction, so they never lag the terms.
  perform public.refresh_mention_terms_daily(p_brand_id, p_day_from, p_day_to);
end;
$$;

revoke execute on function public.refresh_mention_terms(uuid, date, date)
  from public, anon, authenticated;

-- ─── Read ───────────────────────────────────────────────────────────────────
-- 00161's read, the same jsonb; the rollups stand in for the answers' terms
-- for whole UTC days without a topic or a search.

create or replace function public.mentions_perception(
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
  v_start_day  date;
  v_end_day    date;
  v_prev_day   date;
  v_result     jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

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
  term_counts_all as (
    select r.entity, term,
           count(*) filter (where r.cur)     as answers,
           count(*) filter (where not r.cur) as prev_answers
    from rows_in r
    join shown s on s.entity = r.entity
    cross join lateral unnest(r.terms) as term
    group by r.entity, term
    union all
    select d.entity, d.term,
           coalesce(sum(d.answers) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.answers) filter (where d.day < v_start_day), 0)
    from public.mentions_terms_daily d
    join shown s on s.entity = d.entity
    where v_rollup
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity, d.term
  ),
  -- Each entity's 60 most frequent terms are the candidates.
  candidates as (
    select entity, term, answers, prev_answers
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
    select term, answers, prev_answers
    from term_counts
    where entity = 'brand' and answers > 0
    order by answers desc, term
    limit 15
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
               'term', bt.term, 'answers', bt.answers, 'prev_answers', bt.prev_answers)
             order by bt.answers desc, bt.term)
      from brand_terms bt
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

revoke execute on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon;
grant execute on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to authenticated, service_role;

-- ─── Fill every brand's history ─────────────────────────────────────────────

do $$
declare
  r record;
  d date;
begin
  for r in
    select t.brand_id,
           min((t.created_at at time zone 'utc')::date) as first_day,
           max((t.created_at at time zone 'utc')::date) as last_day
    from public.mentions_answer_terms t
    group by t.brand_id
  loop
    d := r.first_day;
    while d <= r.last_day loop
      perform public.refresh_mention_terms_daily(r.brand_id, d, least(d + 13, r.last_day));
      d := d + 14;
    end loop;
  end loop;
end;
$$;
