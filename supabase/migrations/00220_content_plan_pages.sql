-- ============================================================================
-- 00220: the brand's pages for the Content plan (Content Editor, CE-014)
-- ============================================================================
-- The Plan (spec v2 §4) answers what to work on first. Content Opportunities
-- name the new pages AI needs; this reads the brand's own pages, the way the
-- editor's Impact tab reads one (content_page_impact, 00209), so the Plan can
-- tell which to optimize, which to protect and which compete:
--
--   * citations {cur, prev}: AI answers' citations of the page over the last
--     p_days whole UTC days and the p_days before, ChatGPT Shopping left out
--     (as 00209);
--   * prompts: the tracked prompts citing it in the last p_days;
--   * platformsDown: the platforms citing it less than before, the biggest
--     drop first;
--   * aiVisits: AI-referred visits in the last p_days, by ai_traffic_merged's
--     rule (00176): the snippet's visits, and Analytics' sessions on days the
--     snippet has none;
--   * overlaps: how many of the brand's other pages are cited for at least
--     two of the same prompts in the last p_days (pages competing).
--
-- The 100 pages cited most over both periods. Security definer with an
-- organization check, as 00209; null outside the member's organization.

create or replace function public.content_plan_pages(
  p_brand_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_cur_day date;
  v_prev_day date;
  v_cur timestamptz;
  v_prev timestamptz;
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
  if p_days not in (7, 30) then
    raise exception 'p_days must be 7 or 30';
  end if;

  v_cur_day := v_today - p_days + 1;
  v_prev_day := v_cur_day - p_days;
  v_cur := v_cur_day::timestamp at time zone 'utc';
  v_prev := v_prev_day::timestamp at time zone 'utc';
  v_until := (v_today + 1)::timestamp at time zone 'utc';

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as (
    select cu.id, cu.url, cu.title, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  cites as (
    select
      u.page_key,
      u.url,
      u.title,
      pr.prompt_id,
      pr.platform,
      prc.created_at >= v_cur as is_cur
    from own_urls u
    join public.prompt_result_citations prc
      on prc.url_id = u.id
     and prc.brand_id = p_brand_id
     and prc.created_at >= v_prev
     and prc.created_at < v_until
    join public.prompt_results pr on pr.id = prc.prompt_result_id
    where pr.platform is distinct from 'chatgpt-shopping'
  ),
  pages as (
    select
      c.page_key,
      -- The address cited most often stands for the page.
      mode() within group (order by c.url) as page,
      max(c.title) as title,
      count(*) filter (where c.is_cur) as cur,
      count(*) filter (where not c.is_cur) as prev,
      count(distinct c.prompt_id) filter (where c.is_cur) as prompts
    from cites c
    group by c.page_key
    order by count(*) desc, c.page_key
    limit 100
  ),
  per_platform as (
    select
      c.page_key,
      c.platform,
      count(*) filter (where c.is_cur) as cur,
      count(*) filter (where not c.is_cur) as prev
    from cites c
    where c.page_key in (select p.page_key from pages p)
    group by c.page_key, c.platform
  ),
  down as (
    select
      pp.page_key,
      array_agg(pp.platform order by pp.prev - pp.cur desc, pp.platform) as platforms
    from per_platform pp
    where pp.prev > pp.cur and pp.platform is not null
    group by pp.page_key
  ),
  page_prompts as (
    select distinct c.page_key, c.prompt_id
    from cites c
    where c.is_cur and c.page_key in (select p.page_key from pages p)
  ),
  competing as (
    select a.page_key, b.page_key as other
    from page_prompts a
    join page_prompts b on b.prompt_id = a.prompt_id and b.page_key <> a.page_key
    group by a.page_key, b.page_key
    having count(*) >= 2
  ),
  page_overlaps as (
    select cm.page_key, count(*) as pages
    from competing cm
    group by cm.page_key
  ),
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_cur
      and l.created_at < v_until
  ),
  visits as (
    select lower(public.normalize_page_path(l.url)) as page_key, 1::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_cur
      and l.created_at < v_until
    union all
    select lower(public.normalize_page_path(g.landing_page)), g.sessions::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      -- A session without a landing page would read as the home page.
      and g.landing_page <> ''
      and g.date >= v_cur_day
      and g.date <= v_today
      and not exists (select 1 from snippet_days s where s.day = g.date)
  ),
  page_visits as (
    select v.page_key, sum(v.n) as visits
    from visits v
    where v.page_key in (select p.page_key from pages p)
    group by v.page_key
  )
  select jsonb_build_object(
    'days', p_days,
    'pages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'page', p.page,
          'title', p.title,
          'citations', jsonb_build_object('cur', p.cur, 'prev', p.prev),
          'prompts', p.prompts,
          'platformsDown', coalesce(to_jsonb(d.platforms[1:3]), '[]'::jsonb),
          'aiVisits', coalesce(pv.visits, 0),
          'overlaps', coalesce(o.pages, 0)
        )
        order by p.cur + p.prev desc, p.page
      )
      from pages p
      left join down d on d.page_key = p.page_key
      left join page_overlaps o on o.page_key = p.page_key
      left join page_visits pv on pv.page_key = p.page_key
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.content_plan_pages(uuid, integer) from public, anon;
grant execute on function public.content_plan_pages(uuid, integer) to authenticated, service_role;

comment on function public.content_plan_pages(uuid, integer) is
  'Content Editor (CE-014): the brand''s 100 most cited pages over the last N (7 or 30) whole UTC days and the N before: citations, citing prompts, platforms citing less, AI visits and how many of its other pages compete for the same prompts. Security definer with an organization check.';
