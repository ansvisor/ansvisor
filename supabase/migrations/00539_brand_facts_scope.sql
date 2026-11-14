-- ============================================================================
-- 00539: brand facts per destination, operator or route
-- ============================================================================
-- A brand fact (00269) held one value per slot for the whole brand, so a page
-- about one island was compared with another island's ferry price. `scope`
-- is where a fact holds ("Bozcaada", "Geçitkale → Gökçeada"); null is the
-- whole brand. Pages use the brand-wide facts and those whose scope they
-- name. One fact per scope, slot and value: nulls count as equal, so the
-- server's upsert names the index (brand_id, scope, slot, value_key).
-- Grants and policies stay: members still change only a fact's status.
-- Schema only, no backfill: kept facts stay brand-wide (at most 60 a brand).

alter table public.brand_facts add column if not exists scope text;

alter table public.brand_facts drop constraint if exists brand_facts_scope_check;
alter table public.brand_facts add constraint brand_facts_scope_check
  check (scope is null or char_length(scope) between 1 and 100);

create unique index if not exists brand_facts_brand_scope_slot_value_key
  on public.brand_facts (brand_id, scope, slot, value_key) nulls not distinct;

alter table public.brand_facts drop constraint if exists brand_facts_brand_id_slot_value_key_key;

comment on column public.brand_facts.scope is
  'Where the fact holds (00539): a destination, operator or route, e.g. "Bozcaada"; null for the whole brand.';

notify pgrst, 'reload schema';
