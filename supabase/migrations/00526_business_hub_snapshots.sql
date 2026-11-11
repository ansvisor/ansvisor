-- ============================================================================
-- 00526: ChatGPT Business Hub numbers, as a brand's members enter them
-- ============================================================================
-- Business Hub (Businesses in ChatGPT) shows a business how often ChatGPT
-- referenced its website (Mentions), the clicks on its links (Website
-- clicks), its profile's views and its top five discovery topics, over the
-- last 7 or 28 days. It has no export or API, and keeps no history. A
-- member copies the numbers into Ansvisor by hand or from Ansvisor's own
-- CSV template; Visibility shows them beside Ansvisor's ChatGPT numbers for
-- the same days, and keeps the history Business Hub doesn't. Behind
-- BUSINESS_HUB_ENABLED until Business Hub's names are confirmed.
--
--   * business_hub_snapshots: one entry per brand, length (7 or 28 days)
--     and last day. A number left empty (null) is one Business Hub doesn't
--     show: below its volume threshold, or a box it doesn't have. Topics
--     are the person's own words, trimmed, without control characters,
--     five at most of 120 characters at most.
--
-- Members of the brand read them. Only the server writes (as brand_facts'
-- values, 00269): it checks the numbers, the dates and the topics, and who
-- may delete an entry (admins and managers); every member may enter one.
-- The demo brand's entries are sample data, refused to anyone else.

create table if not exists public.business_hub_snapshots (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  period_days smallint not null check (period_days in (7, 28)),
  period_end date not null,
  mentions integer check (mentions is null or mentions >= 0),
  website_clicks integer check (website_clicks is null or website_clicks >= 0),
  profile_views integer check (profile_views is null or profile_views >= 0),
  discovery_topics text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual', 'csv')),
  entered_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, period_days, period_end),
  -- Five topics at most, none null or empty, none with a control character
  -- (so a line break splits them one per line), and none over 120
  -- characters. A check can't read the array with a subquery.
  constraint business_hub_snapshots_topics_check check (
    cardinality(discovery_topics) <= 5
    and array_position(discovery_topics, null) is null
    and not ('' = any (discovery_topics))
    and array_to_string(discovery_topics, '') !~ '[[:cntrl:]]'
    and array_to_string(discovery_topics, E'\n') !~ '[^\n]{121}'
  )
);

create index if not exists business_hub_snapshots_brand_end_idx
  on public.business_hub_snapshots (brand_id, period_end desc);

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.business_hub_snapshots enable row level security;
revoke all on table public.business_hub_snapshots from anon, authenticated;
grant select on table public.business_hub_snapshots to authenticated;
grant all on table public.business_hub_snapshots to service_role;

-- Through the brands table, so brand access (00388, 00389) applies.
drop policy if exists "business_hub_snapshots: member select" on public.business_hub_snapshots;
create policy "business_hub_snapshots: member select"
  on public.business_hub_snapshots
  for select
  to authenticated
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create or replace trigger business_hub_snapshots_refuse_demo_brand_writes
  before insert or update or delete on public.business_hub_snapshots
  for each row execute function public.refuse_demo_brand_writes();

comment on table public.business_hub_snapshots is
  'ChatGPT Business Hub numbers (00526), entered by a brand''s members by hand or from Ansvisor''s CSV template: Mentions, Website clicks, Profile views (null where Business Hub shows none) and the top five discovery topics, for 7 or 28 days ending period_end. One per brand, length and last day. Members read; the server writes.';
comment on column public.business_hub_snapshots.mentions is
  'Business Hub''s Mentions over the period: ChatGPT referencing the brand''s website, as OpenAI describes it. Null: not shown.';
comment on column public.business_hub_snapshots.website_clicks is
  'Business Hub''s Website clicks over the period: clicks on links to the site in ChatGPT. Null: not shown.';
comment on column public.business_hub_snapshots.profile_views is
  'Business Hub''s Profile views over the period. Null: not shown (the box may not be there).';
comment on column public.business_hub_snapshots.discovery_topics is
  'Business Hub''s top discovery topics, as typed: five at most, 120 characters each, trimmed, without control characters.';
comment on column public.business_hub_snapshots.source is
  'How it was entered: manual (the Enter numbers dialog) or csv (Ansvisor''s template).';
comment on column public.business_hub_snapshots.entered_by is
  'Who entered it last; null once they are gone.';

notify pgrst, 'reload schema';
