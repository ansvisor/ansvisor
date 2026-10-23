-- ============================================================================
-- 00262: Send to CMS, phase 1 (webhook) — #1331
-- ============================================================================
-- An admin or manager sends a Content Editor page to the brand's webhook as a
-- content package (its publishable HTML, title, slug, meta and page fields);
-- the workspace's own automation (Zapier, Make, n8n, its CMS) takes it from
-- there and may call back with the address it published at.
--
-- content_drafts gets the page's slug and meta, filled from the page and
-- editable in the Send dialog, and where it went live. A send is a row of
-- content_draft_deliveries: queued when reserved, then sent or failed, and
-- published once the callback names the live address. A table of its own,
-- not columns on content_drafts: a page is sent many times, and each send's
-- answer is kept (the draft gets only its slug, meta and live address).

alter table public.content_drafts
  add column if not exists slug text
    check (slug is null or (char_length(slug) between 1 and 200 and slug !~ '[/\s]')),
  add column if not exists meta_title text
    check (meta_title is null or char_length(meta_title) <= 300),
  add column if not exists meta_description text
    check (meta_description is null or char_length(meta_description) <= 500),
  add column if not exists published_url text
    check (
      published_url is null
      or (char_length(published_url) <= 2048 and published_url ~* '^https?://')
    ),
  add column if not exists published_at timestamptz;

comment on column public.content_drafts.slug is
  'The page''s URL slug for its CMS (Send to CMS, 00262): filled from the page, editable in the Send dialog.';
comment on column public.content_drafts.published_url is
  'Where the page went live: what the CMS called back with after a Send to CMS (00262).';

create table if not exists public.content_draft_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Kept when the draft goes (its title stays below), as the day's count does.
  draft_id uuid references public.content_drafts(id) on delete set null,
  sent_by uuid references public.profiles(id) on delete set null,
  -- A bulk send's deliveries share one, so the Library can follow them.
  batch_id uuid,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'published')),
  title text not null check (char_length(title) between 1 and 300),
  slug text check (slug is null or char_length(slug) <= 200),
  -- What the webhook answered: its HTTP status and the start of its body.
  http_status smallint,
  response_excerpt text check (response_excerpt is null or char_length(response_excerpt) <= 2000),
  error text check (error is null or char_length(error) <= 500),
  published_url text check (
    published_url is null
    or (char_length(published_url) <= 2048 and published_url ~* '^https?://')
  ),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  published_at timestamptz
);

create index if not exists content_draft_deliveries_org_created
  on public.content_draft_deliveries (organization_id, created_at desc);
create index if not exists content_draft_deliveries_draft_created
  on public.content_draft_deliveries (draft_id, created_at desc);
create index if not exists content_draft_deliveries_batch
  on public.content_draft_deliveries (batch_id) where batch_id is not null;

alter table public.content_draft_deliveries enable row level security;
revoke all on table public.content_draft_deliveries from anon, authenticated;
grant select on table public.content_draft_deliveries to authenticated;
grant all on table public.content_draft_deliveries to service_role;

-- Members read their workspace's deliveries; the server writes them.
drop policy if exists "content_draft_deliveries: member select" on public.content_draft_deliveries;
create policy "content_draft_deliveries: member select"
  on public.content_draft_deliveries
  for select
  using (organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid()));

comment on table public.content_draft_deliveries is
  'Send to CMS (#1331, 00262): each page sent to the brand''s webhook, as queued, sent, failed or published. Written by the server; read by the editor and the Library.';

-- ----------------------------------------------------------------------------
-- The day's cap: reserve_content_deliveries queues as many of the pages as the
-- workspace's last 24 hours leave room for (p_limit, 200), under a lock per
-- organization so sends at once can't pass it together (as 00243). It returns
-- the queued rows; pages past the cap get none.
-- p_items: [{ "draft_id", "title", "slug" }], in the order they go.
-- A row still queued after 15 minutes was left by a server that stopped
-- mid-batch: the next send closes it as interrupted (as 00249 closes runs),
-- so the Library tells it from one still going. It still counts for the day.
-- ----------------------------------------------------------------------------
create or replace function public.reserve_content_deliveries(
  p_organization_id uuid,
  p_brand_id uuid,
  p_sent_by uuid,
  p_batch_id uuid,
  p_items jsonb,
  p_limit integer
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

  update public.content_draft_deliveries
  set status = 'failed', error = 'Not sent: interrupted', sent_at = now()
  where organization_id = p_organization_id
    and status = 'queued'
    and created_at < now() - interval '15 minutes';

  select count(*) into used
  from public.content_draft_deliveries
  where organization_id = p_organization_id
    and created_at > now() - interval '24 hours';

  room := greatest(0, p_limit - used);
  if room = 0 or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;

  return query
  insert into public.content_draft_deliveries
    (organization_id, brand_id, draft_id, sent_by, batch_id, title, slug)
  select p_organization_id, p_brand_id, (item ->> 'draft_id')::uuid, p_sent_by, p_batch_id,
         left(item ->> 'title', 300), nullif(left(item ->> 'slug', 200), '')
  from jsonb_array_elements(p_items) with ordinality as items(item, position)
  order by position
  limit room
  returning *;
end;
$$;

revoke all on function public.reserve_content_deliveries(uuid, uuid, uuid, uuid, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_content_deliveries(uuid, uuid, uuid, uuid, jsonb, integer)
  to service_role;

-- ----------------------------------------------------------------------------
-- Webhooks: a page sent is an event a webhook subscribes to (00198's list).
-- ----------------------------------------------------------------------------
alter table public.webhook_configs
  drop constraint if exists webhook_configs_events_allowed;

alter table public.webhook_configs
  add constraint webhook_configs_events_allowed
  check (
    events <@ array[
      'opportunity.sent', 'daily_pulse.created', 'action_task.sent', 'content_draft.sent'
    ]::text[]
  );

comment on column public.webhook_configs.events is
  'Event types subscribed to by this webhook (opportunity.sent, daily_pulse.created, action_task.sent, content_draft.sent). webhook.test is always sent by the test action and is not stored here.';

notify pgrst, 'reload schema';
