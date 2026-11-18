-- ============================================================================
-- 00543 (provisional): merging duplicate competitors
-- ============================================================================
-- A brand that tracks one company twice ("Sky Air" and "Sky Air Tours", or
-- the same site under two names) merges them: an admin or a manager picks the
-- one to keep, and the others become its other names.
--
-- From the merge on, an answer naming any of them counts for the kept one:
-- tracking matches the merged ones' names and domains as the kept one's own
-- (server/src/lib/competitor-aliases.js, response-parser.js), and so does the
-- Perception tab's terms refresh (refresh_mention_terms, below).
--
-- No history row moves. A merged competitor leaves the competitors table and
-- is kept here, with its own id, name, domain and type, so:
--   * every read of the brand's competitors (the ~45 database functions, the
--     server's and the web's reads, Chat and MCP) already leaves it out, the
--     way it leaves out a deleted one: they all join the live competitors;
--   * its past numbers stay in the rollups and answers under its own id,
--     untouched and hidden. The kept one's history before the merge is its
--     own counts only: numbers from before the merge aren't combined;
--   * unmerging puts the same row back (merged_competitors -> competitors,
--     same id), and its history shows again. What was counted for the kept
--     one while they were merged stays with the kept one.
-- The rows the competitors foreign keys drop with it (its cited pages'
-- events and its last timeline read, both small) are kept here too and put
-- back on unmerge. Its Action Center links are marked removed as a delete
-- marks them (00244), and un-marked on unmerge.
--
-- Schema and functions only, no backfill: one new table of a few rows a
-- brand, its trigger and policy, two functions that change one brand's few
-- competitor rows when a person merges or unmerges, and refresh_mention_terms
-- with the other names added. Re-runnable: if not exists, drop … if exists,
-- create or replace.

-- ── merged_competitors ──────────────────────────────────────────────────────

create table if not exists public.merged_competitors (
  -- The merged competitor's own id, as its answers and rollups keep it.
  id             uuid primary key,
  brand_id       uuid not null references public.brands(id) on delete cascade,
  -- The competitor it was merged into: a live one of the same brand (the
  -- trigger below). Removing the kept one removes the ones merged into it.
  merged_into_id uuid not null references public.competitors(id) on delete cascade,
  name           text not null,
  domain         text not null default '',
  type           text,
  -- When it was first added, put back on unmerge.
  created_at     timestamptz not null,
  merged_at      timestamptz not null default now(),
  merged_by      uuid references auth.users(id) on delete set null,
  -- Its cited pages' events (competitor_page_events, 00376), without its id,
  -- and its last timeline read, which the competitors foreign keys drop.
  page_events    jsonb not null default '[]'::jsonb,
  scanned_at     timestamptz,
  constraint merged_competitors_not_itself check (id <> merged_into_id)
);

create index if not exists merged_competitors_brand_idx
  on public.merged_competitors (brand_id);
create index if not exists merged_competitors_kept_idx
  on public.merged_competitors (merged_into_id);

comment on table public.merged_competitors is
  'Competitors merged into another of the brand''s (00543): the merged one''s own row, kept out of competitors so every read leaves it out, with the competitor it was merged into, when and by whom. Its names and domain are the kept one''s other names for new answers; its history stays under its own id. Unmerge puts the row back. Members read; merge_competitors and unmerge_competitor write.';

-- The competitor kept is the brand's, live (not itself merged), and the
-- merged one is no longer a live competitor.
create or replace function public.merged_competitors_check()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.competitors c
    where c.id = new.merged_into_id and c.brand_id = new.brand_id
  ) then
    raise exception 'A competitor can only be merged into a tracked competitor of the same brand.'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.competitors c where c.id = new.id) then
    raise exception 'A merged competitor can''t also be a tracked competitor.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.merged_competitors_check() from public, anon, authenticated;

drop trigger if exists merged_competitors_check on public.merged_competitors;
create trigger merged_competitors_check
  before insert or update of id, brand_id, merged_into_id on public.merged_competitors
  for each row execute function public.merged_competitors_check();

alter table public.merged_competitors enable row level security;
revoke all on table public.merged_competitors from anon, authenticated;
grant select on table public.merged_competitors to authenticated;
grant all on table public.merged_competitors to service_role;

-- Members who can access the brand read its merged competitors, as they read
-- its competitors. Nobody writes the table directly: the functions below do.
drop policy if exists "merged_competitors: member select" on public.merged_competitors;
create policy "merged_competitors: member select" on public.merged_competitors
  for select
  to authenticated
  using (public.can_access_brand(brand_id));

-- ── merge_competitors ───────────────────────────────────────────────────────
-- Merges p_merged_ids into p_kept_id, all of p_brand_id. For an admin or a
-- manager of the brand's organization who can access the brand; p_user_id is
-- the person the service role merges for, a signed-in caller is always
-- auth.uid(). Refuses a kept or merged competitor of another brand, the kept
-- one among the merged, and a kept one that is itself merged. One already
-- merged is left as it is and listed under `already` (a merge run twice
-- changes nothing). A competitor merged into one being merged now follows it
-- to the kept one.

create or replace function public.merge_competitors(
  p_brand_id   uuid,
  p_kept_id    uuid,
  p_merged_ids uuid[],
  p_user_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_person  uuid := case when auth.role() = 'service_role' then p_user_id else auth.uid() end;
  v_kept    public.competitors;
  v_row     public.competitors;
  v_id      uuid;
  v_ids     uuid[];
  v_into    uuid;
  v_events  jsonb;
  v_scanned timestamptz;
  v_merged  jsonb := '[]'::jsonb;
  v_already jsonb := '[]'::jsonb;
begin
  if p_brand_id is null or p_kept_id is null then
    raise exception 'A brand and the competitor to keep are required.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_person
      and p.organization_id = (select b.organization_id from public.brands b where b.id = p_brand_id)
      and p.role = any (array['admin', 'manager']::public.user_role[])
      and public.can_access_brand(p_brand_id, p.id)
  ) then
    raise exception 'Only an admin or a manager can merge this brand''s competitors.'
      using errcode = '42501';
  end if;

  select array_agg(distinct x) into v_ids
  from unnest(coalesce(p_merged_ids, '{}'::uuid[])) as x
  where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > 50 then
    raise exception 'Pick 1 to 50 competitors to merge.' using errcode = '22023';
  end if;
  if p_kept_id = any (v_ids) then
    raise exception 'A competitor can''t be merged into itself.' using errcode = '22023';
  end if;

  select c.* into v_kept
  from public.competitors c
  where c.id = p_kept_id and c.brand_id = p_brand_id
  for update;
  if not found then
    if exists (select 1 from public.merged_competitors m where m.id = p_kept_id and m.brand_id = p_brand_id) then
      raise exception 'The competitor to keep is itself merged into another one.' using errcode = '22023';
    end if;
    raise exception 'The competitor to keep isn''t one of this brand''s.' using errcode = 'P0002';
  end if;

  foreach v_id in array v_ids loop
    -- Already merged: left as it is.
    select m.merged_into_id into v_into
    from public.merged_competitors m
    where m.id = v_id and m.brand_id = p_brand_id;
    if found then
      v_already := v_already || jsonb_build_array(jsonb_build_object(
        'id', v_id,
        'name', (select m.name from public.merged_competitors m where m.id = v_id),
        'merged_into_id', v_into));
      continue;
    end if;

    select c.* into v_row
    from public.competitors c
    where c.id = v_id and c.brand_id = p_brand_id
    for update;
    if not found then
      raise exception 'One of the competitors to merge isn''t one of this brand''s.' using errcode = 'P0002';
    end if;

    -- What the competitors foreign keys drop with the row, kept to put back.
    select coalesce(jsonb_agg(to_jsonb(e) - 'competitor_id' order by e.at), '[]'::jsonb)
      into v_events
    from public.competitor_page_events e
    where e.competitor_id = v_id;
    select s.scanned_at into v_scanned
    from public.competitor_timeline_scans s
    where s.competitor_id = v_id;

    -- The ones merged into it follow it to the kept one, before its row goes.
    update public.merged_competitors
    set merged_into_id = p_kept_id
    where merged_into_id = v_id;

    -- Out of competitors, as a delete: every read leaves it out from now on,
    -- and its Action Center links are marked removed (00244).
    delete from public.competitors where id = v_id;

    insert into public.merged_competitors (
      id, brand_id, merged_into_id, name, domain, type, created_at,
      merged_at, merged_by, page_events, scanned_at)
    values (
      v_row.id, v_row.brand_id, p_kept_id, v_row.name, coalesce(v_row.domain, ''), v_row.type,
      v_row.created_at, now(), v_person, v_events, v_scanned);

    v_merged := v_merged || jsonb_build_array(jsonb_build_object('id', v_row.id, 'name', v_row.name));
  end loop;

  return jsonb_build_object(
    'kept', jsonb_build_object('id', v_kept.id, 'name', v_kept.name),
    'merged', v_merged,
    'already', v_already);
end;
$$;

revoke all on function public.merge_competitors(uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function public.merge_competitors(uuid, uuid, uuid[], uuid) to authenticated, service_role;

comment on function public.merge_competitors(uuid, uuid, uuid[], uuid) is
  'Merging duplicate competitors (00543): moves p_merged_ids out of competitors into merged_competitors, merged into p_kept_id, all of p_brand_id; their names and domains become the kept one''s other names for new answers, their history stays under their own ids. For an admin or manager who can access the brand (can_access_brand); p_user_id is the person the service role merges for, a signed-in caller is always auth.uid(). One already merged is listed under already and left as it is. Returns { kept, merged, already }.';

-- ── unmerge_competitor ──────────────────────────────────────────────────────
-- Puts a merged competitor back as the brand's own: the same row, its cited
-- pages' events and its Action Center links. Its names stop counting for the
-- one it was merged into. Same caller rule as merge_competitors. One that
-- isn't merged changes nothing ({ unmerged: false }).

create or replace function public.unmerge_competitor(
  p_brand_id      uuid,
  p_competitor_id uuid,
  p_user_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_person uuid := case when auth.role() = 'service_role' then p_user_id else auth.uid() end;
  v_m      public.merged_competitors;
  v_kept   text;
begin
  if p_brand_id is null or p_competitor_id is null then
    raise exception 'A brand and a competitor are required.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_person
      and p.organization_id = (select b.organization_id from public.brands b where b.id = p_brand_id)
      and p.role = any (array['admin', 'manager']::public.user_role[])
      and public.can_access_brand(p_brand_id, p.id)
  ) then
    raise exception 'Only an admin or a manager can unmerge this brand''s competitors.'
      using errcode = '42501';
  end if;

  select m.* into v_m
  from public.merged_competitors m
  where m.id = p_competitor_id and m.brand_id = p_brand_id
  for update;
  if not found then
    if exists (select 1 from public.competitors c where c.id = p_competitor_id and c.brand_id = p_brand_id) then
      return jsonb_build_object('unmerged', false, 'id', p_competitor_id);
    end if;
    raise exception 'That competitor isn''t one of this brand''s.' using errcode = 'P0002';
  end if;

  select c.name into v_kept from public.competitors c where c.id = v_m.merged_into_id;

  delete from public.merged_competitors where id = v_m.id;

  insert into public.competitors (id, brand_id, name, domain, type, created_at)
  values (v_m.id, v_m.brand_id, v_m.name, v_m.domain, v_m.type, v_m.created_at);

  insert into public.competitor_page_events (
    id, brand_id, competitor_id, page_key, url, domain, kind, at, detail, created_at)
  select e.id, v_m.brand_id, v_m.id, e.page_key, e.url, e.domain, e.kind, e.at,
         coalesce(e.detail, '{}'::jsonb), coalesce(e.created_at, now())
  from jsonb_populate_recordset(null::public.competitor_page_events, v_m.page_events) e
  where e.id is not null
  on conflict do nothing;

  if v_m.scanned_at is not null then
    insert into public.competitor_timeline_scans (competitor_id, brand_id, scanned_at)
    values (v_m.id, v_m.brand_id, v_m.scanned_at)
    on conflict (competitor_id) do nothing;
  end if;

  -- The Action Center links the merge marked removed (its delete, at the
  -- merge's time), back.
  update public.action_entities e
  set removed_at = null, removed_reason = null
  from public.actions a
  where a.id = e.action_id
    and a.brand_id = v_m.brand_id
    and e.entity_type = 'competitors'
    and (e.entity_key = v_m.id::text or e.entity_key = v_m.name)
    and e.removed_reason = 'deleted'
    and e.removed_at = v_m.merged_at;

  -- Perception's precomputed views counted without it: set aside, as a
  -- competitor deleted or renamed sets them aside (00241).
  update public.mentions_perception_snapshots
  set day_to = date '1970-01-01', computed_at = clock_timestamp()
  where brand_id = v_m.brand_id;

  return jsonb_build_object(
    'unmerged', true,
    'id', v_m.id,
    'name', v_m.name,
    'merged_into', jsonb_build_object('id', v_m.merged_into_id, 'name', v_kept));
end;
$$;

revoke all on function public.unmerge_competitor(uuid, uuid, uuid) from public, anon;
grant execute on function public.unmerge_competitor(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.unmerge_competitor(uuid, uuid, uuid) is
  'Unmerging a competitor (00543): puts a merged competitor back into competitors with its own id, its cited pages'' events, timeline read and Action Center links; its names stop counting for the one it was merged into, and what was counted for that one meanwhile stays there. For an admin or manager who can access the brand (can_access_brand); p_user_id is the person the service role unmerges for, a signed-in caller is always auth.uid(). { unmerged: false } when it isn''t merged.';

-- ── refresh_mention_terms (00231), the merged names added ──────────────────
-- 00231's refresh, unchanged but for the names: a competitor's terms are
-- found next to its name and domain, and, in answers from when a competitor
-- was merged into it on, next to the merged one's name and domain too, as
-- tracking counts them. A merged competitor keeps its own terms in the
-- answers from before (they name it by its id), so a refresh of older days
-- changes nothing for it.

create or replace function public.refresh_mention_terms(
  p_brand_id uuid,
  p_day_from date,
  p_day_to   date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  -- The range's bounds as instants, so the answers are found by range.
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  -- One refresh per brand at a time, as refresh_mentions_daily (00192): a
  -- run's refresh and the nightly sweep can cover the same days, and the
  -- second insert would fail on the (result_id, entity) key. The lock
  -- releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms:' || p_brand_id::text, 0));

  delete from public.mentions_answer_terms
    where brand_id = p_brand_id and created_at >= v_from and created_at < v_to;

  -- The terms next to each entity an answer names, matched by the same names
  -- tracking counts: the brand's name and domains, each competitor's name
  -- and domain, and (00543) the names and domains merged into it.
  with brand_names as (
    select array_remove(array[b.name] || coalesce(
             (select array_agg(bd.domain) from public.brand_domains bd where bd.brand_id = b.id),
             '{}'), null) as names
    from public.brands b
    where b.id = p_brand_id
  ),
  competitor_names as (
    select c.id::text as entity, array_remove(array[c.name, nullif(c.domain, '')], null) as names
    from public.competitors c
    where c.brand_id = p_brand_id
    -- 00543: a merged competitor, by its own names, for the answers that
    -- named it before the merge.
    union all
    select m.id::text, array_remove(array[m.name, nullif(m.domain, '')], null)
    from public.merged_competitors m
    where m.brand_id = p_brand_id
  ),
  -- 00543: the kept competitor's other names, each from its merge on.
  -- Materialized: read once, not once per answer.
  merged_names as materialized (
    select m.merged_into_id::text as entity, n.name, m.merged_at as since
    from public.merged_competitors m
    cross join lateral unnest(array_remove(array[m.name, nullif(m.domain, '')], null)) as n(name)
    where m.brand_id = p_brand_id
  ),
  name_words as (
    select coalesce(array_agg(distinct w), '{}') as words
    from (
      select regexp_split_to_table(lower(n), '[^[:alnum:]-]+') as w
      from (
        select unnest(names) as n from brand_names
        union all
        select unnest(names) from competitor_names
      ) all_names
    ) split
    where w <> ''
  )
  insert into public.mentions_answer_terms (
    brand_id, result_id, created_at, prompt_id, platform, region, entity, terms)
  select
    p_brand_id, pr.id, pr.created_at, pr.prompt_id, pr.platform, pr.region, e.entity,
    public.mention_terms(
      pr.response,
      e.names,
      (select words from name_words) || regexp_split_to_array(lower(p.text), '[^[:alnum:]-]+'))
  from public.prompt_results pr
  join public.prompts p on p.id = pr.prompt_id
  cross join lateral (
    select 'brand'::text as entity, (select names from brand_names) as names
    where pr.mention_count > 0
    union all
    select cn.entity,
           cn.names || coalesce(array(
             select mn.name from merged_names mn
             where mn.entity = cn.entity and pr.created_at >= mn.since), '{}')
    from competitor_names cn
    where exists (
      select 1
      from jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
      where cm.value->>'competitor_id' = cn.entity
        and coalesce((cm.value->>'mention_count')::int, 0) > 0)
  ) e
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to;

  -- The Perception tab's daily rollups of the same days (00231), in the
  -- same transaction, so they never lag the terms.
  perform public.refresh_mention_terms_daily(p_brand_id, p_day_from, p_day_to);
end;
$$;

revoke execute on function public.refresh_mention_terms(uuid, date, date)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
