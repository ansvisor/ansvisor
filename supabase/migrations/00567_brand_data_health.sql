-- ============================================================================
-- 00567: Data health on Brand Visibility
-- ============================================================================
-- Insights gains a "Data health" card: per AI platform, how many answers the
-- brand's tracked prompts should have brought in over the page's window, how
-- many came in, how many are missing and when the last one landed. It shows
-- the data is complete, and that a missing day is a day not tracked, never a
-- day the brand wasn't mentioned. One read function only: no table, no index,
-- nothing backfilled.
--
--   * Expected: today's active prompts × each platform they run on
--     (prompts.platforms, the unit tracking slots are counted in, 00564) ×
--     their locations (one per region, one untargeted run when there are
--     none) × the window's days on or after the day the prompt was added
--     (UTC days). Waiting platforms (prompts.waiting_platforms) are never in
--     platforms, so they don't count; paused prompts don't either. A city
--     counts only on Google's engines, the only ones the worker asks from a
--     city (CITY_SCRAPERS in server/src/lib/locations.js). ChatGPT Shopping
--     is left out, as Insights leaves it out.
--   * Received: the expected prompt × platform × location × day cells that
--     have at least one answer, from the Insights rollup
--     (insights_prompt_daily). The unit is the expected one, so a run that
--     answered a cell twice still counts once and received never passes
--     expected.
--   * Today is still being tracked: its cells count once answered and never
--     as missing.
--   * Last answer: the newest answer of those cells in the window.
--
-- Security invoker, like the Insights reads beside it: RLS on prompts,
-- prompt_sets and the rollup decides whose brand this is. It reads the
-- rollup through its (brand_id, day) index.

create or replace function public.brand_data_health(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_region text default null,
  p_topic_id uuid default null
)
returns table (
  platform text,
  expected bigint,
  received bigint,
  last_answer_at timestamptz
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with active as (
    select p.id, p.regions, p.platforms,
           (p.created_at at time zone 'utc')::date as added_day
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and p.is_active
      and (p_topic_id is null or p.topic_id = p_topic_id)
  ),
  bounds as (
    -- All time starts on the day the oldest active prompt was added. The
    -- window never runs past today; complete_to is the last finished day.
    select coalesce(p_day_from, (select min(added_day) from active)) as day_from,
           least(coalesce(p_day_to, today), today) as day_to,
           least(coalesce(p_day_to, today), today - 1) as complete_to
    from (select (now() at time zone 'utc')::date as today) t
  ),
  cells as (
    -- One per prompt × platform × location, as the worker runs them.
    select a.id as prompt_id, pl.platform, loc.region,
           greatest(a.added_day, b.day_from) as first_day
    from active a
    cross join bounds b
    cross join lateral unnest(a.platforms) as pl(platform)
    cross join lateral (
      select r from unnest(a.regions) as r
      union all
      select null::text where coalesce(cardinality(a.regions), 0) = 0
    ) as loc(region)
    where pl.platform <> 'chatgpt-shopping'
      and (loc.region is null or strpos(loc.region, '~') = 0
           or pl.platform in ('google-aio', 'google-aimode'))
      and (p_region is null or loc.region = p_region)
      and a.added_day <= b.day_to
  ),
  answered as (
    -- One per prompt × platform × location × day with an answer.
    select d.prompt_id, d.platform, coalesce(d.region, '') as region, d.day,
           max(d.max_created_at) as last_at
    from public.insights_prompt_daily d
    cross join bounds b
    where d.brand_id = p_brand_id
      and d.day between b.day_from and b.day_to
      and (p_region is null or d.region = p_region)
      and d.answer_count > 0
    group by d.prompt_id, d.platform, coalesce(d.region, ''), d.day
  ),
  hits as (
    select c.platform, h.day, h.last_at
    from cells c
    join answered h
      on h.prompt_id = c.prompt_id
     and h.platform = c.platform
     and h.region = coalesce(c.region, '')
     and h.day >= c.first_day
  ),
  due as (
    -- Whole days due per platform, up to the last finished day.
    select c.platform,
           sum(greatest((select complete_to from bounds) - c.first_day + 1, 0))::bigint as days
    from cells c
    group by c.platform
  ),
  got as (
    select h.platform,
           count(*)::bigint as received,
           count(*) filter (where h.day > (select complete_to from bounds))::bigint as today,
           max(h.last_at) as last_at
    from hits h
    group by h.platform
  )
  select d.platform,
         d.days + coalesce(g.today, 0) as expected,
         coalesce(g.received, 0) as received,
         g.last_at as last_answer_at
  from due d
  left join got g on g.platform = d.platform
  order by d.platform;
$$;

revoke all on function public.brand_data_health(uuid, date, date, text, uuid) from public, anon;
grant execute on function public.brand_data_health(uuid, date, date, text, uuid)
  to authenticated, service_role;

comment on function public.brand_data_health(uuid, date, date, text, uuid) is
  'Data health on Insights (00567): per platform, the answers the active prompts should have brought in over the window (prompt × platform × location × UTC day on or after the day the prompt was added; today only once answered), how many of those cells were answered, and the last answer. Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
