-- ============================================================================
-- 00544: insights_filter_options from a small counts table, not a scan
-- ============================================================================
-- insights_filter_options(brand) (00026) lists the regions and models the
-- location and model filters offer: Prompts (getBrandFilterOptions),
-- Insights, Mentions and Citations (/api/visibility/read filterOptions) and
-- Chat (brandModels). It reads every answer the brand ever had, twice
-- (distinct region, distinct model_used), on each of those page loads.
-- prompt_results is the largest table, so the read grows with the brand's
-- history: on a copy with 1M answers for one brand it took 0.8-1.0 s warm.
--
-- No rollup already there gives the same lists at every moment:
--   * insights_brand_daily holds every (day, model_used, platform, region)
--     of a brand's non-shopping answers, nulls included, but a day enters
--     it when its run is stamped or at the nightly sweep, and a deleted
--     prompt's answers leave it when the rebuild queue drains: a new
--     location or model would show late, a deleted one would stay.
--   * mentions_prompt_daily leaves out answers without a prompt and keeps no
--     model; the Topics and citation rollups keep neither.
--   * prompts.regions and brand_platforms are what is tracked now, not what
--     the answers hold: model_used is the version an engine reported, and a
--     location no longer tracked keeps its answers.
--
-- brand_filter_values keeps, per brand, kind ('region' or 'model'), value
-- and month (of created_at, UTC), how many of the brand's non-shopping
-- answers have that value; null and empty values aren't counted, as the read
-- leaves them out. Triggers on prompt_results keep it in the same
-- transaction as every insert, update and delete (the tracking worker, the
-- Cloro handler, the demo writer, a prompt or brand delete cascading), for
-- every brand, from the moment this applies: row-level for an insert (one
-- answer per statement; about 0.08 ms on it), row-level for an update that
-- moves an answer (none other calls it), statement-level for deletes. A
-- value is offered while its count is above zero, so one whose last answer
-- goes drops out, as it does from the scan. Each takes a per-brand lock
-- before it writes counts, so two writers can't deadlock on them.
--
-- The triggers count changes from now on, so an existing brand's counts are
-- off, month by month, by the answers it had when this applied. This fills
-- nothing: backfill_brand_filter_values(brand, months) corrects a brand's
-- months a few at a time, oldest first, and lists the brand ready with the
-- last one. Each call reads the months' answers and their stored counts in
-- one statement (one snapshot) and adds the difference; an answer written
-- meanwhile was counted by the trigger and isn't in that snapshot, so it is
-- neither lost nor counted twice. The call then checks the months against
-- the answers again and fails (changing nothing) if they differ.
-- server/src/scripts/backfill-filter-values.js calls it brand by brand. A
-- brand added from now on is ready from its first answer.
--
-- insights_filter_options reads the counts for a ready brand only. Every
-- other brand runs the 00026 scan exactly as before, so no list comes back
-- short. To send a brand back, clear its ready_at. Signature, results,
-- security invoker, search_path and grants are unchanged; the new tables are
-- read through the same policy as prompt_results, so a caller sees the same
-- brands' values as before.
--
-- Schema and functions only: two small new tables, their key indexes, the
-- triggers and the functions. It applies in well under a second (45 ms on
-- a copy with 1.2M answers), and every statement is safe to run again.

-- The triggers need a moment's lock on prompt_results and brands: if a long
-- transaction holds either, give up after 5 s instead of queueing their
-- writes behind it (apply it again; everything here is idempotent).
set lock_timeout = '5s';

-- ── The counts ──────────────────────────────────────────────────────────────

create table if not exists public.brand_filter_values (
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind     text not null constraint brand_filter_values_kind_check
             check (kind in ('region', 'model')),
  value    text not null,
  -- The first day of the answers' month (created_at in UTC).
  month    date not null,
  -- The brand's non-shopping answers with this value that month. Until the
  -- brand's backfill reaches the month, only the changes since 00544, so it
  -- can be below zero then.
  n        bigint not null,
  constraint brand_filter_values_pkey primary key (brand_id, kind, value, month)
) with (fillfactor = 70);

-- One row per brand: how far the backfill has corrected its months, and when
-- it finished. insights_filter_options reads the counts once ready_at is set.
create table if not exists public.brand_filter_values_backfill (
  brand_id   uuid primary key references public.brands(id) on delete cascade,
  -- The first month the backfill hasn't corrected yet; null before it starts.
  next_month date,
  ready_at   timestamptz,
  updated_at timestamptz not null default now()
);

-- Counts change with every answer: the table keeps room for the new row
-- versions on their page (fillfactor 70) and is vacuumed early, as it is
-- small.
alter table public.brand_filter_values set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.05
);

comment on table public.brand_filter_values is
  'Per brand, kind (region, model), value and month: how many of the brand''s non-shopping answers (prompt_results) have it (00544). Kept by triggers on prompt_results, and corrected for the answers before 00544 by backfill_brand_filter_values. insights_filter_options offers the values with a count above zero for a brand ready in brand_filter_values_backfill.';
comment on table public.brand_filter_values_backfill is
  'The brand_filter_values backfill per brand (00544): the next month to correct and when the brand was ready. insights_filter_options reads brand_filter_values for a brand with ready_at set and scans prompt_results for every other. A brand added after 00544 is ready from the start. Clear ready_at to send a brand back.';

-- ── Who reads them ──────────────────────────────────────────────────────────
-- insights_filter_options is security invoker: a caller reads these as it
-- reads prompt_results, through the same policy (anon, with no uid, sees no
-- row there or here). Only the triggers and the backfill write them.

alter table public.brand_filter_values enable row level security;
alter table public.brand_filter_values_backfill enable row level security;

drop policy if exists "Users can read own org filter values" on public.brand_filter_values;
create policy "Users can read own org filter values" on public.brand_filter_values
  for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

drop policy if exists "Users can read own org filter values backfill" on public.brand_filter_values_backfill;
create policy "Users can read own org filter values backfill" on public.brand_filter_values_backfill
  for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

revoke all on table public.brand_filter_values from anon, authenticated;
revoke all on table public.brand_filter_values_backfill from anon, authenticated;
grant select on table public.brand_filter_values to anon, authenticated;
grant select on table public.brand_filter_values_backfill to anon, authenticated;
grant all on table public.brand_filter_values to service_role;
grant all on table public.brand_filter_values_backfill to service_role;

-- ── Kept by every write to prompt_results ──────────────────────────────────

-- Every write of a brand's counts first takes the brand's lock (held to
-- commit), so two writers never hold some of the same counts while waiting
-- for others: an upsert fires the insert and the update trigger, a prompt
-- delete fires the delete trigger once per prompt, the backfill writes many.

-- One answer in: +1 to its region's and its model's count for the month.
-- Row-level: the tracking worker and the Cloro handler insert one answer per
-- statement, and this costs that insert least (no transition table). Shopping
-- answers and answers with neither value don't call it (the trigger's when).
create or replace function public.brand_filter_values_add_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('brand_filter_values:' || new.brand_id::text, 0));

  insert into public.brand_filter_values as t (brand_id, kind, value, month, n)
  select new.brand_id, v.kind, v.value,
         date_trunc('month', new.created_at at time zone 'utc')::date, 1
  from (values ('model', new.model_used), ('region', new.region)) as v(kind, value)
  where v.value is not null and v.value <> ''
  order by v.kind, v.value
  on conflict (brand_id, kind, value, month) do update
    set n = t.n + 1;
  return null;
end;
$$;

-- One answer changed where it counts (its brand, platform, region, model or
-- month): -1 where it was, +1 where it is, the brands locked in order. In
-- the app only the demo's rebuild moves answers; a sentiment or count update
-- doesn't call it (the trigger's column list and when).
create or replace function public.brand_filter_values_move_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand uuid;
begin
  for v_brand in
    select distinct b.id from (values (old.brand_id), (new.brand_id)) as b(id) order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('brand_filter_values:' || v_brand::text, 0));
  end loop;

  insert into public.brand_filter_values as t (brand_id, kind, value, month, n)
  select c.brand_id, c.kind, c.value, c.month, sum(c.n)
  from (
    select new.brand_id as brand_id, v.kind, v.value,
           date_trunc('month', new.created_at at time zone 'utc')::date as month, 1 as n
    from (values ('model', new.model_used), ('region', new.region)) as v(kind, value)
    where new.platform <> 'chatgpt-shopping' and v.value is not null and v.value <> ''
    union all
    select old.brand_id, v.kind, v.value,
           date_trunc('month', old.created_at at time zone 'utc')::date, -1
    from (values ('model', old.model_used), ('region', old.region)) as v(kind, value)
    where old.platform <> 'chatgpt-shopping' and v.value is not null and v.value <> ''
  ) c
  group by 1, 2, 3, 4
  having sum(c.n) <> 0
  order by 1, 2, 3, 4
  on conflict (brand_id, kind, value, month) do update
    set n = t.n + excluded.n;
  return null;
end;
$$;

-- Answers out: -1 per answer, summed per count. Statement-level: a prompt
-- delete cascades its answers in one statement, a brand delete 2,000 at a
-- time (delete_brand_results_batch). A brand being deleted is skipped: its
-- counts go with it.
create or replace function public.brand_filter_values_remove_answers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand uuid;
begin
  for v_brand in
    select distinct r.brand_id from old_rows r
    where r.platform <> 'chatgpt-shopping'
      and exists (select 1 from public.brands b where b.id = r.brand_id)
    order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('brand_filter_values:' || v_brand::text, 0));
  end loop;

  insert into public.brand_filter_values as t (brand_id, kind, value, month, n)
  select r.brand_id, v.kind, v.value,
         date_trunc('month', r.created_at at time zone 'utc')::date, -count(*)
  from old_rows r
  cross join lateral (values ('model', r.model_used), ('region', r.region)) as v(kind, value)
  where r.platform <> 'chatgpt-shopping'
    and v.value is not null and v.value <> ''
    and exists (select 1 from public.brands b where b.id = r.brand_id)
  group by 1, 2, 3, 4
  order by 1, 2, 3, 4
  on conflict (brand_id, kind, value, month) do update
    set n = t.n + excluded.n;
  return null;
end;
$$;

-- A truncate leaves no answer, so no count.
create or replace function public.brand_filter_values_truncated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.brand_filter_values;
  return null;
end;
$$;

drop trigger if exists prompt_results_filter_values_insert on public.prompt_results;
create trigger prompt_results_filter_values_insert
  after insert on public.prompt_results
  for each row
  when (new.platform <> 'chatgpt-shopping' and (new.region <> '' or new.model_used <> ''))
  execute function public.brand_filter_values_add_answer();

drop trigger if exists prompt_results_filter_values_update on public.prompt_results;
create trigger prompt_results_filter_values_update
  after update of brand_id, platform, region, model_used, created_at on public.prompt_results
  for each row
  when ((old.brand_id, old.platform, old.region, old.model_used, old.created_at)
        is distinct from (new.brand_id, new.platform, new.region, new.model_used, new.created_at))
  execute function public.brand_filter_values_move_answer();

drop trigger if exists prompt_results_filter_values_delete on public.prompt_results;
create trigger prompt_results_filter_values_delete
  after delete on public.prompt_results
  referencing old table as old_rows
  for each statement execute function public.brand_filter_values_remove_answers();

drop trigger if exists prompt_results_filter_values_truncate on public.prompt_results;
create trigger prompt_results_filter_values_truncate
  after truncate on public.prompt_results
  for each statement execute function public.brand_filter_values_truncated();

-- A brand added from now on has had every answer counted: ready at once.
create or replace function public.brand_filter_values_new_brand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.brand_filter_values_backfill (brand_id, ready_at)
  values (new.id, now())
  on conflict (brand_id) do nothing;
  return null;
end;
$$;

drop trigger if exists brands_filter_values_ready on public.brands;
create trigger brands_filter_values_ready
  after insert on public.brands
  for each row execute function public.brand_filter_values_new_brand();

-- ── The backfill ────────────────────────────────────────────────────────────

-- Corrects the brand's next p_months months, oldest first, from its first
-- answer's (or count's) month through this month (or a later one its answers
-- reach), and sets ready_at with the last. Returns { month_from, month_to,
-- corrected (count rows written), ready }; a ready brand returns at once.
-- One call reads those months of the brand's answers twice (the correction
-- and the check), through prompt_results' (brand_id, created_at) indexes.
-- Another call for the same brand waits for this one. Writers of the brand's
-- answers wait from the correction to the end of the call, so they and it
-- never lock counts in opposite orders.
create or replace function public.backfill_brand_filter_values(
  p_brand_id uuid,
  p_months   integer default 1
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_progress  public.brand_filter_values_backfill%rowtype;
  v_last      date;
  v_from      date;
  v_to        date;
  v_kinds     text[];
  v_values    text[];
  v_months    date[];
  v_diffs     bigint[];
  v_corrected bigint := 0;
  v_ready     boolean;
begin
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception 'p_months must be between 1 and 24' using errcode = '22023';
  end if;

  -- Two calls at once would each add the same correction.
  perform pg_advisory_xact_lock(
    hashtextextended('backfill_brand_filter_values:' || p_brand_id::text, 0));

  if not exists (select 1 from public.brands b where b.id = p_brand_id) then
    raise exception 'brand % not found', p_brand_id using errcode = 'P0002';
  end if;

  select * into v_progress
  from public.brand_filter_values_backfill
  where brand_id = p_brand_id;
  if v_progress.ready_at is not null then
    return jsonb_build_object('month_from', null, 'month_to', null, 'corrected', 0, 'ready', true);
  end if;

  -- greatest and least skip nulls: a brand with no answer has just this month.
  v_last := greatest(
    date_trunc('month', now() at time zone 'utc')::date,
    (select date_trunc('month', max(pr.created_at) at time zone 'utc')::date
       from public.prompt_results pr where pr.brand_id = p_brand_id),
    (select max(f.month) from public.brand_filter_values f where f.brand_id = p_brand_id));
  v_from := coalesce(v_progress.next_month, least(
    (select date_trunc('month', min(pr.created_at) at time zone 'utc')::date
       from public.prompt_results pr where pr.brand_id = p_brand_id),
    (select min(f.month) from public.brand_filter_values f where f.brand_id = p_brand_id),
    v_last));
  v_to := least((v_from + make_interval(months => p_months - 1))::date, v_last);

  -- What each count is off by: the months' answers and their stored counts,
  -- read in this one statement, so in one snapshot.
  select array_agg(d.kind order by d.kind, d.value, d.month),
         array_agg(d.value order by d.kind, d.value, d.month),
         array_agg(d.month order by d.kind, d.value, d.month),
         array_agg(d.diff order by d.kind, d.value, d.month)
    into v_kinds, v_values, v_months, v_diffs
  from (
    select coalesce(a.kind, s.kind) as kind,
           coalesce(a.value, s.value) as value,
           coalesce(a.month, s.month) as month,
           coalesce(a.n, 0) - coalesce(s.n, 0) as diff
    from (
      select v.kind, v.value,
             date_trunc('month', pr.created_at at time zone 'utc')::date as month,
             count(*) as n
      from public.prompt_results pr
      cross join lateral (values ('region', pr.region), ('model', pr.model_used)) as v(kind, value)
      where pr.brand_id = p_brand_id
        and pr.created_at >= v_from::timestamp at time zone 'utc'
        and pr.created_at < (v_to + interval '1 month') at time zone 'utc'
        and pr.platform <> 'chatgpt-shopping'
        and v.value is not null and v.value <> ''
      group by 1, 2, 3
    ) a
    full join (
      select f.kind, f.value, f.month, f.n
      from public.brand_filter_values f
      where f.brand_id = p_brand_id and f.month between v_from and v_to
    ) s on s.kind = a.kind and s.value = a.value and s.month = a.month
  ) d
  where d.diff <> 0;

  if v_kinds is not null then
    -- The triggers' lock, then the difference added to the count as it now
    -- is: a change committed since the read above is in it, and not in the
    -- difference.
    perform pg_advisory_xact_lock(
      hashtextextended('brand_filter_values:' || p_brand_id::text, 0));

    insert into public.brand_filter_values as t (brand_id, kind, value, month, n)
    select p_brand_id, c.kind, c.value, c.month, c.diff
    from unnest(v_kinds, v_values, v_months, v_diffs) as c(kind, value, month, diff)
    order by c.kind, c.value, c.month
    on conflict (brand_id, kind, value, month) do update
      set n = t.n + excluded.n;
    get diagnostics v_corrected = row_count;
  end if;

  -- Check, in a new snapshot: every count of those months equals the answers.
  if exists (
    select 1
    from (
      select v.kind, v.value,
             date_trunc('month', pr.created_at at time zone 'utc')::date as month,
             count(*) as n
      from public.prompt_results pr
      cross join lateral (values ('region', pr.region), ('model', pr.model_used)) as v(kind, value)
      where pr.brand_id = p_brand_id
        and pr.created_at >= v_from::timestamp at time zone 'utc'
        and pr.created_at < (v_to + interval '1 month') at time zone 'utc'
        and pr.platform <> 'chatgpt-shopping'
        and v.value is not null and v.value <> ''
      group by 1, 2, 3
    ) a
    full join (
      select f.kind, f.value, f.month, f.n
      from public.brand_filter_values f
      where f.brand_id = p_brand_id and f.month between v_from and v_to
    ) s on s.kind = a.kind and s.value = a.value and s.month = a.month
    where coalesce(a.n, 0) <> coalesce(s.n, 0)
  ) then
    raise exception 'brand_filter_values: brand % months % to % don''t match its answers after the correction',
      p_brand_id, v_from, v_to;
  end if;

  v_ready := v_to >= v_last;
  insert into public.brand_filter_values_backfill as p (brand_id, next_month, ready_at, updated_at)
  values (p_brand_id, (v_to + interval '1 month')::date,
          case when v_ready then now() end, now())
  on conflict (brand_id) do update set
    next_month = excluded.next_month,
    ready_at   = excluded.ready_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'month_from', v_from, 'month_to', v_to, 'corrected', v_corrected, 'ready', v_ready);
end;
$$;

-- Every brand, by id, with where its backfill stands: the script's list.
create or replace function public.brand_filter_values_backfill_brands()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id',   b.id,
           'next_month', p.next_month,
           'ready',      p.ready_at is not null)
         order by b.id), '[]'::jsonb)
  from public.brands b
  left join public.brand_filter_values_backfill p on p.brand_id = b.id;
$$;

-- ── The read: the counts for a ready brand, the 00026 scan otherwise ──────

create or replace function public.insights_filter_options(p_brand_id uuid)
returns table (
  regions text[],
  models  text[]
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if exists (
    select 1 from public.brand_filter_values_backfill r
    where r.brand_id = p_brand_id and r.ready_at is not null
  ) then
    return query
    select
      coalesce((
        select array_agg(f.value order by f.value)
        from (
          select v.value
          from public.brand_filter_values v
          where v.brand_id = p_brand_id and v.kind = 'region'
          group by v.value
          having sum(v.n) > 0
        ) f
      ), '{}'),
      coalesce((
        select array_agg(f.value order by f.value)
        from (
          select v.value
          from public.brand_filter_values v
          where v.brand_id = p_brand_id and v.kind = 'model'
          group by v.value
          having sum(v.n) > 0
        ) f
      ), '{}');
    return;
  end if;

  -- 00026, unchanged.
  return query
  SELECT
    COALESCE((
      SELECT array_agg(DISTINCT pr.region ORDER BY pr.region)
      FROM public.prompt_results pr
      WHERE pr.brand_id = p_brand_id
        AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from analytics
        AND pr.region IS NOT NULL AND pr.region <> ''
    ), '{}') AS regions,
    COALESCE((
      SELECT array_agg(DISTINCT pr.model_used ORDER BY pr.model_used)
      FROM public.prompt_results pr
      WHERE pr.brand_id = p_brand_id
        AND pr.platform <> 'chatgpt-shopping'
        AND pr.model_used IS NOT NULL AND pr.model_used <> ''
    ), '{}') AS models;
end;
$$;

GRANT EXECUTE ON FUNCTION public.insights_filter_options(uuid)
  TO authenticated;

comment on function public.insights_filter_options(uuid) is
  'The region and model filter options (#458): the brand''s distinct non-shopping prompt_results regions and model_used values, sorted, nulls and empties left out. From brand_filter_values for a brand ready in brand_filter_values_backfill (00544), from prompt_results otherwise. Security invoker.';

-- The triggers' and the backfill's: the server's only.
revoke execute on function public.brand_filter_values_add_answer() from public, anon, authenticated;
revoke execute on function public.brand_filter_values_move_answer() from public, anon, authenticated;
revoke execute on function public.brand_filter_values_remove_answers() from public, anon, authenticated;
revoke execute on function public.brand_filter_values_truncated() from public, anon, authenticated;
revoke execute on function public.brand_filter_values_new_brand() from public, anon, authenticated;
revoke execute on function public.backfill_brand_filter_values(uuid, integer)
  from public, anon, authenticated;
revoke execute on function public.brand_filter_values_backfill_brands()
  from public, anon, authenticated;
grant execute on function public.backfill_brand_filter_values(uuid, integer) to service_role;
grant execute on function public.brand_filter_values_backfill_brands() to service_role;

reset lock_timeout;

notify pgrst, 'reload schema';
