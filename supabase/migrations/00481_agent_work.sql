-- ============================================================================
-- 00481: Agent work — who starts agent work in a workspace, and its change log
-- ============================================================================
-- The "Agent work" setting (AC-011, ROADMAP-plan §06; mockup screen 3): the
-- gear on Action Center › Today and Settings › Chat, behind CHAT_AGENTIC:
-- nothing reads it while the flag is off.
--
--   * chat_settings.agent_work: how far agents go without a person, for the
--     whole workspace. 'approve_first' ("I approve first", the default, so
--     every workspace starts on it): every change an agent's run makes waits
--     for a person's approval card, whatever the agent's own mode (the
--     approval precedence, web lib/chat/precedence.ts, reads it). Or
--     'auto_start' ("Agent starts on its own"): each agent's own mode
--     applies, Full auto still Growth and up. Going live is never affected:
--     it stays under the go-live switches (00443) and a person's click. Only
--     an Admin changes it; the server writes it.
--   * setting_changes: one row per change of a workspace setting made in the
--     app, kept with the setting's key, its value before and after, who
--     changed it and when ("Changed by … · date"). Members of the workspace
--     read their workspace's rows; the server writes them (service role).
--     A row stays when the person who made it leaves (changed_by set null).

alter table public.chat_settings
  add column if not exists agent_work text not null default 'approve_first';

alter table public.chat_settings drop constraint if exists chat_settings_agent_work_check;
alter table public.chat_settings
  add constraint chat_settings_agent_work_check
  check (agent_work in ('approve_first', 'auto_start'));

comment on column public.chat_settings.agent_work is
  'Agent work (00481, AC-011): approve_first ("I approve first", the default) holds every change an agent''s run makes for a person''s approval, whatever the agent''s mode; auto_start ("Agent starts on its own") lets each agent''s own mode apply. Going live is never affected. Admins change it; each change is kept in setting_changes.';

-- ─── The change log ─────────────────────────────────────────────────────────

create table if not exists public.setting_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The setting, by its key: 'agent_work' for now.
  setting_key text not null check (setting_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  -- Its value before (null: it was never set, so the default applied) and after.
  old_value text check (old_value is null or char_length(old_value) <= 200),
  new_value text not null check (char_length(new_value) <= 200),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists setting_changes_organization_key_idx
  on public.setting_changes (organization_id, setting_key, changed_at desc);

comment on table public.setting_changes is
  'Workspace settings (00481): each change made in the app, with its key, the value before and after, who changed it and when. Members read their workspace''s; the server writes.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.setting_changes enable row level security;

revoke all on table public.setting_changes from anon, authenticated;
grant select on table public.setting_changes to authenticated;
grant all on table public.setting_changes to service_role;

-- Members of the workspace read its changes; the server writes them.
drop policy if exists "setting_changes: member select" on public.setting_changes;
create policy "setting_changes: member select"
  on public.setting_changes
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
