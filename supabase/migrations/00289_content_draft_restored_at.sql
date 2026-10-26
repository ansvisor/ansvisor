-- ============================================================================
-- 00289: when a draft's page was last restored from History
-- ============================================================================
-- The editor opens the agent's card closed when its latest batch is from
-- before the page was last restored: that batch was for the page before
-- (#1522's follow-up, #1536). The "restore" version can't say when: it is
-- kept only when the page differs from the draft's latest version (00215,
-- content_draft_keep_version), so a restore right after Mark ready, or after
-- an Undo all, leaves none.
--
-- content_drafts.restored_at is set by content_draft_restore (00215) each
-- time it changes the page; a restore of the page the draft already is
-- leaves it as it was. Null for a draft never restored.

alter table public.content_drafts
  add column if not exists restored_at timestamptz;

comment on column public.content_drafts.restored_at is
  'When content_draft_restore last changed the page to a History version (00289): the agent''s batch from before it was for the page before. Null when never restored.';

-- As 00215's, with restored_at set when the page changes.
create or replace function public.content_draft_restore(p_version_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_version public.content_draft_versions%rowtype;
  v_draft public.content_drafts%rowtype;
begin
  select * into v_version
  from public.content_draft_versions v
  where v.id = p_version_id and v.created_at >= now() - interval '90 days';
  if v_version.id is null or not public.content_draft_member(v_version.draft_id) then
    return null;
  end if;

  select * into v_draft from public.content_drafts d where d.id = v_version.draft_id;
  -- Already this page: nothing to keep or change.
  if v_draft.title is distinct from v_version.title
     or v_draft.body_html is distinct from v_version.body_html then
    perform public.content_draft_keep_version(v_version.draft_id, 'restore');

    update public.content_drafts d
    set title = v_version.title, body_html = v_version.body_html, restored_at = now()
    where d.id = v_version.draft_id
    returning * into v_draft;
  end if;

  return jsonb_build_object(
    'title', v_draft.title,
    'bodyHtml', v_draft.body_html,
    'updatedAt', v_draft.updated_at
  );
end;
$$;

revoke all on function public.content_draft_restore(uuid) from public, anon;
grant execute on function public.content_draft_restore(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
