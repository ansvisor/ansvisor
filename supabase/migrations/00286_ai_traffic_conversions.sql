-- ============================================================================
-- 00286: conversions from AI visits, as the AI Traffic snippet sees them (CE-017)
-- ============================================================================
-- The snippet counts AI-referred landings (ai_traffic_logs). With conversions
-- on, it also follows a visitor who came from an AI assistant through the
-- site to a goal (a signup, a demo form, an order…), so the Content Editor
-- can show what a page earns from AI visits, and the journeys that got there.
--
--   * Off by default, per brand (`conversions_enabled`). A brand that leaves
--     it off sends nothing new: the snippet keeps nothing in the browser, as
--     it always has.
--   * `conversions_consent`: 'wait' (default) keeps the visitor's id only once
--     the site says the visitor agreed (its consent banner, or Google Consent
--     Mode); 'always' keeps it at once, for sites whose own banner covers it.
--     The snippet reads it from its install tag; the server keeps it for the
--     Settings page.
--   * `ai_traffic_events`: a journey's pageviews and its conversions. One
--     visitor id per browser, random and first-party: never the IP address,
--     never a name or an email. Each row carries the first AI visit it is
--     credited to (first touch, within 30 days), so a journey reads without
--     joining the landing logs.
--   * `url` is the page without its query string or fragment: a thank-you
--     page's ?email=… never gets in.
--   * `order_ref`: an order's own id at the shop (Shopify's pixel), once per
--     brand, so an order the pixel sends twice counts once.
--   * Members read their brands' events; only the server writes them.

alter table public.brands
  add column if not exists conversions_enabled boolean not null default false,
  add column if not exists conversions_consent text not null default 'wait'
    check (conversions_consent in ('wait', 'always'));

comment on column public.brands.conversions_enabled is
  'CE-017 (00286): the AI Traffic snippet follows AI visitors to conversions (ai_traffic_events). Off by default.';
comment on column public.brands.conversions_consent is
  'CE-017 (00286): ''wait'' keeps the snippet''s visitor id only after the site''s consent, ''always'' at once.';

create table if not exists public.ai_traffic_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  visitor_id text not null check (visitor_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  kind text not null check (kind in ('page', 'conversion')),
  url text not null check (char_length(url) between 1 and 2048),
  goal text check (goal in ('signup', 'demo', 'order', 'booking', 'newsletter', 'custom')),
  -- The form's or the call's own name ("pricing-demo"), never what was typed in it.
  label text check (label is null or char_length(label) between 1 and 80),
  origin text check (origin in ('call', 'form', 'shopify')),
  value numeric(14, 2) check (value is null or value >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  units integer check (units is null or units between 0 and 100000),
  order_ref text check (order_ref is null or char_length(order_ref) between 1 and 128),
  first_source text not null check (char_length(first_source) between 1 and 64),
  first_url text not null check (char_length(first_url) between 1 and 2048),
  first_at timestamptz not null,
  occurred_at timestamptz not null default now(),
  -- A conversion says what it was and where it came from; a pageview neither.
  constraint ai_traffic_events_kind check (
    (kind = 'conversion' and goal is not null and origin is not null)
    or (kind = 'page' and goal is null and origin is null and order_ref is null)
  ),
  -- An order counts once however often it is sent (NULLs never clash).
  constraint ai_traffic_events_order unique (brand_id, order_ref)
);

create index if not exists ai_traffic_events_brand_time
  on public.ai_traffic_events (brand_id, occurred_at desc);
create index if not exists ai_traffic_events_journey
  on public.ai_traffic_events (brand_id, visitor_id, occurred_at);

alter table public.ai_traffic_events enable row level security;
revoke all on table public.ai_traffic_events from anon, authenticated;
grant select on table public.ai_traffic_events to authenticated;
grant all on table public.ai_traffic_events to service_role;

drop policy if exists "ai_traffic_events: member select" on public.ai_traffic_events;
create policy "ai_traffic_events: member select"
  on public.ai_traffic_events
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.ai_traffic_events is
  'CE-017 (00286): journeys of visitors who came from an AI assistant, as the AI Traffic snippet sends them with conversions on: pageviews and conversions (goal, value, units; Shopify orders once by order_ref), each credited to the first AI visit (first_source, first_url, first_at). A random first-party visitor id; no IP, name or email. Members read; the server writes.';

notify pgrst, 'reload schema';
