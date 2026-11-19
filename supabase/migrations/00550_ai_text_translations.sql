-- ============================================================================
-- 00550: AI-written text in the reader's language (LOC-010)
-- ============================================================================
-- Ansvisor writes some text once, in English: content opportunities' titles
-- and reasons, Action Center actions and signals, Site Audit
-- recommendations. A person whose interface language (profiles.ui_language,
-- 00549) is another reads them translated: on first view, the API translates
-- the rows on screen and keeps each field's translation here; later viewers
-- in that language read the kept one. The text is never written again per
-- language.
--
--   * One row per source row, field and language. source_hash is the
--     English text's hash when it was translated: when the source changes,
--     the hash no longer matches and the field is translated again.
--   * source_kind names the table the text comes from ('opportunity',
--     'action', …); the API's list of kinds decides which exist, so a new
--     kind needs no migration. No foreign key: the source tables differ. A
--     translation left after its source row goes is never read.
--   * The server reads and writes it with the service role, after checking
--     the viewer may see each source row (the source's brand in their
--     organization). Row-level security is on with no policy: no client reads
--     or writes it directly.
--
-- Schema only: the table starts empty and fills as people read.

create table if not exists public.ai_text_translations (
  source_kind text not null
    constraint ai_text_translations_kind_format check (source_kind ~ '^[a-z_]{1,40}$'),
  source_id uuid not null,
  field text not null
    constraint ai_text_translations_field_format check (field ~ '^[A-Za-z_]{1,40}$'),
  locale text not null
    constraint ai_text_translations_locale_format check (
      locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'
    ),
  source_hash text not null
    constraint ai_text_translations_hash_format check (char_length(source_hash) between 8 and 64),
  text text not null
    constraint ai_text_translations_text_length check (char_length(text) <= 20000),
  created_at timestamptz not null default now(),
  primary key (source_kind, source_id, field, locale)
);

comment on table public.ai_text_translations is
  'LOC-010: AI-written text (opportunities, Action Center, Site Audit) translated into a viewer''s interface language on first view, kept per source row, field and language; source_hash marks the English it was made from. Server only (RLS on, no policy).';

alter table public.ai_text_translations enable row level security;
