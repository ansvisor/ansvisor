-- ============================================================================
-- 00209: what a page earns, for the editor's Impact tab (Content Editor, CE-016)
-- ============================================================================
-- The Impact tab (Content Editor spec v2 §7) shows, for the page a draft
-- optimizes, the last N days against the N days before: citations, AI
-- visits, Google clicks and the prompts that cite it, with the ones it lost.
--
-- content_page_impact(brand, page, days) returns one jsonb:
--   * citations {cur, prev}: tracked answers citing the page, on the brand's
--     own domains (citation_urls' domain index first, as ga_page_ai_visibility
--     does); ChatGPT Shopping cards left out, as the Citations page does;
--   * aiVisits {cur, prev}: AI-referred visits, by ai_traffic_merged's (00176)
--     rule: the snippet on days it was active for the brand, Google Analytics
--     on other days, never both;
--   * gscClicks {cur, prev} and gscSince, the first day of Search Console page
--     data the brand has (null without any): page stats are kept 190 days, so
--     a window starting earlier is incomplete and the caller says so;
--   * prompts: each prompt that cited the page in either window, with its
--     citations and platforms in each, the most cited first (at most 100);
--   * overlap: the brand's other pages cited in this window for the prompts
--     citing this one, with how many of them (at most 3): pages competing
--     with it for the same answers.
-- A page is one lower(normalize_page_path) key, so /x/ and /x?utm_source=…
-- are one page. Windows are whole UTC days, today included.
--
-- Security definer with an organization check, as ai_traffic_page_citations
-- (00176): citation_urls has no member select policy.

create or replace function public.content_page_impact(
  p_brand_id uuid,
  p_page text,
  p_days integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_key text := lower(public.normalize_page_path(p_page));
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
  if p_days is null or p_days < 1 or p_days > 366 or p_page is null then
    raise exception 'content_page_impact: a page and 1 to 366 days are needed'
      using errcode = '22023';
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
  own_all as (
    select cu.id, cu.url, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  own_urls as (
    select o.id from own_all o where o.page_key = v_key
  ),
  cites as (
    select pr.prompt_id, pr.platform, prc.created_at >= v_cur as is_cur
    from own_urls u
    join public.prompt_result_citations prc
      on prc.url_id = u.id
     and prc.brand_id = p_brand_id
     and prc.created_at >= v_prev
     and prc.created_at < v_until
    join public.prompt_results pr on pr.id = prc.prompt_result_id
    where pr.platform is distinct from 'chatgpt-shopping'
  ),
  per_prompt as (
    select
      c.prompt_id,
      count(*) filter (where c.is_cur) as cur,
      count(*) filter (where not c.is_cur) as prev,
      coalesce(array_agg(distinct c.platform) filter (where c.is_cur), '{}') as cur_platforms,
      coalesce(array_agg(distinct c.platform) filter (where not c.is_cur), '{}') as prev_platforms
    from cites c
    group by c.prompt_id
  ),
  other_pages as (
    select o.page_key, min(o.url) as page, count(distinct pr.prompt_id) as prompts
    from own_all o
    join public.prompt_result_citations prc
      on prc.url_id = o.id
     and prc.brand_id = p_brand_id
     and prc.created_at >= v_cur
     and prc.created_at < v_until
    join public.prompt_results pr on pr.id = prc.prompt_result_id
    where o.page_key <> v_key
      and pr.prompt_id in (select pp.prompt_id from per_prompt pp where pp.cur > 0)
    group by o.page_key
  ),
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_prev
      and l.created_at < v_until
  ),
  visits as (
    select l.created_at >= v_cur as is_cur, 1::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_prev
      and l.created_at < v_until
      and lower(public.normalize_page_path(l.url)) = v_key
    union all
    select g.date >= v_cur_day, g.sessions::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      and g.date >= v_prev_day
      and g.date <= v_today
      and lower(public.normalize_page_path(g.landing_page)) = v_key
      and not exists (select 1 from snippet_days s where s.day = g.date)
  ),
  clicks as (
    select g.date >= v_cur_day as is_cur, g.clicks::bigint as n
    from public.gsc_page_stats g
    where g.brand_id = p_brand_id
      and g.page_key = v_key
      and g.date >= v_prev_day
      and g.date <= v_today
  )
  select jsonb_build_object(
    'citations', (
      select jsonb_build_object('cur', coalesce(sum(cur), 0), 'prev', coalesce(sum(prev), 0))
      from per_prompt
    ),
    'aiVisits', (
      select jsonb_build_object(
        'cur', coalesce(sum(n) filter (where is_cur), 0),
        'prev', coalesce(sum(n) filter (where not is_cur), 0)
      )
      from visits
    ),
    'gscClicks', (
      select jsonb_build_object(
        'cur', coalesce(sum(n) filter (where is_cur), 0),
        'prev', coalesce(sum(n) filter (where not is_cur), 0)
      )
      from clicks
    ),
    'gscSince', (select min(g.date) from public.gsc_page_stats g where g.brand_id = p_brand_id),
    'overlap', coalesce((
      select jsonb_agg(jsonb_build_object('page', op.page, 'prompts', op.prompts)
        order by op.prompts desc, op.page)
      from (select * from other_pages order by prompts desc, page limit 3) op
    ), '[]'::jsonb),
    'prompts', coalesce((
      select jsonb_agg(row order by (row->>'cur')::int desc, (row->>'prev')::int desc, row->>'text')
      from (
        select jsonb_build_object(
          'id', pp.prompt_id,
          'text', p.text,
          'cur', pp.cur,
          'prev', pp.prev,
          'curPlatforms', to_jsonb(pp.cur_platforms),
          'prevPlatforms', to_jsonb(pp.prev_platforms)
        ) as row
        from per_prompt pp
        join public.prompts p on p.id = pp.prompt_id
        order by pp.cur desc, pp.prev desc
        limit 100
      ) t
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.content_page_impact(uuid, text, integer) from public, anon;
grant execute on function public.content_page_impact(uuid, text, integer)
  to authenticated, service_role;

comment on function public.content_page_impact(uuid, text, integer) is
  'Content Editor (CE-016): one page''s citations, AI visits, Google clicks and citing prompts over the last N whole UTC days and the N before. Security definer with an organization check.';
