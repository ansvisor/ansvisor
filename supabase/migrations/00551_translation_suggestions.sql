-- ============================================================================
-- 00551: "Suggest a better translation" (LOC-009)
-- ============================================================================
-- In any language but English, Settings › Account › Language and the account
-- menu's Language item offer "Suggest a better translation": a form that
-- already knows the screen and the language, where the person gives the text
-- as it reads now, their better version and, if they like, a note.
--
-- Each suggestion is a row here, in the review queue Ansvisor staff work
-- through (the review list, STAFF_EMAILS, with the service role). Accepting
-- one only marks the row: the string in messages/<locale>.json and the
-- glossary are changed by hand, by running web/scripts/translate-messages.mjs
-- again.
--
-- Schema only: no backfill. A person adds and reads their own rows (RLS);
-- staff read and change every row with the service role, which skips RLS.

create table if not exists public.translation_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The interface language the suggestion is for, a locale code such as tr or pt-BR.
  locale text not null check (locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  -- The screen the person was on (the address without a locale prefix).
  path text not null default '' check (char_length(path) <= 500),
  -- The messages key of the text, when it is known (found from the current text, or null).
  message_key text check (message_key is null or char_length(message_key) <= 300),
  current_text text not null check (char_length(current_text) between 1 and 1000),
  suggestion text not null check (char_length(suggestion) between 1 and 1000),
  note text not null default '' check (char_length(note) <= 1000),
  status text not null default 'new' check (status in ('new', 'accepted', 'rejected')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists translation_suggestions_status_created_idx
  on public.translation_suggestions (status, created_at desc);
create index if not exists translation_suggestions_user_idx
  on public.translation_suggestions (user_id, created_at desc);

alter table public.translation_suggestions enable row level security;

-- A person adds a suggestion as themselves, for their own organization.
create policy "translation_suggestions: insert own"
  on public.translation_suggestions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and organization_id = (
      select p.organization_id from public.profiles p where p.id = (select auth.uid())
    )
    and status = 'new'
  );

-- ... and reads their own, and no one else's.
create policy "translation_suggestions: read own"
  on public.translation_suggestions for select to authenticated
  using (user_id = (select auth.uid()));

-- No update or delete for anyone signed in: review is staff's, through the service role.
revoke update, delete on public.translation_suggestions from anon, authenticated;
revoke all on public.translation_suggestions from anon;

comment on table public.translation_suggestions is
  'Suggested better translations of the interface (LOC-009): a person''s own rows by RLS; staff review with the service role. Accepting only marks the row; messages/<locale>.json and the glossary are changed by hand.';
