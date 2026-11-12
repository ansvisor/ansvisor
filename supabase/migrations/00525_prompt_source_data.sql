-- ============================================================================
-- 00525: where a tracked prompt came from, and a topic suggestion's category
-- (AC plan P-8, spec §6.3)
-- ============================================================================
-- Tracking suggestions from a store's catalog (ECOM-003, 00362) name the
-- category or the product they were drawn from (prompt_suggestions
-- .source_data). Until now that was lost once a suggestion was accepted: the
-- prompt it made kept only its text and topic. Online-store plays and
-- measurement need to know which products a prompt is about.
--
--   * prompts.source_data: the catalog suggestion an accepted prompt came
--     from, written with the prompt when a suggestion is added (one, Add
--     All, an Opportunities "Track N" or the MCP tool). Null for every
--     other prompt. Its shape:
--
--       { "kind": "catalog_category", "category_id": uuid | null,
--         "category": "Bags > Hiking backpacks", "suggested_at": timestamptz }
--       { "kind": "catalog_product", "product_ids": [uuid, ...],
--         "category_id": uuid | null, "category": text | null,
--         "suggested_at": timestamptz }
--
--     Ids are catalog_categories' and catalog_products' (00278); the
--     category's name is kept too, since it is the brand's key for it.
--     Catalog data only: nothing about a person.
--
--   * topic_suggestions.source_data: for a topic suggested from a catalog
--     category no topic covers yet (source 'catalog'), that category, its
--     live products and how many are in stock, for the Topics tab's card:
--     { "category", "categoryId", "products", "inStock" }. Null for the
--     model's ideas (source 'llm').
--
-- Prompts are written by admins and managers through their own rules
-- (00001), and topic suggestions are updated by them too (00382), so both
-- columns are checked here: an object, a few kilobytes at most, and for a
-- prompt one of the two kinds above.

alter table public.prompts
  add column if not exists source_data jsonb;

alter table public.prompts drop constraint if exists prompts_source_data_check;
alter table public.prompts add constraint prompts_source_data_check check (
  source_data is null
  or (
    jsonb_typeof(source_data) = 'object'
    and octet_length(source_data::text) <= 4096
    -- coalesce: a check passes on null, so a missing key must read as no.
    and coalesce(source_data->>'kind', '') in ('catalog_category', 'catalog_product')
    and (
      source_data->>'kind' = 'catalog_category'
      or coalesce(jsonb_typeof(source_data->'product_ids'), '') = 'array'
    )
  )
);

comment on column public.prompts.source_data is
  'Where the prompt came from (AC plan P-8, 00525): the catalog suggestion it was accepted from, {kind catalog_category|catalog_product, category_id, category, product_ids, suggested_at}. Null for any other prompt.';

alter table public.topic_suggestions
  add column if not exists source_data jsonb;

alter table public.topic_suggestions drop constraint if exists topic_suggestions_source_data_check;
alter table public.topic_suggestions add constraint topic_suggestions_source_data_check check (
  source_data is null
  or (jsonb_typeof(source_data) = 'object' and octet_length(source_data::text) <= 4096)
);

comment on column public.topic_suggestions.source_data is
  'For a topic suggested from a catalog category (source catalog, AC plan P-8, 00525): {category, categoryId, products, inStock}. Null for the model''s ideas.';

notify pgrst, 'reload schema';
