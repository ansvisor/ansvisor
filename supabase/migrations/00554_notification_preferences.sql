-- ============================================================================
-- 00554: a person's own e-mail choices (Settings › Notifications, "Your e-mails")
-- ============================================================================
-- Until now the Daily Pulse (00036) and the AI Traffic weekly digest (00187)
-- were set per brand, for everyone: pulse_settings' frequency and recipient
-- list. Now each person picks the e-mails they get and how often; the brand's
-- pulse_settings stay for people outside the workspace (its recipients) and
-- for teammates who haven't saved their own choices yet.
--
--   * one row per person, workspace, e-mail kind and brand scope: brand_id
--     null is "All my brands", a brand's row overrides it for that brand.
--     Account e-mails (AI usage) only ever have the null row.
--   * frequency: the choice, from the kind's own list (the web checks which
--     fit a kind): instant, daily, weekly, notable, on or off.
--   * delivery: brand e-mails one per brand, or all brands in one e-mail.
--     The person's choice, the same on each of their rows.
--
-- Nothing is copied here. A person with no rows gets what pulse_settings gives
-- them today (the web shows it as their starting choices, the senders send
-- by it), so nobody's e-mail changes until they save their own.
--
-- A person reads and writes only their own rows, in their own workspace, and
-- a brand's row only for a brand they can reach (brand access, 00388).
-- save_notification_preferences replaces a person's rows in one go.

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  -- Null: All my brands.
  brand_id uuid references public.brands (id) on delete cascade,
  frequency text not null,
  delivery text not null default 'per_brand',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_kind_check check (
    kind in (
      'daily_pulse',
      'traffic_digest',
      'critical_action',
      'due_actions',
      'weekly_actions',
      'run_finished',
      'audit_finished',
      'score_dropped',
      'drafts_review',
      'ai_usage'
    )
  ),
  constraint notification_preferences_frequency_check check (
    frequency in ('instant', 'daily', 'weekly', 'notable', 'on', 'off')
  ),
  constraint notification_preferences_delivery_check check (
    delivery in ('per_brand', 'combined')
  ),
  constraint notification_preferences_scope_key unique nulls not distinct (
    user_id, organization_id, kind, brand_id
  )
);

-- The senders read a workspace's rows: who saved, and their choices.
create index if not exists notification_preferences_org_kind_idx
  on public.notification_preferences (organization_id, kind);

create index if not exists notification_preferences_brand_idx
  on public.notification_preferences (brand_id)
  where brand_id is not null;

drop trigger if exists trg_notification_preferences_updated_at on public.notification_preferences;
create trigger trg_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.handle_updated_at();

alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from anon, authenticated;
grant select, insert, update, delete on table public.notification_preferences to authenticated;
grant all on table public.notification_preferences to service_role;

drop policy if exists "notification_preferences: own rows" on public.notification_preferences;
create policy "notification_preferences: own rows"
  on public.notification_preferences
  for all
  to authenticated
  using (
    user_id = auth.uid()
    and organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  )
  with check (
    user_id = auth.uid()
    and organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    and (
      brand_id is null
      or brand_id in (
        select b.id from public.brands b
        where b.organization_id = notification_preferences.organization_id
          and public.can_access_brand(b.id)
      )
    )
  );

-- Replaces the caller's rows in their workspace with p_rows, in one go:
-- [{"kind", "brand_id" (or null), "frequency", "delivery"}]. Runs as the
-- caller, so the policy above checks every row.
create or replace function public.save_notification_preferences(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.profiles where id = auth.uid();
  if v_org is null then
    raise exception 'No organization';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Invalid preferences';
  end if;

  delete from public.notification_preferences
  where user_id = auth.uid() and organization_id = v_org;

  insert into public.notification_preferences (user_id, organization_id, kind, brand_id, frequency, delivery)
  select auth.uid(), v_org, r.kind, r.brand_id, r.frequency, coalesce(r.delivery, 'per_brand')
  from jsonb_to_recordset(p_rows) as r(kind text, brand_id uuid, frequency text, delivery text);
end;
$$;

revoke all on function public.save_notification_preferences(jsonb) from public, anon;
grant execute on function public.save_notification_preferences(jsonb) to authenticated;

comment on table public.notification_preferences is
  'A person''s own e-mail choices (00554, Settings › Notifications): per kind, for All my brands (brand_id null) or one brand, how often, and one e-mail per brand or all in one. No rows: what pulse_settings gives them, until they save.';
comment on column public.notification_preferences.brand_id is
  'Null: All my brands. A brand''s row overrides it for that brand.';
comment on column public.notification_preferences.frequency is
  'instant, daily, weekly, notable, on or off, from the kind''s own list.';
comment on column public.notification_preferences.delivery is
  'Brand e-mails one per brand (per_brand) or all brands in one (combined): the person''s choice, the same on each of their rows.';
