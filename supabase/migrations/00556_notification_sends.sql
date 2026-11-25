-- ============================================================================
-- 00556: which notification e-mail went to whom (Settings › Notifications)
-- ============================================================================
-- The e-mails people choose in "Your e-mails" (00554) beyond the Daily Pulse
-- and the AI Traffic digest: a new Critical action, drafts waiting for review,
-- and the later kinds. Each sender claims a row here before it sends, so a
-- person gets each e-mail once, however often the sender runs or however
-- many server instances run it.
--
--   * kind: the e-mail, as notification_preferences names it.
--   * subject: what the e-mail is about, the sender's own key: an action
--     ("action:<id>"), a day's or a week's summary of a brand
--     ("daily:2026-11-20:<brand id>"). Unique per kind, person and subject.
--   * sent_at: set once the e-mail went out; a claim without it is a send
--     that failed after its claim, kept so it isn't sent twice.
--
-- Only the server reads and writes it (the service role): RLS on, no policy.
-- Schema only: it starts empty.

create table if not exists public.notification_sends (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    constraint notification_sends_kind_format check (kind ~ '^[a-z_]{1,40}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  brand_id uuid references public.brands (id) on delete cascade,
  subject text not null
    constraint notification_sends_subject_length check (char_length(subject) between 1 and 200),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_sends_once unique (kind, user_id, subject)
);

create index if not exists notification_sends_brand_idx
  on public.notification_sends (brand_id)
  where brand_id is not null;

alter table public.notification_sends enable row level security;
revoke all on table public.notification_sends from anon, authenticated;
grant all on table public.notification_sends to service_role;

comment on table public.notification_sends is
  'Notification e-mails sent (00556): one row per kind, person and subject, claimed before sending so each goes once. Server only.';
