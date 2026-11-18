-- ============================================================================
-- 00542 (provisional): competitor types
-- ============================================================================
-- A brand's competitors are of different kinds: a direct rival, a marketplace
-- that lists the brand's offer next to others', a publisher or review site.
-- A brand in travel also tells tour operators, airlines and ferries apart.
-- `type` is the kind a competitor is, set by an admin or a manager:
--   - one of the generic types, stored by its key: 'direct', 'marketplace',
--     'publisher' or 'other' (the app names them);
--   - or a label the brand made up ("Tour operator"), stored as typed. The
--     brand's labels are the types its competitors have, so a label typed
--     once is offered for its other competitors.
-- Null is no type: everything reads as before for a brand that never sets one.
--
-- Schema only, no backfill: a nullable column without a default changes no
-- row, and the check reads a table of a few rows a brand. The table's row
-- rules (00387) cover the column: every member reads it, an admin or a
-- manager changes it.

alter table public.competitors add column if not exists type text;

alter table public.competitors drop constraint if exists competitors_type_check;
alter table public.competitors add constraint competitors_type_check
  check (type is null or (char_length(type) between 1 and 40 and type = btrim(type)));

comment on column public.competitors.type is
  'The kind of competitor (00542): a generic type''s key (direct, marketplace, publisher, other) or a label the brand made up, e.g. "Tour operator"; null for no type.';

notify pgrst, 'reload schema';
