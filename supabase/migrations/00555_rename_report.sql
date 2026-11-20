-- ============================================================================
-- 00555: rename a report (UX audit RP-11)
-- ============================================================================
-- Reports are immutable snapshots (00023): there is no UPDATE policy, and
-- there still isn't. The one thing a person may change is a report's title,
-- through this function: it writes `title` alone, never the snapshot, for a
-- report of a brand the caller may see (can_access_brand, 00388). A blank
-- title or one over 200 characters is refused. It answers whether a report
-- was renamed: false for one the caller can't see, or that doesn't exist.
-- The demo brand's trigger (00381) still refuses its writes.
--
-- Functions only: nothing to backfill.

create or replace function public.rename_report(p_report_id uuid, p_title text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  if v_title is null or char_length(v_title) > 200 then
    raise exception 'A report title is 1 to 200 characters' using errcode = '22023';
  end if;
  update public.reports r
     set title = v_title
   where r.id = p_report_id
     and public.can_access_brand(r.brand_id);
  return found;
end;
$$;

revoke all on function public.rename_report(uuid, text) from public, anon;
grant execute on function public.rename_report(uuid, text) to authenticated;

comment on function public.rename_report(uuid, text) is
  'Renames a report (UX audit RP-11): its title alone, for a brand the caller may see (can_access_brand). Reports stay immutable snapshots otherwise (00023). Answers whether a report was renamed.';
