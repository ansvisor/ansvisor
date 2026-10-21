-- ============================================================================
-- 00233: archive and delete Library drafts (Content Editor, CE-002)
-- ============================================================================
-- The Library's rows get a menu (the user's request): a status to pick, Send
-- to Archive, and Delete. Admins and managers archive and delete, as they
-- hide the Plan's rows (00229); every member can still change a status.
--
--   * content_drafts.archived_at / archived_by: an archived draft keeps its
--     status, so Restore puts it back where it was. Archive is not a status:
--     the Agent API, MCP and the editor read the four statuses unchanged.
--   * guard_content_draft_archive: only an admin or a manager of the brand's
--     organization (or the server) sets or clears archived_at; archived_by is
--     the person who archived, set here rather than trusted from the app.
--   * "content_drafts: manager delete": content_drafts had no delete policy,
--     so no member could delete a draft. Its versions, sources and
--     suggestions go with it (on delete cascade); the Action Center task it
--     was sent as stays, and Improve usage keeps its row (set null).

alter table public.content_drafts
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

comment on column public.content_drafts.archived_at is
  'When an admin or manager archived the draft (Library › Archived); null when it is not archived. It keeps its status.';
comment on column public.content_drafts.archived_by is
  'Who archived the draft; set by guard_content_draft_archive.';

create or replace function public.guard_content_draft_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not distinct from old.archived_at then
    -- archived_by follows archived_at only.
    new.archived_by := old.archived_by;
    return new;
  end if;

  -- A role that bypasses RLS is server-side (service role, migrations).
  if not (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user)
     and not exists (
       select 1
       from public.brands b
       join public.profiles p on p.organization_id = b.organization_id
       where b.id = new.brand_id
         and p.id = auth.uid()
         and p.role in ('admin', 'manager')
     )
  then
    raise exception 'only admins and managers archive content drafts'
      using errcode = '42501';
  end if;

  new.archived_by := case when new.archived_at is null then null else auth.uid() end;
  return new;
end;
$$;

create or replace trigger content_drafts_guard_archive
  before update on public.content_drafts
  for each row execute function public.guard_content_draft_archive();

create policy "content_drafts: manager delete"
  on public.content_drafts
  for delete
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

grant delete on public.content_drafts to authenticated;
