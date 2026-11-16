-- ============================================================================
-- 00534: each brand numbers its own actions and signals (AC-01, S-01)
-- ============================================================================
-- An action's code was its global number (actions.action_no, 00081), one
-- counter across every workspace: a brand with 53 actions showed "AC-648"
-- beside "AC-251", which hints at other customers' volume. The owner asked
-- for each brand's own numbers from 1, and the same for signals (which had
-- none):
--
--   * actions.brand_no and signals.brand_no: the row's number in its brand,
--     given once, when the row is inserted, and kept for its life. A number
--     is never given again, so a brand's list has gaps where actions or
--     signals were done, dismissed or removed. action_no stays as it was:
--     old links and references use it, and the app falls back to it while
--     brand_no is null.
--   * brand_number_counters: each brand's last number per kind, server only.
--   * set_brand_no (a before insert trigger) gives the next number from the
--     counter, which a row lock keeps one at a time per brand: two inserts
--     never get the same number, and a failed insert gives its number back
--     (the counter's update rolls back with it).
--
-- This file numbers nothing that is already there, so it applies in seconds.
-- A brand's existing rows are numbered by backfill_brand_numbers, one brand
-- and kind per call, from server/src/scripts/backfill-brand-numbers.js:
--   * a brand is numbered once it has a counter row. Until then its new rows
--     get no number either (the app shows their old code, as for the rest of
--     the brand's rows), and the backfill numbers them with the others, in
--     creation order. A brand with no rows of the kind yet (a new brand)
--     starts at 1 with its first row.
--   * the backfill and the trigger take the brand's lock (the backfill alone,
--     the trigger shared), so a row inserted while its brand is numbered is
--     either numbered by the backfill or gets the next number after it.
-- The unique index on (brand_id, brand_no) is built after the backfill (the
-- runbook, in the PR that brought this file). Only on a new install, where
-- the tables are still empty, is it built here.
--
-- An upsert of a row that is already there (the demo brand's rebuild writes
-- its rows over by id) keeps the row's number and uses none up.

alter table public.actions add column if not exists brand_no integer;
alter table public.signals add column if not exists brand_no integer;

comment on column public.actions.brand_no is
  'The action''s number in its brand (AC-01, 00534), given on insert by set_brand_no and kept for its life; null until backfill_brand_numbers numbers its brand. action_no stays the global number old links use.';
comment on column public.signals.brand_no is
  'The signal''s number in its brand (S-01, 00534), given on insert by set_brand_no and kept for its life; null until backfill_brand_numbers numbers its brand.';

create table if not exists public.brand_number_counters (
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind     text not null check (kind in ('action', 'signal')),
  last_no  integer not null default 0 check (last_no >= 0),
  primary key (brand_id, kind)
);

-- Written by set_brand_no and the backfill only; no member reads it.
alter table public.brand_number_counters enable row level security;
revoke all on table public.brand_number_counters from anon, authenticated;
grant all on table public.brand_number_counters to service_role;

comment on table public.brand_number_counters is
  'Each brand''s last action and signal number (00534). A brand''s kind is numbered once it has a row here: set_brand_no gives its next number, backfill_brand_numbers numbers its rows from before 00534 and adds the row.';

-- The lock a brand's numbering of one kind takes (the backfill alone, inserts shared).
create or replace function public.brand_no_lock_key(p_kind text, p_brand_id uuid)
returns bigint
language sql
immutable
as $$
  select hashtextextended('brand_no:' || p_kind || ':' || p_brand_id::text, 0);
$$;

create or replace function public.set_brand_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text := tg_argv[0];
  v_no    integer;
  v_there boolean;
  v_rows  boolean;
begin
  new.brand_no := null;
  if new.brand_id is null then
    return new;
  end if;

  -- An upsert over a row that is there keeps that row's number.
  if tg_table_name = 'actions' then
    v_there := exists (select 1 from public.actions a where a.id = new.id);
  else
    v_there := exists (select 1 from public.signals s where s.id = new.id);
  end if;
  if v_there then
    return new;
  end if;

  update public.brand_number_counters c
     set last_no = c.last_no + 1
   where c.brand_id = new.brand_id and c.kind = v_kind
  returning c.last_no into v_no;
  if found then
    new.brand_no := v_no;
    return new;
  end if;

  -- Not numbered yet: wait for a backfill of the brand that is running.
  perform pg_advisory_xact_lock_shared(public.brand_no_lock_key(v_kind, new.brand_id));

  if tg_table_name = 'actions' then
    v_rows := exists (select 1 from public.actions a where a.brand_id = new.brand_id);
  else
    v_rows := exists (select 1 from public.signals s where s.brand_id = new.brand_id);
  end if;

  if not v_rows then
    -- The brand's first row of the kind: it starts at 1.
    insert into public.brand_number_counters as c (brand_id, kind, last_no)
    values (new.brand_id, v_kind, 1)
    on conflict (brand_id, kind) do update set last_no = c.last_no + 1
    returning c.last_no into v_no;
  else
    -- Numbered by a backfill that finished while this waited; else still null.
    update public.brand_number_counters c
       set last_no = c.last_no + 1
     where c.brand_id = new.brand_id and c.kind = v_kind
    returning c.last_no into v_no;
  end if;
  new.brand_no := v_no;
  return new;
end;
$$;

drop trigger if exists actions_set_brand_no on public.actions;
create trigger actions_set_brand_no
  before insert on public.actions
  for each row execute function public.set_brand_no('action');

drop trigger if exists signals_set_brand_no on public.signals;
create trigger signals_set_brand_no
  before insert on public.signals
  for each row execute function public.set_brand_no('signal');

-- Numbers one brand's rows of one kind that have none: after its highest
-- number (or its counter, if higher), in creation order (actions by
-- created_at then action_no, signals by created_at then id: a signal's
-- detected_at moves when it comes back), and lists the brand in the
-- counters. Rows already numbered keep their numbers, so a second call
-- changes nothing. One brand's rows per call, read by its brand_id index.
create or replace function public.backfill_brand_numbers(p_kind text, p_brand_id uuid)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_base     integer;
  v_numbered integer;
  v_last     integer;
begin
  if p_kind is null or p_kind not in ('action', 'signal') or p_brand_id is null then
    raise exception 'backfill_brand_numbers: a kind (action or signal) and a brand are required';
  end if;

  perform pg_advisory_xact_lock(public.brand_no_lock_key(p_kind, p_brand_id));

  select coalesce(max(c.last_no), 0) into v_base
  from public.brand_number_counters c
  where c.brand_id = p_brand_id and c.kind = p_kind;

  if p_kind = 'action' then
    select greatest(v_base, coalesce(max(a.brand_no), 0)) into v_base
    from public.actions a where a.brand_id = p_brand_id;
    with numbered as (
      select a.id, row_number() over (order by a.created_at, a.action_no) as n
      from public.actions a
      where a.brand_id = p_brand_id and a.brand_no is null
    )
    update public.actions a set brand_no = v_base + numbered.n
    from numbered where a.id = numbered.id;
    get diagnostics v_numbered = row_count;
  else
    select greatest(v_base, coalesce(max(s.brand_no), 0)) into v_base
    from public.signals s where s.brand_id = p_brand_id;
    with numbered as (
      select s.id, row_number() over (order by s.created_at, s.id) as n
      from public.signals s
      where s.brand_id = p_brand_id and s.brand_no is null
    )
    update public.signals s set brand_no = v_base + numbered.n
    from numbered where s.id = numbered.id;
    get diagnostics v_numbered = row_count;
  end if;

  v_last := v_base + v_numbered;
  insert into public.brand_number_counters as c (brand_id, kind, last_no)
  values (p_brand_id, p_kind, v_last)
  on conflict (brand_id, kind) do update set last_no = greatest(c.last_no, excluded.last_no);

  return jsonb_build_object('numbered', v_numbered, 'last_no', v_last);
end;
$$;

-- What the backfill script walks: each brand with rows of the kind, by id,
-- and whether it is numbered yet. One jsonb value, not rows: an API call's
-- rows are capped (PostgREST max-rows).
create or replace function public.brand_numbers_backfill_brands(p_kind text)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id', b.id,
           'ready', exists (select 1 from public.brand_number_counters c
                            where c.brand_id = b.id and c.kind = p_kind))
         order by b.id), '[]'::jsonb)
  from public.brands b
  where case p_kind
          when 'action' then exists (select 1 from public.actions a where a.brand_id = b.id)
          when 'signal' then exists (select 1 from public.signals s where s.brand_id = b.id)
          else false
        end;
$$;

revoke execute on function public.set_brand_no() from public, anon, authenticated;
revoke execute on function public.backfill_brand_numbers(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.brand_numbers_backfill_brands(text)
  from public, anon, authenticated;

-- One number per brand. On a database with rows, built after the backfill,
-- without blocking writes (the runbook):
--   create unique index concurrently if not exists actions_brand_no_key
--     on public.actions (brand_id, brand_no) where brand_no is not null;
--   create unique index concurrently if not exists signals_brand_no_key
--     on public.signals (brand_id, brand_no) where brand_no is not null;
-- A concurrent build that fails leaves an invalid index of that name, which
-- "if not exists" would keep: drop it and build it again.
do $$
begin
  if not exists (select 1 from public.actions) then
    create unique index if not exists actions_brand_no_key
      on public.actions (brand_id, brand_no) where brand_no is not null;
  end if;
  if not exists (select 1 from public.signals) then
    create unique index if not exists signals_brand_no_key
      on public.signals (brand_id, brand_no) where brand_no is not null;
  end if;
end;
$$;
