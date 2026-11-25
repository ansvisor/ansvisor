-- ============================================================================
-- 00562: which answer provider each pending task was submitted to
-- ============================================================================
-- cloro_pending_tasks holds the tasks a run waits on, for Cloro and Anakin
-- alike (answer-providers/index.js). Each provider's webhook
-- (routes/cloro-callback.js, routes/anakin-callback.js) looks a delivery up
-- here by task id, so the row says whose task it is, and a webhook leaves
-- another provider's task alone. Rows from before this file, and rows
-- written without it, are Cloro's: null reads as 'cloro'.
--
-- Schema only: a nullable column with no default rewrites nothing, and the
-- table holds one run's tasks at a time.

alter table public.cloro_pending_tasks
  add column if not exists provider text
    check (provider is null or provider in ('cloro', 'anakin'));
