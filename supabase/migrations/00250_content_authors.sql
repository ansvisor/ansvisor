-- ============================================================================
-- 00250: the workspace's authors (Content Editor Quality, CE-037)
-- ============================================================================
-- Settings › Authors (Quality spec §9): the real people a page is by. A
-- page's author is its metadata, never its content: the editor shows it as
-- a byline outside the page, Ansvisor sets the CMS author field on publish,
-- and Person schema names it. "Real people only. Content Agent can't add,
-- edit or invent authors": the server has no path that writes these.
--
--   * content_authors: one row per person, in an organization: name, title,
--     a short bio, profile links (sameAs), a photo. user_id is the member
--     the author is, when they are one.
--   * Anyone in the workspace adds authors; the author themself (user_id)
--     or an admin edits and deletes one.
--   * content_author_defaults: one default author per brand, which every
--     new page of the brand gets; admins and managers set it, as the
--     workspace's other settings. With none, a page is by the organization
--     ("{Brand} Team").

create table if not exists public.content_authors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  title text check (title is null or char_length(title) <= 120),
  bio text check (bio is null or char_length(bio) <= 400),
  photo_url text check (
    photo_url is null or (photo_url ~ '^https://' and char_length(photo_url) <= 2048)
  ),
  same_as text[] not null default '{}' check (cardinality(same_as) <= 10),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_authors_organization
  on public.content_authors (organization_id, name);

create or replace trigger content_authors_updated_at
  before update on public.content_authors
  for each row execute function public.handle_updated_at();

alter table public.content_authors enable row level security;

create policy "content_authors: member select"
  on public.content_authors
  for select
  using (organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid()));

create policy "content_authors: member insert"
  on public.content_authors
  for insert
  with check (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    and created_by = auth.uid()
    -- The member an author is belongs to its organization.
    and (user_id is null or user_id in (
      select p.id from public.profiles p where p.organization_id = content_authors.organization_id
    ))
  );

-- The author themself, or an admin of the organization.
create policy "content_authors: self or admin update"
  on public.content_authors
  for update
  using (
    user_id = auth.uid()
    or organization_id in (
      select p.organization_id from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid())
    and (user_id is null or user_id in (
      select p.id from public.profiles p where p.organization_id = content_authors.organization_id
    ))
  );

create policy "content_authors: self or admin delete"
  on public.content_authors
  for delete
  using (
    user_id = auth.uid()
    or organization_id in (
      select p.organization_id from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

grant select, insert, update, delete on public.content_authors to authenticated;

comment on table public.content_authors is
  'Content Editor Quality (CE-037): the workspace''s authors — real people a page is by (page metadata, never content). Anyone adds; the author themself or an admin edits. The server never writes them.';

create table if not exists public.content_author_defaults (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  author_id uuid not null references public.content_authors(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists content_author_defaults_author
  on public.content_author_defaults (author_id);

alter table public.content_author_defaults enable row level security;

create policy "content_author_defaults: member select"
  on public.content_author_defaults
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- Admins and managers of the brand's organization, with an author of it.
create policy "content_author_defaults: manager write"
  on public.content_author_defaults
  for all
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
    and author_id in (
      select a.id from public.content_authors a
      join public.brands b on b.organization_id = a.organization_id
      where b.id = brand_id
    )
    and updated_by = auth.uid()
  );

grant select, insert, update, delete on public.content_author_defaults to authenticated;

comment on table public.content_author_defaults is
  'Content Editor Quality (CE-037): the author every new page of a brand gets; none means the organization byline. Admins and managers set it.';
