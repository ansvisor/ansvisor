-- ============================================================================
-- 00561: Ads' search-term totals for a date range (Phase 1, P2)
-- ============================================================================
-- Function only: no table changes and no rows written, so it applies in
-- seconds.
--
-- The Overlap view (lib/ads/paid.js) matches the Google search terms a brand
-- paid for to its tracked prompts. Each term's days are summed here, so the
-- server reads one row per term and account instead of one per day and
-- campaign. Only terms that cost something come back: a term without cost
-- tells nothing about what the brand pays.
--
-- The server passes only ad accounts of the brand it has checked against the
-- caller's organization. The function runs as its caller (security invoker),
-- and only the service role may call it, like the tables it reads (00560).

create or replace function public.ads_search_term_totals(
  p_account_ids uuid[],
  p_from date,
  p_to date
)
returns table (
  account_id uuid,
  search_term text,
  impressions bigint,
  clicks bigint,
  cost_micros bigint,
  conversions numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    d.account_id,
    d.search_term,
    sum(d.impressions)::bigint,
    sum(d.clicks)::bigint,
    sum(d.cost_micros)::bigint,
    sum(d.conversions)
  from public.ads_search_term_daily d
  where d.account_id = any (p_account_ids)
    and d.day between p_from and p_to
  group by d.account_id, d.search_term
  having sum(d.cost_micros) > 0
  order by d.account_id, d.search_term;
$$;

comment on function public.ads_search_term_totals(uuid[], date, date) is
  'Ads Phase 1 (00561): each Google search term''s impressions, clicks, cost and conversions over a date range, per account, for terms that cost something. Service role only.';

revoke all on function public.ads_search_term_totals(uuid[], date, date) from public, anon, authenticated;
grant execute on function public.ads_search_term_totals(uuid[], date, date) to service_role;

notify pgrst, 'reload schema';
