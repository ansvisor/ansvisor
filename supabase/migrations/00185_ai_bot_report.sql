-- ============================================================================
-- 00185: the AI bot report (AT-011)
-- ============================================================================
-- Spec §3.7, "AI bots reading your site": the verified AI-bot requests a
-- brand's Cloudflare or Vercel sent (00183), read from the bot × page × day
-- counters, which hold every request even past the month's cap:
--
--   * types — training crawlers, search crawlers and user fetches, reported
--     separately: hits, pages read and when last seen, with the bots seen;
--   * bots — the same per bot;
--   * pages — the most read pages, with when each type last read them (the
--     per-page last crawl);
--   * uncrawled — the alert "cited pages not read by any search bot in 30
--     days": pages tracked AI answers cited in the last 30 days that no
--     search crawler read in them. It needs 30 days of bot data to mean
--     anything, so until the first request is 30 days old it is null and
--     the result says when it starts.
--
-- Pages are keyed as the Pages section keys them (00178). citation_urls has
-- no member select policy, so this runs as its owner after checking the
-- caller belongs to the brand's organization; a caller from elsewhere gets
-- nothing.

create or replace function public.ai_bot_report(
  p_brand_id uuid,
  p_since date,
  p_until date,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_first date;
  v_last timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
    return null;
  end if;

  select min(d.day), max(d.last_seen) into v_first, v_last
  from public.ai_bot_daily d
  where d.brand_id = p_brand_id;

  with d as (
    select *
    from public.ai_bot_daily d
    where d.brand_id = p_brand_id
      and d.day >= coalesce(p_since, '-infinity'::date)
      and d.day <= p_until
  ),
  types as (
    select
      d.bot_type,
      sum(d.hits)::bigint as hits,
      count(distinct d.page)::bigint as pages,
      max(d.last_seen) as last_seen,
      array_agg(distinct d.bot order by d.bot) as bots
    from d
    group by d.bot_type
  ),
  bots as (
    select
      d.bot,
      min(d.bot_type) as bot_type,
      sum(d.hits)::bigint as hits,
      count(distinct d.page)::bigint as pages,
      max(d.last_seen) as last_seen
    from d
    group by d.bot
  ),
  pages as (
    select
      d.page,
      sum(d.hits)::bigint as hits,
      max(d.last_seen) filter (where d.bot_type = 'training') as training_last,
      max(d.last_seen) filter (where d.bot_type = 'search') as search_last,
      max(d.last_seen) filter (where d.bot_type = 'user') as user_last
    from d
    group by d.page
  ),
  -- The alert reads its own 30 days, whatever the range.
  searched as (
    select distinct d.page
    from public.ai_bot_daily d
    where d.brand_id = p_brand_id
      and d.bot_type = 'search'
      and d.day >= current_date - 29
  ),
  uncrawled as (
    select c.page, c.citations
    from public.ai_traffic_page_citations(p_brand_id, current_date - 29, current_date) c
    where c.page_key not in (select s.page from searched s)
  )
  select jsonb_build_object(
    'first_day', v_first,
    'last_seen', v_last,
    'types', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type', t.bot_type, 'hits', t.hits, 'pages', t.pages,
          'last_seen', t.last_seen, 'bots', to_jsonb(t.bots)
        )
        order by array_position(array['training', 'search', 'user'], t.bot_type)
      )
      from types t
    ), '[]'::jsonb),
    'bots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bot', b.bot, 'type', b.bot_type, 'hits', b.hits, 'pages', b.pages,
          'last_seen', b.last_seen
        )
        order by b.hits desc, b.bot
      )
      from bots b
    ), '[]'::jsonb),
    'page_count', (select count(*) from pages),
    'pages', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.hits desc, p.page)
      from (select * from pages order by hits desc, page limit p_limit) p
    ), '[]'::jsonb),
    -- Null until the first request is 30 days old.
    'uncrawled_count', case
      when v_first <= current_date - 29 then (select count(*) from uncrawled)
    end,
    'uncrawled', case
      when v_first <= current_date - 29 then coalesce((
        select jsonb_agg(to_jsonb(u) order by u.citations desc, u.page)
        from (select * from uncrawled order by citations desc, page limit 10) u
      ), '[]'::jsonb)
    end,
    'alert_from', case when v_first is not null then v_first + 29 end
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.ai_bot_report(uuid, date, date, integer) from public, anon;
grant execute on function public.ai_bot_report(uuid, date, date, integer)
  to authenticated, service_role;

comment on function public.ai_bot_report(uuid, date, date, integer) is
  'AI Traffic "AI bots reading your site" (AT-011, spec §3.7): verified AI-bot hits between two days by type (training, search, user) and by bot, the most read pages with each type''s last read, and the cited pages no search bot read in the last 30 days (null until 30 days of bot data). Security definer with an organization check.';

notify pgrst, 'reload schema';
