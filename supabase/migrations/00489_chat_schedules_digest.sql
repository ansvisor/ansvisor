-- ============================================================================
-- 00489: a scheduled job that sends What's new for the person's plan
-- ============================================================================
-- Chat Wave 4 W4-23: "What's new for my plan, 1st of every month". There is
-- no such job until a person sets one up on the schedule card (owner
-- decision 14): nothing is written for anyone in advance. Its runs call no
-- model and use none of the AI limit. The worker lists the creator's unread
-- What's new entries for their plan in the job's chat and marks them read.
-- A run with nothing new delivers nothing (its run row is `unchanged`).
--
--   * chat_schedules.digest: the kind of digest a job sends; null for any
--     other job, which asks Chat its prompt or skill as before. A digest is
--     about the workspace, never one brand, runs no skill, and is never a
--     follow-up check. Its prompt is the words its chat shows as the message.

alter table public.chat_schedules
  add column if not exists digest text check (digest in ('whats_new'));

alter table public.chat_schedules
  drop constraint if exists chat_schedules_digest_shape;
alter table public.chat_schedules
  add constraint chat_schedules_digest_shape check (
    digest is null
    or (skill_name is null and brand_id is null and kind <> 'followup_check')
  );

comment on column public.chat_schedules.digest is
  'W4-23 (00489): whats_new: each run lists the creator''s unread What''s new entries for their plan in the job''s chat, with no model and no AI use, and delivers nothing when none are new. Null: a job that asks Chat its prompt or skill.';
