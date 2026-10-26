-- ============================================================================
-- 00288: the brand's conversions from AI journeys, for the Content plan's strip
-- ============================================================================
-- The Content plan's AI results strip (spec v2 §4 point 8, CE-014) says what
-- AI visits brought in: "48 signups · 20 demo forms · 10 orders", and the top
-- journey. With conversions on (00286), the AI Traffic snippet's journeys
-- give it the goals (CE-017), beside Google Analytics' key events.
--
-- brand_ai_conversions(brand, days) returns one jsonb over the last 7, 30 or
-- 90 whole UTC days, ending yesterday, as content_plan_insights (00226):
--   * enabled: whether the brand has conversions on;
--   * goals: per goal, its conversions, the most first;
--   * journey: the most frequent journey to a conversion (the latest first
--     among as many), its source, pages and goal, as content_page_conversions
--     (00287) builds them, and how many; null without one.
--
-- Security definer with an organization check, as content_plan_insights.

create or replace function public.brand_ai_conversions(
  p_brand_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_last date := (now() at time zone 'utc')::date - 1;
  v_from timestamptz;
  v_until timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days not in (7, 30, 90) then
    raise exception 'p_days must be 7, 30 or 90';
  end if;

  v_from := (v_last - p_days + 1)::timestamp at time zone 'utc';
  v_until := (v_last + 1)::timestamp at time zone 'utc';

  with conversions as (
    select c.*
    from public.ai_traffic_events c
    where c.brand_id = p_brand_id
      and c.kind = 'conversion'
      and c.occurred_at >= v_from
      and c.occurred_at < v_until
  ),
  paths as (
    select t.first_source, t.goal, t.occurred_at, (
      select array_agg(s.page order by s.ord <> 0, s.at, s.ord)
      from (
        select steps.page, steps.at, steps.ord,
          lag(steps.page) over (order by steps.ord <> 0, steps.at, steps.ord) as before
        from (
          select lower(public.normalize_page_path(t.first_url)) as page, t.first_at as at, 0 as ord
          union all
          select lower(public.normalize_page_path(p.url)), p.occurred_at, 1
          from public.ai_traffic_events p
          where p.brand_id = p_brand_id
            and p.visitor_id = t.visitor_id
            and p.kind = 'page'
            and p.occurred_at <= t.occurred_at
          union all
          select lower(public.normalize_page_path(t.url)), t.occurred_at, 2
        ) steps
      ) s
      where s.before is distinct from s.page
    ) as pages
    from conversions t
  )
  select jsonb_build_object(
    'enabled', coalesce((select b.conversions_enabled from public.brands b where b.id = p_brand_id), false),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('goal', g.goal, 'count', g.n) order by g.n desc, g.goal)
      from (select goal, count(*)::bigint as n from conversions group by goal) g
    ), '[]'::jsonb),
    'journey', (
      select jsonb_build_object('source', j.first_source, 'pages', to_jsonb(j.pages),
        'goal', j.goal, 'count', j.n)
      from (
        select first_source, pages, goal, count(*)::bigint as n
        from paths
        group by first_source, pages, goal
        order by count(*) desc, max(occurred_at) desc, first_source, goal
        limit 1
      ) j
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.brand_ai_conversions(uuid, integer) from public, anon;
grant execute on function public.brand_ai_conversions(uuid, integer)
  to authenticated, service_role;

comment on function public.brand_ai_conversions(uuid, integer) is
  'Content plan (CE-017, 00288): the brand''s conversions from AI journeys over the last 7, 30 or 90 whole UTC days (ending yesterday), from the AI Traffic snippet (ai_traffic_events, 00286): per goal, and the most frequent journey (source, pages, goal, count). Security definer with an organization check.';
