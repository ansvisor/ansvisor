-- ============================================================================
-- 00493: GA items matched to catalog products, and the products whose pages
-- are worth optimizing (AC plan P-6, spec §6.1)
-- ============================================================================
-- Google Analytics reports item revenue by itemId and itemName
-- (ga_item_stats), not by the brand's catalog (00278). An item is matched to
-- a catalog product once, after each GA sync (server ga-sync.js), and kept
-- here:
--
--   * sku: its itemId is a variant's SKU (case and spaces aside);
--   * gtin: its itemId is a variant's GTIN (leading zeros aside);
--   * title: else its itemName is one live product's title, letters and
--     digits only, lower case. A name two products share matches neither.
--
-- product_page_candidates reads, for a nightly group of product pages to
-- optimize (G21, server action-center/product-page-groups.js), each live
-- product with a page and any sign AI or buyers care about it since p_from:
-- the prompts whose shopping cards showed it (the brand's own cards,
-- 00360's catalog match), its AI visits and orders (00361), and its GA
-- item revenue through the matches above.

create table if not exists public.catalog_item_matches (
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- As ga_item_stats keys an item: either may be empty.
  item_id text not null default '',
  item_name text not null default '',
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  match text not null check (match in ('sku', 'gtin', 'title')),
  matched_at timestamptz not null default now(),
  primary key (brand_id, item_id, item_name)
);

create index if not exists catalog_item_matches_product_idx
  on public.catalog_item_matches (product_id);

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.catalog_item_matches enable row level security;
revoke all on table public.catalog_item_matches from anon, authenticated;
grant select on table public.catalog_item_matches to authenticated;
grant all on table public.catalog_item_matches to service_role;

drop policy if exists "catalog_item_matches: member select" on public.catalog_item_matches;
create policy "catalog_item_matches: member select"
  on public.catalog_item_matches
  for select
  to authenticated
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- ─── Matching, after each GA sync ───────────────────────────────────────────

-- The brand's items of the last 90 days matched again: the matches in
-- place of the ones before. Service role only. Returns how many matched.
create or replace function public.refresh_catalog_item_matches(p_brand_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'refresh_catalog_item_matches is for the service role';
  end if;

  delete from public.catalog_item_matches m where m.brand_id = p_brand_id;

  with items as (
    select distinct g.item_id, g.item_name
    from public.ga_item_stats g
    where g.brand_id = p_brand_id
      and g.date >= (now() at time zone 'utc')::date - 90
  ),
  variants as (
    select v.product_id,
      nullif(lower(btrim(v.sku)), '') as sku,
      nullif(ltrim(btrim(v.gtin), '0'), '') as gtin
    from public.catalog_variants v
    join public.catalog_products p on p.id = v.product_id and p.removed_at is null
    where v.brand_id = p_brand_id
      and v.removed_at is null
  ),
  names as (
    select btrim(regexp_replace(lower(p.title), '[^[:alnum:]]+', ' ', 'g')) as name,
      min(p.id::text)::uuid as product_id
    from public.catalog_products p
    where p.brand_id = p_brand_id
      and p.removed_at is null
    group by 1
    -- A name two live products share says neither.
    having count(*) = 1
  ),
  found as (
    select i.item_id, i.item_name, v.product_id, 'sku' as match, 1 as rank
    from items i
    join variants v on v.sku = lower(btrim(i.item_id))
    where btrim(i.item_id) <> ''
    union all
    select i.item_id, i.item_name, v.product_id, 'gtin', 2
    from items i
    join variants v on v.gtin = ltrim(btrim(i.item_id), '0')
    where btrim(i.item_id) ~ '^[0-9]{8,14}$'
    union all
    select i.item_id, i.item_name, n.product_id, 'title', 3
    from items i
    join names n on n.name = btrim(regexp_replace(lower(i.item_name), '[^[:alnum:]]+', ' ', 'g'))
    where btrim(i.item_name) <> ''
  )
  insert into public.catalog_item_matches (brand_id, item_id, item_name, product_id, match)
  select distinct on (f.item_id, f.item_name)
    p_brand_id, f.item_id, f.item_name, f.product_id, f.match
  from found f
  order by f.item_id, f.item_name, f.rank, f.product_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.refresh_catalog_item_matches(uuid) from public, anon, authenticated;
grant execute on function public.refresh_catalog_item_matches(uuid) to service_role;

comment on function public.refresh_catalog_item_matches(uuid) is
  'AC plan P-6: matches the brand''s GA items of the last 90 days to catalog products (SKU, GTIN, then a unique title). Service role only.';

-- ─── The products whose pages are worth optimizing ──────────────────────────

create or replace function public.product_page_candidates(
  p_brand_id uuid,
  p_from timestamptz
)
returns table (
  product_id uuid,
  title text,
  url text,
  availabilities text[],
  prompt_ids uuid[],
  cards bigint,
  ai_visits bigint,
  orders bigint,
  revenue numeric,
  currency text,
  item_revenue double precision,
  items_purchased bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with allowed as (
    select 1
    where auth.role() = 'service_role' or public.can_access_brand(p_brand_id)
  ),
  live as (
    select p.id, p.title,
      coalesce(p.url, (
        select v.url
        from public.catalog_variants v
        where v.product_id = p.id and v.removed_at is null and v.url is not null
        order by v.external_id
        limit 1
      )) as page
    from public.catalog_products p
    where p.brand_id = p_brand_id
      and p.removed_at is null
      and exists (select 1 from allowed)
  ),
  shelf as (
    select c.catalog_product_id as pid,
      array_agg(distinct r.prompt_id) as prompts,
      count(*) as n
    from public.prompt_result_shopping_cards c
    join public.prompt_results r on r.id = c.prompt_result_id
    where c.brand_id = p_brand_id
      and c.matched_brand_role = 'own'
      and c.catalog_product_id is not null
      and c.created_at >= p_from
      and exists (select 1 from allowed)
    group by 1
  ),
  stats as (
    select s.product_id as pid, s.ai_visits as visits, s.orders as n, s.revenue as value, s.currency as cur
    from public.catalog_product_ai_stats(p_brand_id, p_from) s
  ),
  items as (
    select m.product_id as pid,
      sum(g.item_revenue) as value,
      sum(g.items_purchased)::bigint as n
    from public.catalog_item_matches m
    join public.ga_item_stats g
      on g.brand_id = m.brand_id and g.item_id = m.item_id and g.item_name = m.item_name
    where m.brand_id = p_brand_id
      and g.date >= (p_from at time zone 'utc')::date
      and exists (select 1 from allowed)
    group by 1
  )
  select l.id, l.title, l.page,
    coalesce((
      select array_agg(v.availability order by v.external_id)
      from public.catalog_variants v
      where v.product_id = l.id and v.removed_at is null
    ), '{}'),
    coalesce(s.prompts, '{}'),
    coalesce(s.n, 0)::bigint,
    coalesce(st.visits, 0)::bigint,
    coalesce(st.n, 0)::bigint,
    st.value,
    st.cur,
    coalesce(i.value, 0),
    coalesce(i.n, 0)::bigint
  from live l
  left join shelf s on s.pid = l.id
  left join stats st on st.pid = l.id
  left join items i on i.pid = l.id
  where l.page is not null
    and (s.pid is not null or st.pid is not null or i.pid is not null);
$$;

revoke all on function public.product_page_candidates(uuid, timestamptz) from public, anon;
grant execute on function public.product_page_candidates(uuid, timestamptz)
  to authenticated, service_role;

comment on function public.product_page_candidates(uuid, timestamptz) is
  'AC plan P-6: each live product with a page and a shopping card, an AI visit, an order or GA item revenue since p_from, with those figures. Members of the brand''s organization and the service role.';

-- ─── The group size a person picks ──────────────────────────────────────────

-- A product pages action (G21) keeps up to ten products (payload.products,
-- best first) and works on the first 3, 5 or 10 of them: its pages, its
-- targets and count, and its list (00244's action_entities), read again.
-- People who can access the action's brand (can_access_brand, 00388); an
-- open action only. Returns the payload, or null when nothing changed.
create or replace function public.set_product_group_size(p_action_id uuid, p_size integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_action public.actions%rowtype;
  v_group jsonb;
  v_payload jsonb;
begin
  if p_size is null or p_size not in (3, 5, 10) then
    raise exception 'a group is 3, 5 or 10 products' using errcode = '22023';
  end if;
  select a.* into v_action
  from public.actions a
  where a.id = p_action_id
    and a.kind = 'product_pages_optimize'
    and a.deleted_at is null
    and a.status not in ('completed', 'dismissed')
  for update;
  if not found then
    return null;
  end if;
  -- Brand access (00388): a person on Selected brands changes their brands' only.
  if auth.role() is distinct from 'service_role'
    and not public.can_access_brand(v_action.brand_id) then
    return null;
  end if;

  select coalesce(jsonb_agg(x.value order by x.ord), '[]'::jsonb) into v_group
  from jsonb_array_elements(
    case when jsonb_typeof(v_action.payload->'products') = 'array'
      then v_action.payload->'products' else '[]'::jsonb end
  ) with ordinality as x(value, ord)
  where x.ord <= p_size
    and jsonb_typeof(x.value->'url') = 'string';
  if jsonb_array_length(v_group) = 0 then
    return null;
  end if;

  v_payload := v_action.payload || jsonb_build_object(
    'groupSize', p_size,
    'pages', (
      select jsonb_agg(g.value->'url' order by g.ord)
      from jsonb_array_elements(v_group) with ordinality as g(value, ord)
    ),
    'targets', (
      select jsonb_agg(jsonb_build_object('id', g.value->'url', 'label', g.value->'title') order by g.ord)
      from jsonb_array_elements(v_group) with ordinality as g(value, ord)
    ),
    'targetCount', jsonb_array_length(v_group)
  );

  update public.actions
  set payload = v_payload, updated_at = now()
  where id = p_action_id;
  delete from public.action_entities
  where action_id = p_action_id and entity_type = 'pages';
  perform public.snapshot_action_entities(p_action_id, v_action.brand_id, v_payload);
  insert into public.action_events (action_id, event, data, actor_id)
  values (p_action_id, 'group_size_set', jsonb_build_object('size', p_size), auth.uid());
  return v_payload;
end;
$$;

revoke all on function public.set_product_group_size(uuid, integer) from public, anon;
grant execute on function public.set_product_group_size(uuid, integer)
  to authenticated, service_role;

comment on function public.set_product_group_size(uuid, integer) is
  'AC plan P-6: a product pages action works on the first 3, 5 or 10 of its products: its pages, targets, count and list. People who can access the action''s brand; open actions only.';

notify pgrst, 'reload schema';
