-- ============================================================================
-- 00522: HubSpot blog posts for Send to CMS (#2140)
-- ============================================================================
-- After Webflow (00283, 00284), WordPress (00294), Framer (00295) and Wix
-- (00372), a brand sends pages to its HubSpot blog, as draft posts, through
-- the HubSpot account it connected in Settings › Integrations (per brand,
-- brand_integrations provider 'hubspot'; no migration made that). The blog
-- pages go to is the brand's HubSpot setting (brand_integrations.settings),
-- and nothing goes without the consent to send pages as drafts.
--
--   * content_draft_deliveries.target takes 'hubspot'. `target_collection`
--     keeps the HubSpot blog's id the post was written to; its id is
--     external_id, so the page's next send updates that post's draft.
--   * reserve_content_deliveries: as 00372, a page already queued for the
--     same CMS (HubSpot among them) isn't sent there again meanwhile.
--
-- 00521 is kept for marking HubSpot contacts (#2140, part 2).

alter table public.content_draft_deliveries
  drop constraint if exists content_draft_deliveries_target_check,
  add constraint content_draft_deliveries_target_check
    check (target in ('webhook', 'webflow', 'wordpress', 'framer', 'wix', 'hubspot'));

comment on column public.content_draft_deliveries.target is
  'Where the page was sent (00284, 00294, 00295, 00372, 00522): the brand''s webhook, its Webflow collection, its WordPress site, its Framer collection, its Wix site''s Blog or its HubSpot blog.';
comment on column public.content_draft_deliveries.target_collection is
  'The Webflow or Framer collection (00284, 00295), the WordPress site''s address (00294), the Wix site''s id (00372) or the HubSpot blog''s id (00522) the page''s item or post was written to; its id is external_id.';

-- ----------------------------------------------------------------------------
-- As 00372, with HubSpot among the CMSs a page isn't sent to twice at once.
-- ----------------------------------------------------------------------------
create or replace function public.reserve_content_deliveries(
  p_organization_id uuid,
  p_brand_id uuid,
  p_sent_by uuid,
  p_batch_id uuid,
  p_items jsonb,
  p_limit integer,
  p_target text default 'webhook'
)
returns setof public.content_draft_deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
  room integer;
begin
  perform pg_advisory_xact_lock(hashtext('content_deliveries:' || p_organization_id::text));

  -- sent_at stays empty: it was never sent, and its time stays its own.
  update public.content_draft_deliveries
  set status = 'failed', error = 'Not sent: interrupted'
  where organization_id = p_organization_id
    and status = 'queued'
    and created_at < now() - interval '30 minutes';

  select count(*) into used
  from public.content_draft_deliveries
  where organization_id = p_organization_id
    and created_at > now() - interval '24 hours';

  room := greatest(0, p_limit - used);
  if room = 0 or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;

  -- Under the lock, so two sends of one page can't both pass: both would
  -- make an item (Webflow refuses the second on its slug) or a post.
  if p_target in ('webflow', 'wordpress', 'framer', 'wix', 'hubspot') and exists (
    select 1
    from public.content_draft_deliveries d
    join jsonb_array_elements(p_items) as items(item)
      on d.draft_id = (item ->> 'draft_id')::uuid
    where d.organization_id = p_organization_id
      and d.target = p_target
      and d.status = 'queued'
  ) then
    raise exception 'delivery_in_progress' using errcode = 'P0001';
  end if;

  return query
  insert into public.content_draft_deliveries
    (organization_id, brand_id, draft_id, sent_by, batch_id, title, slug, target)
  select p_organization_id, p_brand_id, (item ->> 'draft_id')::uuid, p_sent_by, p_batch_id,
         left(item ->> 'title', 300), nullif(left(item ->> 'slug', 200), ''),
         coalesce(p_target, 'webhook')
  from jsonb_array_elements(p_items) with ordinality as items(item, position)
  order by position
  limit room
  returning *;
end;
$$;

revoke all on function public.reserve_content_deliveries(uuid, uuid, uuid, uuid, jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.reserve_content_deliveries(uuid, uuid, uuid, uuid, jsonb, integer, text)
  to service_role;

notify pgrst, 'reload schema';
