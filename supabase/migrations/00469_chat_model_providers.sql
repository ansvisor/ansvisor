-- ============================================================================
-- 00469: which model providers a workspace lets Chat use
-- ============================================================================
-- Chat Wave 4 (W4-34; owner decision 2026-11-02 evening: "a US company
-- doing business globally"), behind CHAT_AGENTIC. An Admin turns a model
-- provider (the company that makes the model: OpenAI, Google, DeepSeek…) on
-- or off in Settings › Chat. A provider that is off has no model in the
-- model menu, and the engine runs Auto in place of one of its models, for a
-- person's chat, an agent and a scheduled run alike (checked on the
-- server).
--
--   * chat_settings.model_providers: the Admin's choices, by provider, as
--     {provider: true|false}. A provider not in it takes the default the
--     web keeps (lib/chat/model-providers.ts): Anthropic on, and always on,
--     since Auto runs on its models; OpenAI and Google on; DeepSeek off.
--     A provider added later starts on its own default with no migration.
--     Read as chat_settings is (00401); the server writes it, for an Admin.

alter table public.chat_settings
  add column if not exists model_providers jsonb not null default '{}'::jsonb check (
    jsonb_typeof(model_providers) = 'object' and octet_length(model_providers::text) <= 2000
  );

comment on column public.chat_settings.model_providers is
  'The model providers an Admin turned on or off for Chat (00469; W4-34), {provider: boolean}. Missing: the web''s default (Anthropic always on; OpenAI, Google on; DeepSeek off).';

notify pgrst, 'reload schema';
