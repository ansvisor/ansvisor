-- ============================================================================
-- 00426: a CMS publish into the impact ledger, one draft at a time
-- ============================================================================
-- A page the CMS confirmed live (Send to CMS #1331) is a ship event, once
-- per send (00425), and the same draft live again within 90 days of its
-- first cms_publish is that one, noted (republished_at), not a second. The
-- server decided this in separate reads and writes, so two sends of one
-- draft confirmed at the same moment could each miss the other and write
-- two ship events, which then make each other Not measurable
-- (overlapping_change).
--
--   * ship_cms_publish: the decision and its write in one transaction,
--     under a lock on the draft: the send's own ship event if it has one;
--     else the draft's latest cms_publish shipped within 90 days before it,
--     noted (republished_at only ever forward) with the send; else a new
--     ship event. Only a cms_publish takes a send in: a ship event of
--     another kind on the same draft (Mark as shipped, Chat) is its own.
--     Says the ship event's id and whether this call wrote it. Service role
--     only; the server reads the send and its draft first.
--   * republished_delivery_ids: the sends noted on a ship event, so the
--     nightly job doesn't take them for sends whose ship event is missing.
--     At most 50; past that a send is noted by its date only.

alter table public.ship_events
  add column if not exists republished_delivery_ids uuid[] not null default '{}'
    check (cardinality(republished_delivery_ids) <= 50);

comment on column public.ship_events.republished_delivery_ids is
  'The CMS sends (content_draft_deliveries) of the same draft noted on this cms_publish as published again within 90 days, at most 50 (00426).';

create or replace function public.ship_cms_publish(
  p_delivery_id uuid,
  p_organization_id uuid,
  p_brand_id uuid,
  p_content_draft_id uuid,
  p_title text,
  p_url text,
  p_action_id uuid,
  p_shipped_at timestamptz,
  p_shipped_by uuid,
  p_execution_mode text
)
returns table (ship_event_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_delivery_id is null or p_shipped_at is null then
    raise exception 'a send and its publish time are needed' using errcode = '22023';
  end if;
  -- Every send of one draft waits for the one before it.
  if p_content_draft_id is not null then
    perform pg_advisory_xact_lock(hashtext('ship_cms_publish:' || p_content_draft_id::text));
  end if;

  -- The send's own, written before (a confirmation read twice).
  select s.id into v_id
  from public.ship_events s
  where s.content_draft_delivery_id = p_delivery_id;
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  -- The same draft live again within 90 days: its first cms_publish goes on.
  if p_content_draft_id is not null then
    select s.id into v_id
    from public.ship_events s
    where s.brand_id = p_brand_id
      and s.content_draft_id = p_content_draft_id
      and s.kind = 'cms_publish'
      and s.shipped_at >= p_shipped_at - interval '90 days'
    order by s.shipped_at desc, s.id desc
    limit 1;
    if v_id is not null then
      update public.ship_events s
      set republished_at = case
            when p_shipped_at > coalesce(s.republished_at, s.shipped_at) then p_shipped_at
            else s.republished_at
          end,
          republished_delivery_ids = case
            when p_delivery_id = any (s.republished_delivery_ids)
              or cardinality(s.republished_delivery_ids) >= 50
              then s.republished_delivery_ids
            else s.republished_delivery_ids || p_delivery_id
          end
      where s.id = v_id;
      return query select v_id, false;
      return;
    end if;
  end if;

  insert into public.ship_events (
    organization_id, brand_id, kind, title, content_draft_id, content_draft_delivery_id,
    url, action_id, source, change_type, shipped_at, shipped_by, execution_mode
  ) values (
    p_organization_id, p_brand_id, 'cms_publish', p_title, p_content_draft_id, p_delivery_id,
    p_url, p_action_id, 'content_editor', 'content', p_shipped_at, p_shipped_by, p_execution_mode
  )
  on conflict (content_draft_delivery_id) do nothing
  returning id into v_id;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;
  -- A send without a draft, confirmed twice at once: the other call wrote it.
  select s.id into v_id
  from public.ship_events s
  where s.content_draft_delivery_id = p_delivery_id;
  return query select v_id, false;
end;
$$;

revoke all on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text)
  from public, anon, authenticated;
grant execute on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text)
  to service_role;

comment on function public.ship_cms_publish(uuid, uuid, uuid, uuid, text, text, uuid, timestamptz, uuid, text) is
  'Impact ledger (00426): a CMS-confirmed publish as a ship event, under a lock on its draft: the send''s own, else the draft''s cms_publish within 90 days noted, else a new one. Says the id and whether this call wrote it. Service role only.';

notify pgrst, 'reload schema';
