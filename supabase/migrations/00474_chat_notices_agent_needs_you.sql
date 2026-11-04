-- ============================================================================
-- 00474: a notice when an agent's run waits for its person
-- ============================================================================
-- "Notify me when an agent needs me" (Settings › Chat, chat_user_prefs.
-- notify_via, 00408), behind CHAT_AGENTIC. When an agent's run stops to ask
-- its person something or to wait for their OK on a change (its status
-- needs_you), the person the run acts as gets, with "Inbox + email", one
-- e-mail: once per run. A chat_notices row (dedupe_key agent_needs_you:{run
-- id}) records it, so a run that waits again sends none; the Inbox already
-- lists the run's chat under Needs you, so the row isn't shown a second
-- time. When the run goes on or ends, the row closes (resolved_at). The
-- server writes, as for 00441's and 00446's kinds (server
-- lib/chat-notices/needs-you.js).
--
-- The kind list keeps every kind written before: 00441's, 00446's, and
-- 00461's (W3-04a: schedule_failed, schedule_paused, followup_result), which
-- an open pull request adds. Whichever migration rewrites this check last
-- must list every kind, or the others' notices are refused.

alter table public.chat_notices
  drop constraint if exists chat_notices_kind_check;
alter table public.chat_notices
  add constraint chat_notices_kind_check check (
    kind in (
      'own_key_failed',
      'own_key_limit_80',
      'own_key_limit_100',
      'agent_went_live',
      'agent_go_live_off',
      'schedule_failed',
      'schedule_paused',
      'followup_result',
      'agent_needs_you'
    )
  );

notify pgrst, 'reload schema';
