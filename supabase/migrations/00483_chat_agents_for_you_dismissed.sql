-- Chat (00483): "Agents for you" on Chat Home (AGENTS plan §8 and #11, its
-- new member half): someone who joined the workspace in the last 14 days,
-- once they answered or skipped Your work areas, sees 3 to 5 ready-to-use
-- agents there, each linked to its card in Agent Center, until they hide
-- the section. No agent runs and no AI is used.
--
-- When they hid it is kept on their own Chat settings row, so it stays
-- hidden on every device (DECISIONS N3), as home_seen_at is (00420). Null:
-- not hidden. The row's own policies and grants (00400) already let the
-- person read and write it.

alter table public.chat_user_prefs
  add column if not exists agents_for_you_dismissed_at timestamptz;

comment on column public.chat_user_prefs.agents_for_you_dismissed_at is
  'When the person hid "Agents for you" on Chat Home (00483). Null: not hidden; it shows in their first 14 days in the workspace, once they answered or skipped Your work areas.';
