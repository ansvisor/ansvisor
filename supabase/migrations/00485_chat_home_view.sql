-- ============================================================================
-- 00485: Chat Home's view — the Default view (a greeting, one line and the
-- box) or the person's focus
-- ============================================================================
-- Chat Home opened with every block the person's focus (CHAT-24) adds: For
-- you now, What's new, starter questions and new skills. People found that
-- first screen busy, so Home now starts on a Default view that shows only
-- the greeting, one line on what changed, the focus pill and the box. The
-- focus picker offers Default first, picked at the start.
--
--   * home_view: 'default' (the default) or 'focus' (Home tailored to the
--     areas in focus, 00400). Everyone starts on default, people who picked
--     areas before too: their focus stays as it was, so the picker opens
--     with it ticked and Continue brings their Home back in one step. The
--     composer's / menu still lists the focus's skills first.
--
-- Behind CHAT_AGENTIC: nothing reads it while the flag is off. The person
-- reads and writes their own row (00400's policies).

alter table public.chat_user_prefs
  add column if not exists home_view text not null default 'default'
    check (home_view in ('default', 'focus'));

comment on column public.chat_user_prefs.home_view is
  'Chat Home''s view: default (the greeting, one line and the box) or focus (tailored to the focus areas). Everyone starts on default; focus stays kept for the picker.';
