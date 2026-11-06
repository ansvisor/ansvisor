-- ============================================================================
-- 00484: what worked at a brand, by play as well as by kind (AC plan P-4)
-- ============================================================================
-- G15, G16 and C09 open with a play (AC-ACTION-PLAN-BY-BUSINESS-TYPE spec
-- §5, server action-center/playbooks.js): the page their prompts pick, kept
-- as payload.play, and on each reading of the action as validation.play
-- (validate.js). The scorecard (00368, learning B3) sums a brand's actions
-- by kind; with p_by 'play' it sums the ones opened with a play by that
-- play instead (§11), whichever kind opened them: History › Scorecard groups
-- by it, and the priority score's past success (learning B4) reads a play's
-- track before its kind's.
--
-- The function keeps its name, columns and default: called as before, it
-- reads by kind. Its `kind` column holds the group's key, a kind or, by
-- play, a play's id. Actions without a play are left out by play. One
-- brand's own actions only, never another's, as before.

drop function if exists public.action_scorecard(uuid, timestamptz);

create or replace function public.action_scorecard(
  p_brand_id uuid,
  p_since timestamptz default null,
  p_by text default 'kind'
)
returns table (
  kind text,
  completed integer,
  improved integer,
  mixed integer,
  no_change integer,
  declined integer,
  not_measurable integer,
  pending integer,
  final integer,
  median_change numeric,
  dismissed integer,
  dismiss_reasons jsonb
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with closed as (
    select case
             when p_by = 'play'
               then coalesce(a.validation->>'play', a.payload->'play'->>'id')
             else a.kind
           end as kind,
           a.status,
           a.outcome,
           a.dismiss_reason,
           a.validation->>'final' = 'true' as is_final,
           -- The relative change in its main metric (learning A4), when the
           -- metric was read before and after and had a before to scale by.
           (select (m->>'after')::numeric / nullif((m->>'before')::numeric, 0) - 1
              from jsonb_array_elements(
                     case when jsonb_typeof(a.validation->'metrics') = 'array'
                          then a.validation->'metrics' else '[]'::jsonb end
                   ) as m
             where m->>'metric' = a.validation->>'primary'
               and jsonb_typeof(m->'before') = 'number'
               and jsonb_typeof(m->'after') = 'number'
             limit 1) as change
      from public.actions a
     where a.brand_id = p_brand_id
       and a.deleted_at is null
       and a.status in ('completed', 'dismissed')
       and (p_since is null or a.created_at >= p_since)
       and p_by in ('kind', 'play')
  )
  select c.kind,
         count(*) filter (where c.status = 'completed')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'improved')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'mixed')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'no_meaningful_change')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'declined')::integer,
         count(*) filter (where c.status = 'completed' and c.outcome = 'not_measurable')::integer,
         count(*) filter (
           where c.status = 'completed'
             and (c.outcome is null or c.outcome = 'pending_measurement')
         )::integer,
         count(*) filter (where c.status = 'completed' and c.is_final)::integer,
         -- The median, so one small page that went from 1 to 20 doesn't
         -- read as the kind's typical result. Over the results with a
         -- verdict only.
         round(
           (percentile_cont(0.5) within group (order by c.change) filter (
             where c.status = 'completed'
               and c.outcome in ('improved', 'mixed', 'no_meaningful_change', 'declined')
           ))::numeric,
           4
         ),
         count(*) filter (where c.status = 'dismissed')::integer,
         coalesce(
           (select jsonb_object_agg(r.reason, r.n)
              from (select coalesce(d.dismiss_reason, 'none') as reason, count(*) as n
                      from closed d
                     where d.kind = c.kind and d.status = 'dismissed'
                     group by 1) as r),
           '{}'::jsonb
         )
    from closed c
   -- By play, the actions opened without one aren't a group.
   where c.kind is not null
   group by c.kind;
$$;

revoke all on function public.action_scorecard(uuid, timestamptz, text) from public, anon;
grant execute on function public.action_scorecard(uuid, timestamptz, text) to authenticated, service_role;

comment on function public.action_scorecard(uuid, timestamptz, text) is
  'A brand''s actions raised since a day, by kind or (p_by ''play'') by the play they were opened with: completed, results, median change in the main metric, dismissed and why (00368, learning B3; 00484, AC plan P-4). RLS applies to the caller.';

notify pgrst, 'reload schema';
