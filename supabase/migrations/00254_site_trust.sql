-- ============================================================================
-- 00254: a brand's site trust (Content Editor Quality, CE-043)
-- ============================================================================
-- Site trust (Quality spec §8): five site-level checks Site Audit shows as
-- "Site trust {n}/5", and Trust gives 5 points on every page from:
--
--   * about: an About page;
--   * contact: a Contact page;
--   * editorial: an editorial policy (or "How we review") page;
--   * organizationSchema: Organization schema on the home page;
--   * authorPages: a page for each author in Settings › Authors.
--
-- The server reads them from the brand's page list (site_pages) and its home
-- page, at most once a day or when someone asks again; this is the last
-- read. Members read it; only the server writes it.

create table if not exists public.site_trust (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  checks jsonb not null,
  score smallint not null check (score between 0 and 5),
  checked_at timestamptz not null default now()
);

alter table public.site_trust enable row level security;

create policy "site_trust: member select"
  on public.site_trust
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

revoke all on table public.site_trust from anon;
grant select on table public.site_trust to authenticated;
grant all on table public.site_trust to service_role;

comment on table public.site_trust is
  'Content Editor Quality (CE-043): a brand''s five site trust checks (About, Contact, editorial policy, Organization schema on the home page, author pages) and how many pass. Written by the server, read by members.';
