-- ============================================================================
-- 00520: AI-sourced contacts, deals and revenue from HubSpot (#2140)
-- ============================================================================
-- AI Traffic's "AI-sourced pipeline": which HubSpot contacts, deals and
-- revenue came from AI answers, by AI engine and landing page. A brand
-- connects HubSpot in Settings › Integrations (per brand, brand_integrations
-- provider 'hubspot'); the API server reads its HubSpot account once a day
-- (and on Sync now) into these tables, with the person's consent to mark
-- contacts. HubSpot stays the source: each sync replaces the brand's rows.
--
--   * hubspot_ai_contacts: the brand's AI-sourced contacts.
--       - origin 'ansvisor': marked by Ansvisor in HubSpot (the "Ansvisor"
--         properties: AI source, AI landing page, AI first visit, AI
--         converted), for this brand (its hidden brand id property).
--       - origin 'hubspot': HubSpot's own "AI Referrals" original traffic
--         source, whose first page is on one of the brand's domains, and
--         not marked by Ansvisor. Shown as a line of its own (owner,
--         2026-11-10).
--     Only HubSpot's ids, the AI source, the landing page and dates: never a
--     name or an email.
--   * hubspot_ai_deals: the deals of those contacts. A deal with several
--     contacts counts once, in full ("AI-influenced"), credited to its
--     earliest AI contact marked by Ansvisor, else its earliest HubSpot AI
--     Referrals contact (owner, 2026-11-10). `amount` is in the HubSpot
--     account's own currency (amount_in_home_currency, else amount).
--   * landing_key: the page's key as the other AI Traffic reads compare
--     pages (lower(normalize_page_path), 00209).
--   * Members read their brands' rows (user_brand_ids, 00388); only the
--     server writes them.
--
-- brand_ai_pipeline(brand, since, until) returns the section's figures as
-- one jsonb. Security definer for a person who can access the brand
-- (can_access_brand) and for the service role; anyone else reads null.
--   * contacts: AI-sourced contacts by when they converted (HubSpot's create
--     date for its own AI Referrals contacts), against the period before;
--   * deals: deals created in the range; won: deals closed won in the range,
--     with their revenue, against the period before; open: deals open now,
--     unweighted (owner, 2026-11-10);
--   * byEngine and byPage (top 10 pages) for Ansvisor's marked contacts;
--   * hubspotNative: the same totals for HubSpot's own AI Referrals contacts;
--   * connected, consent, currency and the last sync, from the brand's
--     HubSpot connection.

create table if not exists public.hubspot_ai_contacts (
  brand_id uuid not null
    constraint hubspot_ai_contacts_brand_id_fkey
    references public.brands(id) on delete cascade,
  contact_id text not null check (contact_id ~ '^[0-9]{1,20}$'),
  origin text not null check (origin in ('ansvisor', 'hubspot')),
  ai_source text not null check (char_length(ai_source) between 1 and 64),
  landing_url text check (landing_url is null or char_length(landing_url) between 1 and 2048),
  landing_key text generated always as (
    case when landing_url is null then null else lower(public.normalize_page_path(landing_url)) end
  ) stored,
  first_at timestamptz,
  converted_at timestamptz,
  hs_created_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (brand_id, contact_id)
);

create index if not exists hubspot_ai_contacts_brand_converted
  on public.hubspot_ai_contacts (brand_id, (coalesce(converted_at, hs_created_at)));

create table if not exists public.hubspot_ai_deals (
  brand_id uuid not null
    constraint hubspot_ai_deals_brand_id_fkey
    references public.brands(id) on delete cascade,
  deal_id text not null check (deal_id ~ '^[0-9]{1,20}$'),
  -- The AI contact the deal is credited to.
  contact_id text not null check (contact_id ~ '^[0-9]{1,20}$'),
  origin text not null check (origin in ('ansvisor', 'hubspot')),
  ai_source text not null check (char_length(ai_source) between 1 and 64),
  landing_url text check (landing_url is null or char_length(landing_url) between 1 and 2048),
  landing_key text generated always as (
    case when landing_url is null then null else lower(public.normalize_page_path(landing_url)) end
  ) stored,
  amount numeric(16, 2),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  is_closed boolean not null default false,
  is_won boolean not null default false,
  close_date timestamptz,
  hs_created_at timestamptz,
  synced_at timestamptz not null default now(),
  primary key (brand_id, deal_id)
);

create index if not exists hubspot_ai_deals_brand_close
  on public.hubspot_ai_deals (brand_id, close_date);

alter table public.hubspot_ai_contacts enable row level security;
revoke all on table public.hubspot_ai_contacts from anon, authenticated;
grant select on table public.hubspot_ai_contacts to authenticated;
grant all on table public.hubspot_ai_contacts to service_role;

drop policy if exists "hubspot_ai_contacts: member select" on public.hubspot_ai_contacts;
create policy "hubspot_ai_contacts: member select" on public.hubspot_ai_contacts
  for select
  to authenticated
  using (brand_id in (select public.user_brand_ids()));

alter table public.hubspot_ai_deals enable row level security;
revoke all on table public.hubspot_ai_deals from anon, authenticated;
grant select on table public.hubspot_ai_deals to authenticated;
grant all on table public.hubspot_ai_deals to service_role;

drop policy if exists "hubspot_ai_deals: member select" on public.hubspot_ai_deals;
create policy "hubspot_ai_deals: member select" on public.hubspot_ai_deals
  for select
  to authenticated
  using (brand_id in (select public.user_brand_ids()));

comment on table public.hubspot_ai_contacts is
  'AI-sourced pipeline (#2140, 00520): the brand''s HubSpot contacts from AI answers, as the daily sync reads them: marked by Ansvisor (origin ansvisor) or HubSpot''s own AI Referrals source on the brand''s domains (origin hubspot). HubSpot ids, AI source, landing page and dates only. Members read; the server writes.';
comment on table public.hubspot_ai_deals is
  'AI-sourced pipeline (#2140, 00520): the deals of the brand''s AI-sourced HubSpot contacts, each once, credited to its earliest Ansvisor-marked AI contact (else its earliest HubSpot AI Referrals one), with its amount in the HubSpot account''s currency. Members read; the server writes.';

create or replace function public.brand_ai_pipeline(
  p_brand_id uuid,
  p_since date,
  p_until date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_from timestamptz := coalesce(p_since::timestamp at time zone 'utc', '-infinity');
  v_until timestamptz := coalesce((p_until + 1)::timestamp at time zone 'utc', 'infinity');
  v_prev_from timestamptz;
  v_prev_until timestamptz;
  v_settings jsonb;
  v_connected boolean;
  v_result jsonb;
begin
  if not public.can_access_brand(p_brand_id)
    and auth.role() is distinct from 'service_role' then
    return null;
  end if;

  -- The period before, as long, when the range has both ends.
  if p_since is not null and p_until is not null then
    v_prev_until := v_from;
    v_prev_from := v_from - (v_until - v_from);
  end if;

  select bi.settings, a.status = 'connected'
  into v_settings, v_connected
  from public.brand_integrations bi
  join public.integration_accounts a on a.id = bi.account_id
  where bi.brand_id = p_brand_id
    and bi.provider = 'hubspot';

  with
  contacts as (
    select c.*, coalesce(c.converted_at, c.hs_created_at) as at
    from public.hubspot_ai_contacts c
    where c.brand_id = p_brand_id
  ),
  deals as (
    select d.* from public.hubspot_ai_deals d where d.brand_id = p_brand_id
  ),
  -- Each figure as a row: what it counts, its engine and page, and its amount.
  facts as (
    select origin, 'contact' as kind, ai_source, landing_key, landing_url, null::numeric as amount
    from contacts where at >= v_from and at < v_until
    union all
    select origin, 'deal', ai_source, landing_key, landing_url, null
    from deals where hs_created_at >= v_from and hs_created_at < v_until
    union all
    select origin, 'won', ai_source, landing_key, landing_url, coalesce(amount, 0)
    from deals where is_won and close_date >= v_from and close_date < v_until
    union all
    select origin, 'open', ai_source, landing_key, landing_url, coalesce(amount, 0)
    from deals where not is_closed
  ),
  totals as (
    select
      origin,
      count(*) filter (where kind = 'contact') as contacts,
      count(*) filter (where kind = 'deal') as deals,
      count(*) filter (where kind = 'won') as won_deals,
      coalesce(sum(amount) filter (where kind = 'won'), 0) as won_revenue,
      count(*) filter (where kind = 'open') as open_deals,
      coalesce(sum(amount) filter (where kind = 'open'), 0) as open_pipeline
    from facts
    group by origin
  ),
  previous as (
    select
      (select count(*) from contacts
        where origin = 'ansvisor' and at >= v_prev_from and at < v_prev_until) as contacts,
      (select coalesce(sum(amount), 0) from deals
        where origin = 'ansvisor' and is_won
          and close_date >= v_prev_from and close_date < v_prev_until) as won_revenue
  ),
  engines as (
    select
      ai_source as source,
      count(*) filter (where kind = 'contact') as contacts,
      count(*) filter (where kind = 'deal') as deals,
      count(*) filter (where kind = 'won') as won_deals,
      coalesce(sum(amount) filter (where kind = 'won'), 0) as won_revenue,
      coalesce(sum(amount) filter (where kind = 'open'), 0) as open_pipeline
    from facts
    where origin = 'ansvisor'
    group by ai_source
  ),
  pages as (
    select
      landing_key,
      min(landing_url) as page,
      count(*) filter (where kind = 'contact') as contacts,
      count(*) filter (where kind = 'deal') as deals,
      coalesce(sum(amount) filter (where kind = 'won'), 0) as won_revenue,
      mode() within group (order by ai_source) filter (where kind = 'contact') as top_source
    from facts
    where origin = 'ansvisor' and landing_key is not null
    group by landing_key
  ),
  shown_pages as (
    select * from pages
    order by won_revenue desc, contacts desc, deals desc, landing_key
    limit 10
  )
  select jsonb_build_object(
    'connected', coalesce(v_connected, false),
    'contactsConsent', coalesce((v_settings -> 'consent' ->> 'contacts')::boolean, false),
    'currency', v_settings -> 'portal' ->> 'currency',
    'syncedAt', v_settings -> 'sync' ->> 'at',
    'syncError', v_settings -> 'sync' ->> 'error',
    'totals', (
      select jsonb_build_object(
        'contacts', coalesce(t.contacts, 0),
        'contactsPrev', case when v_prev_from is null then null else p.contacts end,
        'deals', coalesce(t.deals, 0),
        'wonDeals', coalesce(t.won_deals, 0),
        'wonRevenue', coalesce(t.won_revenue, 0),
        'wonRevenuePrev', case when v_prev_from is null then null else p.won_revenue end,
        'openDeals', coalesce(t.open_deals, 0),
        'openPipeline', coalesce(t.open_pipeline, 0)
      )
      from previous p
      left join totals t on t.origin = 'ansvisor'
    ),
    'byEngine', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', e.source,
        'contacts', e.contacts,
        'deals', e.deals,
        'wonDeals', e.won_deals,
        'wonRevenue', e.won_revenue,
        'openPipeline', e.open_pipeline
      ) order by e.won_revenue desc, e.contacts desc, e.source)
      from engines e
    ), '[]'::jsonb),
    'byPage', coalesce((
      select jsonb_agg(jsonb_build_object(
        'page', s.page,
        'contacts', s.contacts,
        'deals', s.deals,
        'wonRevenue', s.won_revenue,
        'topSource', s.top_source
      ) order by s.won_revenue desc, s.contacts desc, s.deals desc, s.landing_key)
      from shown_pages s
    ), '[]'::jsonb),
    'hubspotNative', (
      select jsonb_build_object(
        'contacts', coalesce(t.contacts, 0),
        'deals', coalesce(t.deals, 0),
        'wonRevenue', coalesce(t.won_revenue, 0)
      )
      from (select 1) one
      left join totals t on t.origin = 'hubspot'
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.brand_ai_pipeline(uuid, date, date) from public, anon;
grant execute on function public.brand_ai_pipeline(uuid, date, date) to authenticated, service_role;

comment on function public.brand_ai_pipeline(uuid, date, date) is
  'AI Traffic "AI-sourced pipeline" (#2140, 00520): the brand''s AI-sourced HubSpot contacts (by conversion), deals (created), won revenue (closed won in the range) against the period before, and open pipeline now, unweighted; by AI engine and top landing page for Ansvisor-marked contacts, and HubSpot''s own AI Referrals contacts apart; with the connection''s state and last sync. Security definer, for a person who can access the brand (can_access_brand) and for the service role; anyone else reads null.';

notify pgrst, 'reload schema';
