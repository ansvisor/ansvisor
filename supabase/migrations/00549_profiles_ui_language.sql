-- ============================================================================
-- 00549: a person's own interface language (Settings › Account › Language)
-- ============================================================================
-- profiles.ui_language: the language the person picked for Ansvisor's screens,
-- as a locale code ("tr", "de", "pt-BR"); null is Automatic, their browser's
-- language, else English. Per person, never per workspace, and apart from a
-- brand's content language (what prompts are tracked and content is written
-- in), which it never changes. Theirs to set, on their own row
-- ("profiles: own row update", 00001): 00228's guard keeps role and
-- organization with the server and leaves this column to the person.
--
-- The format check only keeps a stray value out; which codes the app has
-- (and which have a messages file) is the web app's list (web/src/i18n/
-- locales.ts), so a new language needs no migration.

alter table public.profiles
  add column if not exists ui_language text
    constraint profiles_ui_language_format check (
      ui_language is null
      or ui_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'
    );

comment on column public.profiles.ui_language is
  'The interface language the person picked (Settings › Account › Language), a locale code such as tr or pt-BR; null = Automatic, their browser''s language, else English. Never the brand''s content language.';
