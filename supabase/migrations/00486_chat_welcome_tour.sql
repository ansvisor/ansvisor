-- ============================================================================
-- 00486: Chat's welcome card and product tour — a person's progress, and the
-- tour's texts in other languages
-- ============================================================================
-- Owner decision 2026-11-06: the free trial and the demo start on Chat Home,
-- where one welcome card says the first data is being prepared, offers the
-- Google connections and a quick product tour. The tour opens each page with
-- Chat's side panel beside it and explains the page there in scripted turns
-- (no model run), kept as the person's "Ansvisor tour" chat.
--
--   * chat_user_prefs.welcome_dismissed_at: "Not now" on the card, which then
--     stays hidden for good, on every device.
--   * chat_user_prefs.tour_chat_id: the person's tour chat, which each topic
--     adds its turns to; null before the tour, and once that chat is gone.
--   * chat_user_prefs.tour_topic: the topic the tour is on, one of its pages
--     in order (visibility, prompts, positions, content, connections); null
--     before the tour.
--   * chat_user_prefs.tour_finished_at: the tour ended (End the tour): the
--     card hides and the panel stops offering the next topic. Taking the
--     tour again clears it.
--   * chat_tour_translations: the tour's texts in a language other than
--     English (the person's answer language, 00408), translated once by the
--     small model and kept for everyone: the texts name no workspace (the
--     brand's name goes in when a turn is written). Keyed by the language
--     and the English texts' sha-256, so a changed text is translated again.
--
-- Behind CHAT_AGENTIC: nothing reads these while the flag is off. The person
-- reads and writes their own prefs row (00400's policies); the server writes
-- the tour's chat and its tour columns, and checks the chat is the person's
-- own before it adds to it. The translations are server only.

alter table public.chat_user_prefs
  add column if not exists welcome_dismissed_at timestamptz,
  add column if not exists tour_chat_id uuid
    references public.chat_conversations(id) on delete set null,
  add column if not exists tour_topic text check (
    tour_topic in ('visibility', 'prompts', 'positions', 'content', 'connections')
  ),
  add column if not exists tour_finished_at timestamptz;

-- A chat deleted for good clears the tour that points at it.
create index if not exists chat_user_prefs_tour_chat_idx
  on public.chat_user_prefs (tour_chat_id)
  where tour_chat_id is not null;

comment on column public.chat_user_prefs.welcome_dismissed_at is
  'Chat Home''s welcome card (00486): Not now, after which it stays hidden.';
comment on column public.chat_user_prefs.tour_chat_id is
  'The product tour''s chat (00486), which each topic adds to; null before the tour or once it is gone.';
comment on column public.chat_user_prefs.tour_topic is
  'The topic the product tour is on (00486); null before the tour.';
comment on column public.chat_user_prefs.tour_finished_at is
  'The product tour ended (00486): the welcome card hides. Taking the tour again clears it.';

-- ─── The tour's texts in other languages ───────────────────────────────────

create table if not exists public.chat_tour_translations (
  -- The answer language (00408's list), never English.
  lang text not null check (lang ~ '^[a-z]{2,3}$' and lang <> 'en'),
  -- sha-256 (hex) of the English texts it was translated from.
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  -- The texts by their key, as the English ones.
  texts jsonb not null check (
    jsonb_typeof(texts) = 'object' and octet_length(texts::text) <= 100000
  ),
  -- The model that translated them.
  model text check (char_length(model) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (lang, source_hash)
);

alter table public.chat_tour_translations enable row level security;
revoke all on table public.chat_tour_translations from anon, authenticated;
grant all on table public.chat_tour_translations to service_role;

comment on table public.chat_tour_translations is
  'Chat''s product tour (00486): its scripted texts in another language, translated once and kept for everyone by language and the English texts'' hash. No workspace data. Server only.';
