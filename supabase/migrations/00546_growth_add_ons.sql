-- ============================================================================
-- 00546: Growth add-ons — extra tracking, extra brands, AI top-ups
-- ============================================================================
-- "Growth ek paketleri ve Enterprise fiyatları" (18 Nov 2026). Growth's
-- Admins buy more room on their plan; nothing here sells yet, it is where the
-- catalog and what was bought are kept. Schema and a few seed rows only.
--
--   * add_on_products takes three new kinds beside CHAT-18's ai/storage packs:
--       - tracking: one tier on the plan's subscription (+100 … +10,000
--         prompt locations), monthly or yearly (10 × monthly); grant_prompts.
--       - brand: per brand, sold by quantity, monthly or yearly; grant_brands.
--       - ai_topup: one payment, valid until the next renewal (valid_months
--         null), adding grant_ai_usd of model cost, grant_briefs and
--         grant_opportunities; multiplier is its "+Nx".
--     stripe_lookup_key names the Stripe price (the same keys in live and in
--     a sandbox); the server resolves it into stripe_price_id, so no live
--     price id is in this repository. sale = 'contact_sales' shows the row
--     but never sells it (+5,000 and +10,000 until their capacity is
--     confirmed); staff flip it without a release. plans is who may buy;
--     null for CHAT-18's packs, which any paid plan could buy.
--     00413's unnamed kind checks are replaced by named ones per kind.
--   * organizations.add_on_prompts / add_on_brands: what the plan's
--     subscription adds today, a mirror of its add-on items written by the
--     Stripe webhook and the billing actions. Server only, guarded like
--     00386's column.
--   * usage_top_ups: what a paid AI top-up adds to the current quota window
--     (AI dollars, briefs, opportunities); refunded_at takes it away. Server
--     only, like ai_credit_grants.

-- ─── The catalog ────────────────────────────────────────────────────────────

alter table public.add_on_products
  add column if not exists stripe_lookup_key text unique
    check (stripe_lookup_key ~ '^[a-z][a-z0-9_]{1,99}$'),
  add column if not exists grant_prompts integer check (grant_prompts > 0),
  add column if not exists grant_brands integer check (grant_brands > 0),
  add column if not exists grant_briefs integer check (grant_briefs > 0),
  add column if not exists grant_opportunities integer check (grant_opportunities > 0),
  add column if not exists multiplier smallint check (multiplier > 0),
  add column if not exists sale text not null default 'self_serve'
    check (sale in ('self_serve', 'contact_sales')),
  add column if not exists plans text[]
    check (
      cardinality(plans) > 0
      and plans <@ array['starter', 'growth', 'enterprise']::text[]
    );

-- 00413's kind and billing checks have no names (their names depend on the
-- order Postgres gave them): drop every check that reads kind or billing,
-- then add them back by name with the new kinds. Running it again drops and
-- adds the named ones the same way.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_catalog.pg_constraint
    where conrelid = 'public.add_on_products'::regclass
      and contype = 'c'
      and pg_catalog.pg_get_constraintdef(oid) ~ '\m(kind|billing)\M'
  loop
    execute format('alter table public.add_on_products drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.add_on_products
  add constraint add_on_products_kind_check
    check (kind in ('ai', 'storage', 'tracking', 'brand', 'ai_topup')),
  add constraint add_on_products_billing_check
    check (billing in ('one_time', 'monthly', 'yearly')),
  -- Each grant belongs to its kinds, and each kind carries its grant.
  add constraint add_on_products_ai_usd_check
    check ((kind in ('ai', 'ai_topup')) = (grant_ai_usd is not null)),
  add constraint add_on_products_bytes_check
    check ((kind = 'storage') = (grant_bytes is not null)),
  add constraint add_on_products_prompts_check
    check ((kind = 'tracking') = (grant_prompts is not null)),
  add constraint add_on_products_brands_check
    check ((kind = 'brand') = (grant_brands is not null)),
  add constraint add_on_products_top_up_check
    check (
      (kind = 'ai_topup') = (grant_briefs is not null)
      and (kind = 'ai_topup') = (grant_opportunities is not null)
      and (kind = 'ai_topup') = (multiplier is not null)
    ),
  -- How each kind is paid.
  add constraint add_on_products_ai_billing_check
    check (kind <> 'ai' or (billing = 'one_time' and valid_months is not null)),
  add constraint add_on_products_storage_billing_check
    check (kind <> 'storage' or (billing = 'monthly' and valid_months is null)),
  add constraint add_on_products_recurring_billing_check
    check (
      kind not in ('tracking', 'brand')
      or (billing in ('monthly', 'yearly') and valid_months is null)
    ),
  add constraint add_on_products_top_up_billing_check
    check (kind <> 'ai_topup' or (billing = 'one_time' and valid_months is null));

comment on table public.add_on_products is
  'Add-ons on sale: CHAT-18 packs (ai, storage) and Growth add-ons (00546: tracking tiers, brands by quantity, one-time AI top-ups). Staff-edited; stripe_lookup_key names the Stripe price, stripe_price_id is resolved from it per deployment, a row without one isn''t sold; sale = contact_sales is shown, never sold. Server only.';
comment on column public.add_on_products.stripe_lookup_key is
  'The Stripe price''s lookup key (the same in live and in a sandbox); the server resolves it into stripe_price_id (00546).';
comment on column public.add_on_products.sale is
  'self_serve: bought in the product. contact_sales: shown with "Contact sales", never sold (00546).';
comment on column public.add_on_products.plans is
  'The plans that may buy it; null: any paid plan (CHAT-18''s packs) (00546).';

-- The Growth add-ons (owner's prices, 18 Nov 2026; yearly = 10 × monthly).
-- +5,000 and +10,000 are Contact sales until their capacity is confirmed.
-- Run again, it leaves them as staff may have changed them.
insert into public.add_on_products
  (id, kind, name, price_cents, billing, grant_prompts, grant_brands, grant_ai_usd,
   grant_briefs, grant_opportunities, multiplier, valid_months, stripe_lookup_key,
   sale, plans, sort)
values
  ('tracking_100_month', 'tracking', 'Extra tracking +100', 7500, 'monthly', 100, null, null, null, null, null, null, 'addon_tracking_100_month', 'self_serve', '{growth}', 1),
  ('tracking_250_month', 'tracking', 'Extra tracking +250', 17900, 'monthly', 250, null, null, null, null, null, null, 'addon_tracking_250_month', 'self_serve', '{growth}', 2),
  ('tracking_500_month', 'tracking', 'Extra tracking +500', 34500, 'monthly', 500, null, null, null, null, null, null, 'addon_tracking_500_month', 'self_serve', '{growth}', 3),
  ('tracking_1000_month', 'tracking', 'Extra tracking +1,000', 65900, 'monthly', 1000, null, null, null, null, null, null, 'addon_tracking_1000_month', 'self_serve', '{growth}', 4),
  ('tracking_2500_month', 'tracking', 'Extra tracking +2,500', 154900, 'monthly', 2500, null, null, null, null, null, null, 'addon_tracking_2500_month', 'self_serve', '{growth}', 5),
  ('tracking_5000_month', 'tracking', 'Extra tracking +5,000', 289900, 'monthly', 5000, null, null, null, null, null, null, 'addon_tracking_5000_month', 'contact_sales', '{growth}', 6),
  ('tracking_10000_month', 'tracking', 'Extra tracking +10,000', 539900, 'monthly', 10000, null, null, null, null, null, null, 'addon_tracking_10000_month', 'contact_sales', '{growth}', 7),
  ('tracking_100_year', 'tracking', 'Extra tracking +100', 75000, 'yearly', 100, null, null, null, null, null, null, 'addon_tracking_100_year', 'self_serve', '{growth}', 1),
  ('tracking_250_year', 'tracking', 'Extra tracking +250', 179000, 'yearly', 250, null, null, null, null, null, null, 'addon_tracking_250_year', 'self_serve', '{growth}', 2),
  ('tracking_500_year', 'tracking', 'Extra tracking +500', 345000, 'yearly', 500, null, null, null, null, null, null, 'addon_tracking_500_year', 'self_serve', '{growth}', 3),
  ('tracking_1000_year', 'tracking', 'Extra tracking +1,000', 659000, 'yearly', 1000, null, null, null, null, null, null, 'addon_tracking_1000_year', 'self_serve', '{growth}', 4),
  ('tracking_2500_year', 'tracking', 'Extra tracking +2,500', 1549000, 'yearly', 2500, null, null, null, null, null, null, 'addon_tracking_2500_year', 'self_serve', '{growth}', 5),
  ('tracking_5000_year', 'tracking', 'Extra tracking +5,000', 2899000, 'yearly', 5000, null, null, null, null, null, null, 'addon_tracking_5000_year', 'contact_sales', '{growth}', 6),
  ('tracking_10000_year', 'tracking', 'Extra tracking +10,000', 5399000, 'yearly', 10000, null, null, null, null, null, null, 'addon_tracking_10000_year', 'contact_sales', '{growth}', 7),
  ('brand_month', 'brand', 'Extra brand', 2500, 'monthly', null, 1, null, null, null, null, null, 'addon_brand_month', 'self_serve', '{growth}', 1),
  ('brand_year', 'brand', 'Extra brand', 25000, 'yearly', null, 1, null, null, null, null, null, 'addon_brand_year', 'self_serve', '{growth}', 1),
  ('ai_topup_5x', 'ai_topup', 'AI usage +5x', 3900, 'one_time', null, null, 25, 50, 50, 5, null, 'addon_ai_topup_5x', 'self_serve', '{growth}', 1),
  ('ai_topup_10x', 'ai_topup', 'AI usage +10x', 6900, 'one_time', null, null, 50, 100, 100, 10, null, 'addon_ai_topup_10x', 'self_serve', '{growth}', 2),
  ('ai_topup_20x', 'ai_topup', 'AI usage +20x', 12900, 'one_time', null, null, 100, 200, 200, 20, null, 'addon_ai_topup_20x', 'self_serve', '{growth}', 3)
on conflict (id) do nothing;

-- ─── What a workspace's subscription adds ───────────────────────────────────

alter table public.organizations
  add column if not exists add_on_prompts integer not null default 0
    check (add_on_prompts >= 0),
  add column if not exists add_on_brands integer not null default 0
    check (add_on_brands >= 0);

comment on column public.organizations.add_on_prompts is
  'Prompt locations the plan''s subscription adds (its extra tracking tier): a mirror of its add-on items, written by the Stripe webhook and the billing actions; server only (00546).';
comment on column public.organizations.add_on_brands is
  'Brands the plan''s subscription adds (its extra brand quantity): a mirror of its add-on items, written by the Stripe webhook and the billing actions; server only (00546).';

-- The server's columns, held by their own trigger as 00386 holds its column.
create or replace function public.guard_organization_add_on_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;

  if (tg_op = 'INSERT' and (new.add_on_prompts is distinct from 0
                            or new.add_on_brands is distinct from 0))
     or (tg_op = 'UPDATE' and (new.add_on_prompts is distinct from old.add_on_prompts
                               or new.add_on_brands is distinct from old.add_on_brands))
  then
    raise exception 'organization column is managed server-side and cannot be set from the client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_guard_add_on_columns on public.organizations;

create trigger organizations_guard_add_on_columns
  before insert or update on public.organizations
  for each row
  execute function public.guard_organization_add_on_columns();

-- ─── What a paid AI top-up adds ─────────────────────────────────────────────

create table if not exists public.usage_top_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purchase_id uuid not null unique references public.add_on_purchases(id) on delete cascade,
  -- Dollars of model cost, briefs and opportunities it adds to the window.
  ai_usd numeric(12, 2) not null check (ai_usd >= 0),
  briefs integer not null check (briefs >= 0),
  opportunities integer not null check (opportunities >= 0),
  multiplier smallint not null check (multiplier > 0),
  -- It counts in the quota window it was paid in, until the next renewal.
  paid_at timestamptz not null,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The limits' read: a workspace's top-ups paid since the window began.
create index if not exists usage_top_ups_organization_paid_idx
  on public.usage_top_ups (organization_id, paid_at);

drop trigger if exists trg_usage_top_ups_updated_at on public.usage_top_ups;
create trigger trg_usage_top_ups_updated_at
  before update on public.usage_top_ups
  for each row execute function public.handle_updated_at();

comment on table public.usage_top_ups is
  'What a paid AI top-up adds (00546): dollars of model cost, briefs and opportunities, for the quota window it was paid in (not renewed). A refund sets refunded_at. Server only: dollars never reach a browser.';

alter table public.usage_top_ups enable row level security;
revoke all on table public.usage_top_ups from anon, authenticated;
grant all on table public.usage_top_ups to service_role;

notify pgrst, 'reload schema';
