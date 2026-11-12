-- ============================================================================
-- 00529: a person's Today and menu state, per brand (Simplify PR 6)
-- ============================================================================
-- The simplified layout (SIMPLE_NAV) keeps a little state for each person on
-- each brand. It lives on the server, so it holds on every device the person
-- uses (the owner's call, 2026-11-11: not the browser).
--
--   * nav_seen: when the person last opened each menu area,
--     { "<area>": "<ISO time>" }. A menu dot ("New results", "Needs you")
--     compares the newest data with it, and opening the page moves it on.
--     nav_seen.today is the person's last Today visit: "Since yesterday" and
--     the focus's "New" tag start from it.
--   * focus: Today's focus as the person keeps it, at most 3
--     [{ "id": "<action id>", "added_at": "<ISO time>" }]: an open action and
--     when it took its slot. Empty slots fill from the ranking.
--   * hidden: the cards the person hid or snoozed, { "<key>": "<ISO time>" }
--     until that time, or { "<key>": null } for good. The keys:
--       setup          "Finish setting up", hidden by someone who isn't an
--                      admin or manager (they hide it for the brand instead)
--       prompts_check  a brand's first day: "Check the prompts we track"
--       topic:<key>    "New area to track", Not now (30 days)
--       skip:<id>      a focus card's "Skip for now" (7 days); the action
--                      itself doesn't change
--
-- Why a table of its own: chat_user_prefs (00400) is per person, not per
-- brand, and is written only with the new Chat on; getting_started_steps is
-- per brand, not per person.
--
-- The web reads and writes it as the person (lib/actions/user-brand-state.ts),
-- never through the plan check: it is UI state, so it works while the
-- workspace is read-only and on the demo brand too, and it costs nothing.
-- RLS keeps every row the person's own, on a brand they can access (00388).
-- Each jsonb is checked here (its shape, 8 KB at most); the web checks the
-- area names, the keys and the times, and drops what has expired.

create table if not exists public.user_brand_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  nav_seen jsonb not null default '{}'::jsonb,
  focus jsonb not null default '[]'::jsonb,
  hidden jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, brand_id),
  -- An object of times, as text.
  constraint user_brand_state_nav_seen_check check (
    jsonb_typeof(nav_seen) = 'object'
    and octet_length(nav_seen::text) <= 8192
    and not jsonb_path_exists(nav_seen, '$.* ? (@.type() != "string")')
  ),
  -- A list of at most 3 objects, each with its action's id and when it was
  -- added, as text. A check can't count a non-array: the case guards it.
  constraint user_brand_state_focus_check check (
    jsonb_typeof(focus) = 'array'
    and octet_length(focus::text) <= 8192
    and case when jsonb_typeof(focus) = 'array' then jsonb_array_length(focus) <= 3 else false end
    and not jsonb_path_exists(
      focus,
      '$[*] ? (@.type() != "object" || !(@.id.type() == "string") || !(@.added_at.type() == "string"))'
    )
  ),
  -- An object of times, as text, or null for good.
  constraint user_brand_state_hidden_check check (
    jsonb_typeof(hidden) = 'object'
    and octet_length(hidden::text) <= 8192
    and not jsonb_path_exists(hidden, '$.* ? (@.type() != "string" && @.type() != "null")')
  )
);

-- The primary key serves the person's reads (user_id first); this serves
-- deleting a brand, whose rows go with it.
create index if not exists user_brand_state_brand_idx
  on public.user_brand_state (brand_id);

drop trigger if exists trg_user_brand_state_updated_at on public.user_brand_state;
create trigger trg_user_brand_state_updated_at
  before update on public.user_brand_state
  for each row execute function public.handle_updated_at();

-- ─── Who reads and writes ───────────────────────────────────────────────────
-- The person, on their own rows, for a brand they can access (00388). Rows on
-- a brand they lost access to stay, unread, and come back with the access.
-- No delete: the rows go with the person or the brand.

alter table public.user_brand_state enable row level security;
revoke all on table public.user_brand_state from anon, authenticated;
grant select, insert, update on table public.user_brand_state to authenticated;
grant all on table public.user_brand_state to service_role;

drop policy if exists "user_brand_state: own select" on public.user_brand_state;
create policy "user_brand_state: own select"
  on public.user_brand_state
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and brand_id in (select public.user_brand_ids())
  );

drop policy if exists "user_brand_state: own insert" on public.user_brand_state;
create policy "user_brand_state: own insert"
  on public.user_brand_state
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.can_access_brand(brand_id)
  );

drop policy if exists "user_brand_state: own update" on public.user_brand_state;
create policy "user_brand_state: own update"
  on public.user_brand_state
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and public.can_access_brand(brand_id)
  )
  with check (
    user_id = auth.uid()
    and public.can_access_brand(brand_id)
  );

comment on table public.user_brand_state is
  'A person''s Today and menu state per brand (00529, Simplify PR 6): when they last opened each menu area (nav_seen), the focus they keep (focus) and the cards they hid or snoozed (hidden). Theirs to read and write, on brands they can access; UI state, so written while read-only and on the demo brand too.';
comment on column public.user_brand_state.nav_seen is
  'When the person last opened each menu area: {"<area>": "<ISO time>"}. Menu dots and Today''s "Since yesterday" compare with it.';
comment on column public.user_brand_state.focus is
  'Today''s focus as the person keeps it: at most 3 [{"id": "<action id>", "added_at": "<ISO time>"}].';
comment on column public.user_brand_state.hidden is
  'Cards the person hid or snoozed: {"<key>": "<ISO time>"} until then, or null for good. Keys: setup, prompts_check, topic:<key>, skip:<action id>.';

notify pgrst, 'reload schema';
