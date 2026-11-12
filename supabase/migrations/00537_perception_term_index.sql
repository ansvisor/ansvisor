-- ============================================================================
-- 00537: the Perception terms' index by term, after the 00536 backfill
-- ============================================================================
-- mentions_perception_live (00536) reads, for a ready brand, the window
-- before of the 15 brand terms it shows from mentions_terms_daily_all. With
-- this index that is 15 short ranges, each term's days; without it, the
-- brand entity's days of every term, filtered to the 15. The read is right
-- either way, just slower without it.
--
-- Its own migration, applied after server/src/scripts/backfill-fast-rollups.js
-- has filled the table, so the backfill doesn't keep a second index up to
-- date row by row and the index is built once, from the filled table.
--
-- On production this may instead be built by hand, without blocking the
-- table's writes, before this file applies (it then does nothing):
--   create index concurrently if not exists mentions_terms_daily_all_term
--     on public.mentions_terms_daily_all (brand_id, entity, term, day)
--     include (answers);
-- A concurrent build that fails leaves an invalid index of that name, which
-- "if not exists" would keep: drop it and build it again.
create index if not exists mentions_terms_daily_all_term
  on public.mentions_terms_daily_all (brand_id, entity, term, day)
  include (answers);
