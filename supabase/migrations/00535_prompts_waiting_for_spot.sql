-- ============================================================================
-- 00535: a prompt can wait for a spot (Simplify PR 14)
-- ============================================================================
-- When the plan's prompt locations are all used, a prompt someone adds will
-- be kept as "Waiting for a spot" instead of being refused (Simplify PRs 15
-- and 16). This migration only adds the state; nothing saves a prompt
-- waiting yet.
--
--   * prompts.waiting_since: when the prompt started waiting; null when it
--     isn't waiting. A waiting prompt is never active (the check below), so
--     it is already not tracked (the tracking worker reads active prompts
--     only) and not counted against the plan (org_prompt_location_usage
--     counts active prompts only, 00128 and 00390). A paused prompt stays
--     inactive with no waiting_since. prompts.work_status (00031) is a
--     workflow field and isn't reused.
--   * A waiting prompt doesn't start by itself when a spot frees up (the
--     owner's call, 2026-11-11): the person picks it. Whatever makes it
--     active clears waiting_since in the same write, or the check refuses
--     the write.
--   * import_prompts (00122) takes p_over_limit: 'skip' (the default, as
--     before: the rows past the limit aren't saved) or 'wait' (they are
--     saved waiting). It says which saved rows wait.

alter table public.prompts
  add column if not exists waiting_since timestamptz;

alter table public.prompts drop constraint if exists prompts_waiting_not_active_check;
alter table public.prompts add constraint prompts_waiting_not_active_check
  check (waiting_since is null or not is_active);

-- The prompts waiting for a spot, per prompt set: the Tracked Prompts filter
-- and banner, Today's row and the menu dot (PRs 13 and 16).
create index if not exists idx_prompts_waiting
  on public.prompts (prompt_set_id)
  where waiting_since is not null;

comment on column public.prompts.waiting_since is
  'When the prompt started waiting for a spot on the plan (00535); null when it isn''t waiting. A waiting prompt is never active (prompts_waiting_not_active_check), so it isn''t tracked or counted against the plan, and it doesn''t start by itself when a spot frees up.';

-- ── import_prompts: rows past the limit can wait ────────────────────────────
-- As 00122, plus p_over_limit. The rows are taken in the order given; once
-- one doesn't fit, it and every row after it are past the limit: skipped
-- with 'skip' (the default, so the callers before this behave as before),
-- or saved waiting with 'wait' (is_active false, waiting_since now). Waiting
-- rows take no room, so a second import still counts only what is tracked.
-- SECURITY INVOKER: prompts keeps its admin/manager insert policy through the
-- prompt set's brand, so RLS still decides whether the caller may write.

drop function if exists public.import_prompts(uuid, uuid, integer, jsonb);

create or replace function public.import_prompts(
  p_prompt_set_id uuid,
  p_organization_id uuid,
  p_max_locations integer,
  p_rows jsonb,
  p_over_limit text default 'skip'
)
returns table (idx integer, id uuid, waiting boolean)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_used bigint;
  v_row jsonb;
  v_regions text[];
  v_cost integer;
  v_id uuid;
  v_over boolean := false;
begin
  if p_over_limit is null or p_over_limit not in ('skip', 'wait') then
    raise exception 'p_over_limit must be skip or wait' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('import_prompts:' || p_organization_id::text, 0));

  select coalesce(sum(u.locations), 0) into v_used
  from public.org_prompt_location_usage(p_organization_id) u;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_regions := array(select jsonb_array_elements_text(v_row -> 'regions'));
    -- Same unit as org_prompt_location_usage: one per region, minimum one.
    v_cost := greatest(coalesce(array_length(v_regions, 1), 0), 1);
    v_over := v_over or (p_max_locations <> -1 and v_used + v_cost > p_max_locations);
    exit when v_over and p_over_limit = 'skip';

    insert into public.prompts
      (prompt_set_id, text, category, topic_id, platforms, models, regions, is_active, waiting_since)
    values (
      p_prompt_set_id,
      v_row ->> 'text',
      nullif(v_row ->> 'category', ''),
      nullif(v_row ->> 'topic_id', '')::uuid,
      array(select jsonb_array_elements_text(v_row -> 'platforms')),
      array(select jsonb_array_elements_text(v_row -> 'models')),
      v_regions,
      not v_over,
      case when v_over then now() end
    )
    returning prompts.id into v_id;

    if not v_over then
      v_used := v_used + v_cost;
    end if;
    idx := (v_row ->> 'idx')::integer;
    id := v_id;
    waiting := v_over;
    return next;
  end loop;
end;
$$;

revoke all on function public.import_prompts(uuid, uuid, integer, jsonb, text) from public, anon;
grant execute on function public.import_prompts(uuid, uuid, integer, jsonb, text) to authenticated, service_role;

comment on function public.import_prompts(uuid, uuid, integer, jsonb, text) is
  'Bulk-inserts prompts [{idx, text, category, topic_id, platforms, models, regions}] in order under a per-organization advisory lock, up to p_max_locations tracked locations for the org (-1 = unlimited). Past the limit: p_over_limit ''skip'' (default) stops there, ''wait'' saves the rest waiting for a spot (inactive, waiting_since now; 00535). Returns (idx, id, waiting) for each saved row. PROMPT-005.';

notify pgrst, 'reload schema';
