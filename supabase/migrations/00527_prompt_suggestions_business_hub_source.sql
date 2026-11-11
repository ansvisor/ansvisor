-- ============================================================================
-- 00527: ChatGPT Business Hub discovery topics as a prompt-suggestion source
-- ============================================================================
-- Prompts › Suggestions › From ChatGPT Business Hub: an admin or a manager
-- pastes up to five of the discovery topics Business Hub shows (OpenAI's
-- "Businesses in ChatGPT"), and Ansvisor writes two or three prompts for each.
-- Those rows carry source 'business_hub', with the topic in source_data:
--
--   { "topic": "office coffee subscriptions", "periodEnd": "2026-11-09" | null,
--     "enteredAt": timestamptz }
--
-- They stay 30 days (expires_at) and a refresh never replaces them. Without
-- 'business_hub' in the check their insert fails outright, so this lands with
-- the route that writes them. Nothing else changes: topic_suggestions.source
-- has no check, and a tracked prompt keeps where it came from through the
-- suggestion row's added_prompt_id. The text is what a person typed into the
-- dialog, copied from their own Business Hub page: nothing about a person.
--
-- Safe to run twice.

alter table public.prompt_suggestions drop constraint if exists prompt_suggestions_source_check;
alter table public.prompt_suggestions add constraint prompt_suggestions_source_check
  check (source = any (array['llm', 'heuristic', 'gsc', 'ga', 'catalog', 'business_hub']));

comment on column public.prompt_suggestions.source is
  'Where the suggestion came from: llm, heuristic, gsc, ga, catalog, or business_hub (00527: a ChatGPT Business Hub discovery topic, kept 30 days and never replaced by a refresh).';

notify pgrst, 'reload schema';
