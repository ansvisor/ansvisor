-- Shopping merchant classification needed for "Where AI sends shoppers"
-- and weekly Amazon share alerts (#1277, #1284).

alter table public.prompt_result_shopping_cards
  add column if not exists merchant_kind text,
  add column if not exists marketplace text,
  add column if not exists listing_id text;

alter table public.prompt_result_shopping_cards
  drop constraint if exists prompt_result_shopping_cards_merchant_kind_check;

alter table public.prompt_result_shopping_cards
  add constraint prompt_result_shopping_cards_merchant_kind_check
  check (merchant_kind is null or merchant_kind in ('own', 'marketplace', 'reseller'));

create index if not exists prompt_result_shopping_cards_amazon_share_idx
  on public.prompt_result_shopping_cards (brand_id, matched_brand_role, created_at)
  include (marketplace)
  where merchant_kind is not null;

comment on column public.prompt_result_shopping_cards.merchant_kind is
  'Destination kind from classifyMerchant: own, marketplace, or reseller. Null means the card has no merchant URL and cannot be classified.';
comment on column public.prompt_result_shopping_cards.marketplace is
  'Normalized marketplace id (for example amazon, ebay, walmart); null for own stores, resellers, and unclassified cards.';
comment on column public.prompt_result_shopping_cards.listing_id is
  'Marketplace-native listing identifier when it can be extracted safely (for example an Amazon ASIN).';

-- Return the current UTC calendar week and its preceding four weeks. Each
-- week includes only brand-matched own products with a classified merchant
-- destination. Unclassified cards never enter the denominator.
create or replace function public.shopping_amazon_share_weekly(
  p_brand_id uuid,
  p_as_of timestamptz default now()
)
returns table (
  week_start date,
  amazon_cards bigint,
  classified_cards bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with boundaries as (
    select date_trunc('week', p_as_of at time zone 'UTC')::date as current_week
  ),
  weeks as (
    select generate_series(
      (boundaries.current_week - interval '4 weeks')::date,
      boundaries.current_week,
      interval '1 week'
    )::date as week_start
    from boundaries
  )
  select
    weeks.week_start,
    count(cards.id) filter (where cards.marketplace = 'amazon') as amazon_cards,
    count(cards.id) as classified_cards
  from weeks
  left join public.prompt_result_shopping_cards as cards
    on cards.brand_id = p_brand_id
   and cards.matched_brand_role = 'own'
   and cards.merchant_kind is not null
   and cards.created_at >= (weeks.week_start::timestamp at time zone 'UTC')
   and cards.created_at < ((weeks.week_start + interval '1 week')::timestamp at time zone 'UTC')
   and cards.created_at <= p_as_of
  group by weeks.week_start
  order by weeks.week_start;
$$;

grant execute on function public.shopping_amazon_share_weekly(uuid, timestamptz) to authenticated;
