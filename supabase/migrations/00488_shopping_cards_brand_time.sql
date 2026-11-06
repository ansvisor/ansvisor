-- ============================================================================
-- 00488: Product Visibility's card reads, newest first, from an index
-- ============================================================================
-- Product Visibility (Visibility's fourth tab) reads a brand's shopping cards
-- over a window, newest first, a page of 1,000 at a time: the Shelf, the
-- Products table, Categories, Competitors and a product's match all page
-- through prompt_result_shopping_cards ordered by created_at desc, id desc
-- (fetchAllCards in web/src/lib/actions/shopping.ts). The table had no index
-- in that order (only brand + role, product brand, merchant domain and the
-- partial ones), so every page read the brand's cards in the window again
-- and sorted them, and a brand with many cards paid that once a page.
--
-- With (brand_id, created_at desc, id desc) a page reads its rows in order
-- and stops; the window's dates are a range on the same index. The reads
-- don't depend on it: without it they are only slower.
--
-- On production, build it first with CREATE INDEX CONCURRENTLY (outside a
-- transaction); `if not exists` makes this a no-op there.

create index if not exists prompt_result_shopping_cards_brand_time_idx
  on public.prompt_result_shopping_cards (brand_id, created_at desc, id desc);
