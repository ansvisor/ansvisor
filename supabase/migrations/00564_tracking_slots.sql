-- ============================================================================
-- 00564: Tracking slots per platform
-- ============================================================================
-- Owner's decision (26–27 Nov 2026): a workspace buys extra tracking per
-- platform. A slot is one prompt tracked in one location on one platform,
-- every day. Plans include slots on their own platforms (web
-- config/tracking-slots.ts); extra slots are sold on 13 platforms in units of
-- 100, monthly or yearly (10 × monthly), by Growth and Enterprise workspaces
-- themselves. Schema, the catalog's seed rows and one read only; no table is
-- rewritten and nothing is backfilled.
--
--   * add_on_products takes a kind 'slots', one row per platform and
--     interval: platform is the platform id prompts run on, grant_slots the
--     slots one unit adds (100). stripe_lookup_key names the Stripe price
--     (addon_slots_<platform>_month|_year, the same keys in the sandbox and
--     live). The rows are seeded inactive: staff turn them on once the
--     prices exist in that Stripe account.
--   * The Extra tracking tiers (00546) are retired: none was ever bought and
--     slots replace them. Their rows stay, inactive, so any history still
--     reads.
--   * organizations.add_on_slots: the extra slots the subscription adds, per
--     platform ({"chatgpt-web": 600}): a mirror of its slot items, written by
--     the Stripe webhook and the billing actions, held server side by the
--     trigger that holds add_on_prompts and add_on_brands.
--   * prompts.waiting_platforms: platforms a prompt is set to run on that are
--     over their slots. The newest prompt locations wait; nothing is deleted.
--     A platform is in platforms or here, never both (the check is added
--     NOT VALID so this stays fast; it is validated once existing rows are
--     checked).
--   * org_platform_slot_usage: active prompt locations per platform for one
--     organization, the unit slots are counted in. The same membership rule
--     and demo-brand exclusion as org_prompt_location_usage (00390).

-- ─── The catalog ────────────────────────────────────────────────────────────

alter table public.add_on_products
  add column if not exists platform text
    check (platform ~ '^[a-z][a-z0-9-]{1,40}$'),
  add column if not exists grant_slots integer check (grant_slots > 0);

alter table public.add_on_products
  drop constraint if exists add_on_products_kind_check,
  drop constraint if exists add_on_products_recurring_billing_check,
  drop constraint if exists add_on_products_slots_check;

alter table public.add_on_products
  add constraint add_on_products_kind_check
    check (kind in ('ai', 'storage', 'tracking', 'brand', 'ai_topup', 'slots')),
  add constraint add_on_products_recurring_billing_check
    check (
      kind not in ('tracking', 'brand', 'slots')
      or (billing in ('monthly', 'yearly') and valid_months is null)
    ),
  -- A slots row names its platform and the slots one unit adds; no other
  -- kind carries either.
  add constraint add_on_products_slots_check
    check (
      (kind = 'slots') = (platform is not null)
      and (kind = 'slots') = (grant_slots is not null)
    );

-- One price per platform and interval.
create unique index if not exists add_on_products_slots_platform_billing_idx
  on public.add_on_products (platform, billing)
  where kind = 'slots';

comment on column public.add_on_products.platform is
  'kind = slots: the platform id the slots are for (prompts.platforms), e.g. chatgpt-web (00564).';
comment on column public.add_on_products.grant_slots is
  'kind = slots: the slots one unit adds, 100 (00564).';

-- The slots on sale (owner's prices, 26 Nov 2026: per 100 slots a month $15
-- standard, $45 ChatGPT with ads and Meta AI, $60 Perplexity, Claude, Grok
-- and Microsoft Copilot; yearly = 10 × monthly). Seeded inactive. Run again,
-- it leaves them as staff may have changed them.
insert into public.add_on_products
  (id, kind, name, price_cents, billing, platform, grant_slots, stripe_lookup_key,
   sale, plans, active, sort)
select
  'slots_' || s.stripe_id || '_' || i.suffix,
  'slots',
  s.name || ' tracking slots',
  s.cents * i.factor,
  i.billing,
  s.platform,
  100,
  'addon_slots_' || s.stripe_id || '_' || i.suffix,
  'self_serve',
  '{growth,enterprise}',
  false,
  s.sort
from (
  values
    ('chatgpt-web', 'chatgpt_web', 'ChatGPT', 1500, 1),
    ('gemini-web', 'gemini_web', 'Gemini', 1500, 2),
    ('google-aio', 'google_aio', 'Google AI Overviews', 1500, 3),
    ('google-aimode', 'google_aimode', 'Google AI Mode', 1500, 4),
    ('copilot-web', 'copilot_web', 'Bing AI Mode', 1500, 5),
    ('naver-web', 'naver_web', 'Naver', 1500, 6),
    ('wenxin-web', 'wenxin_web', 'Wenxin', 1500, 7),
    ('chatgpt-ads', 'chatgpt_ads', 'ChatGPT with ads', 4500, 8),
    ('meta-ai-web', 'meta_ai_web', 'Meta AI', 4500, 9),
    ('perplexity-web', 'perplexity_web', 'Perplexity', 6000, 10),
    ('claude-web', 'claude_web', 'Claude', 6000, 11),
    ('grok-web', 'grok_web', 'Grok', 6000, 12),
    ('copilot-app', 'copilot_app', 'Microsoft Copilot', 6000, 13)
) as s(platform, stripe_id, name, cents, sort)
cross join (
  values ('month', 'monthly', 1), ('year', 'yearly', 10)
) as i(suffix, billing, factor)
on conflict (id) do nothing;

-- The Extra tracking tiers are retired (none was bought; slots replace them).
update public.add_on_products
set active = false
where kind = 'tracking' and active;

-- ─── What a workspace's subscription adds ───────────────────────────────────

alter table public.organizations
  add column if not exists add_on_slots jsonb not null default '{}'::jsonb
    check (jsonb_typeof(add_on_slots) = 'object');

comment on column public.organizations.add_on_slots is
  'Extra tracking slots the plan''s subscription adds, per platform ({"chatgpt-web": 600}): a mirror of its slot items, written by the Stripe webhook and the billing actions; server only (00564).';

-- The server's columns, held as 00546 holds them, add_on_slots with them.
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
                            or new.add_on_brands is distinct from 0
                            or new.add_on_slots is distinct from '{}'::jsonb))
     or (tg_op = 'UPDATE' and (new.add_on_prompts is distinct from old.add_on_prompts
                               or new.add_on_brands is distinct from old.add_on_brands
                               or new.add_on_slots is distinct from old.add_on_slots))
  then
    raise exception 'organization column is managed server-side and cannot be set from the client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ─── Platforms waiting for a slot ───────────────────────────────────────────

alter table public.prompts
  add column if not exists waiting_platforms text[] not null default '{}';

alter table public.prompts
  drop constraint if exists prompts_waiting_platforms_disjoint;

alter table public.prompts
  add constraint prompts_waiting_platforms_disjoint
    check (not (platforms && waiting_platforms)) not valid;

comment on column public.prompts.waiting_platforms is
  'Platforms this prompt is set to run on that are over the workspace''s tracking slots (00564): they wait, newest locations first, and run again once someone adds them back. Never also in platforms.';

-- ─── Slots used, per platform ───────────────────────────────────────────────
-- The unit slots are counted in: each active prompt's locations (one per
-- region, minimum one) on each platform it runs on. Account-wide, for the
-- organization's members and the server; nothing for anyone else.

create or replace function public.org_platform_slot_usage(p_organization_id uuid)
returns table (platform text, slots bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select pl.platform, sum(greatest(coalesce(array_length(p.regions, 1), 0), 1))::bigint
  from public.prompts p
  join public.prompt_sets ps on ps.id = p.prompt_set_id
  join public.brands b on b.id = ps.brand_id
  cross join lateral unnest(p.platforms) as pl(platform)
  where b.organization_id = p_organization_id
    and not b.is_demo
    and p.is_active
    and (
      coalesce(auth.role(), '') = 'service_role'
      or exists (
        select 1 from public.profiles pf
        where pf.id = auth.uid() and pf.organization_id = p_organization_id
      )
    )
  group by pl.platform;
$$;

revoke all on function public.org_platform_slot_usage(uuid) from public, anon;
grant execute on function public.org_platform_slot_usage(uuid) to authenticated, service_role;

comment on function public.org_platform_slot_usage(uuid) is
  'Active prompt locations per platform for one organization (00564): the unit tracking slots are counted in. Paused prompts, waiting platforms and the demo brand don''t count. Security definer: the whole organization for its members and the server, nothing for anyone else.';

notify pgrst, 'reload schema';
