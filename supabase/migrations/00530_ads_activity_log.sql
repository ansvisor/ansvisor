-- ============================================================================
-- 00530: Ads' append-only activity log (ADS-01 §7a rule 17, Phase 0 PR 5)
-- ============================================================================
-- Behind ADS_ENABLED; nothing writes it yet. One row per Ads event: who (a
-- person, or an agent's run and its chat run), what, before and after, and an
-- export's row count and file name (§7a rule 16). Never a token or a person's
-- details: the check below refuses the obvious ones, lib/ads/activity.js more.
--
--   * Append-only (§7a acceptance 7), Admins and the service role included:
--     the trigger refuses every update, delete and truncate (00124's pattern).
--     The one way out is purge_ads_activity_log(), for a retention job: rows
--     older than a year, run by the service role only; no route calls it.
--   * No foreign keys: a row outlives its brand, person and run, and deleting
--     one must not fail on the log (a cascade or set null would be refused).
--   * A person reads their own rows, an Admin the workspace's (00402, with
--     00424's brand access). Only the server inserts.

create table if not exists public.ads_activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  -- Null for a workspace event (its thresholds).
  brand_id uuid,
  -- The person, or the agent's run (chat_agent_runs) and its chat run (chat_runs).
  actor_user_id uuid,
  agent_run_id uuid,
  chat_run_id uuid,
  -- decision.set, settings.changed, export.created…
  event text not null check (event ~ '^[a-z][a-z_]{1,39}(\.[a-z][a-z_]{1,39}){1,2}$'),
  target jsonb not null default '{}'::jsonb,
  "before" jsonb,
  "after" jsonb,
  row_count integer check (row_count is null or row_count >= 0),
  file_name text check (file_name is null or char_length(file_name) between 1 and 200),
  created_at timestamptz not null default now(),
  check (actor_user_id is not null or agent_run_id is not null),
  check (agent_run_id is null or chat_run_id is not null),
  check (jsonb_typeof(target) = 'object' and octet_length(target::text) <= 4096),
  check ("before" is null or (jsonb_typeof("before") = 'object' and octet_length("before"::text) <= 8192)),
  check ("after" is null or (jsonb_typeof("after") = 'object' and octet_length("after"::text) <= 8192)),
  -- No key that names a secret or a person's details, and no e-mail address, anywhere in them.
  constraint ads_activity_log_no_secrets_check check (
    not jsonb_path_exists(
      jsonb_build_array(target, coalesce("before", '{}'::jsonb), coalesce("after", '{}'::jsonb)),
      'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "token|secret|passw|api_?key|authori[sz]ation|bearer|cookie|credential|private_?key|e_?mail|phone|first_?name|last_?name|full_?name|birth|ip_?addr|user_?agent" flag "i")'
    )
    and not jsonb_path_exists(
      jsonb_build_array(target, coalesce("before", '{}'::jsonb), coalesce("after", '{}'::jsonb)),
      'strict $.** ? (@.type() == "string" && @ like_regex "[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}" flag "i")'
    )
  )
);

-- Admins: the workspace's log, newest first. Members: their own.
create index if not exists ads_activity_log_organization_created_idx
  on public.ads_activity_log (organization_id, created_at desc);
create index if not exists ads_activity_log_actor_created_idx
  on public.ads_activity_log (actor_user_id, created_at desc);

comment on table public.ads_activity_log is
  'Ads (00530, ADS-01 §7a rule 17): one row per Ads event: who (a person, or an agent run and its chat run), event, target, before and after, and an export''s row count and file name. Append-only: the trigger refuses every update, delete and truncate; purge_ads_activity_log() alone removes rows older than a year. A person reads their own rows, an Admin the workspace''s; the server inserts.';

-- ─── Append-only ────────────────────────────────────────────────────────────

create or replace function public.ads_activity_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The retention purge, and nothing else: a row past a year, inside purge_ads_activity_log().
  if tg_op = 'DELETE' then
    if current_setting('ads.activity_log_purge', true) = 'on'
      and old.created_at < now() - interval '1 year' then
      return old;
    end if;
  end if;
  raise exception 'The Ads activity log is append-only: its rows cannot be changed or deleted'
    using errcode = '42501';
end;
$$;

drop trigger if exists ads_activity_log_append_only on public.ads_activity_log;
create trigger ads_activity_log_append_only
  before update or delete on public.ads_activity_log
  for each row execute function public.ads_activity_log_append_only();

drop trigger if exists ads_activity_log_no_truncate on public.ads_activity_log;
create trigger ads_activity_log_no_truncate
  before truncate on public.ads_activity_log
  for each statement execute function public.ads_activity_log_append_only();

-- The one purge path, for a retention job (Retention follows CHAT-20): rows
-- older than p_before, which must be at least a year ago, oldest first,
-- p_limit at a time. Answers how many it deleted.
create or replace function public.purge_ads_activity_log(p_before timestamptz, p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_before is null or p_before > now() - interval '1 year' then
    raise exception 'Ads activity log rows are kept for at least a year';
  end if;
  perform set_config('ads.activity_log_purge', 'on', true);
  delete from public.ads_activity_log
  where id in (
    select id from public.ads_activity_log
    where created_at < p_before
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 5000), 10000))
  );
  get diagnostics v_deleted = row_count;
  perform set_config('ads.activity_log_purge', 'off', true);
  return v_deleted;
end;
$$;

revoke all on function public.purge_ads_activity_log(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.purge_ads_activity_log(timestamptz, integer) to service_role;

-- ─── Who reads and writes ───────────────────────────────────────────────────
-- The service role reads and inserts, nothing more.

alter table public.ads_activity_log enable row level security;

revoke all on table public.ads_activity_log from anon, authenticated, service_role;
grant select on table public.ads_activity_log to authenticated;
grant select, insert on table public.ads_activity_log to service_role;

-- A person's own rows, and every row of the workspace for its Admins, while
-- they belong to it; a brand's rows only for those who can access the brand.
drop policy if exists "ads_activity_log: own or admin select" on public.ads_activity_log;
create policy "ads_activity_log: own or admin select"
  on public.ads_activity_log
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or ads_activity_log.actor_user_id = auth.uid())
    )
    and (
      (brand_id is null and (select public.user_has_all_brands()))
      or brand_id in (select public.user_brand_ids())
    )
  );

notify pgrst, 'reload schema';
