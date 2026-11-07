-- ============================================================================
-- 00494: which catalog categories a topic is about (AC plan P-7, spec §6.2)
-- ============================================================================
-- A store's topic ("cold brew") and its catalog's categories ("Coffee >
-- Cold Brew") are linked so a topic's work can reach its category page and
-- products. The link is worked out on every read (server
-- catalog/topic-categories.js): a category whose own name's words are in
-- the topic's name, or in its prompts. Only a person's decision is kept
-- here, as catalog_category_pages (00350) keeps a category's page:
--
--   * linked true: the person linked them (Brand settings › Shopping Mode);
--   * linked false: the person took a link worked out away; it stays away.
--
-- No row: the worked-out link stands. Members read; the API writes for an
-- admin or a manager.

create table if not exists public.topic_catalog_categories (
  brand_id uuid not null references public.brands(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  category_id uuid not null references public.catalog_categories(id) on delete cascade,
  linked boolean not null,
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (topic_id, category_id)
);

create index if not exists topic_catalog_categories_brand_idx
  on public.topic_catalog_categories (brand_id);

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.topic_catalog_categories enable row level security;
revoke all on table public.topic_catalog_categories from anon, authenticated;
grant select on table public.topic_catalog_categories to authenticated;
grant all on table public.topic_catalog_categories to service_role;

drop policy if exists "topic_catalog_categories: member select" on public.topic_catalog_categories;
create policy "topic_catalog_categories: member select"
  on public.topic_catalog_categories
  for select
  to authenticated
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
