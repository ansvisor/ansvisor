-- ============================================================================
-- 00563: a stale action replaced by a new one of its kind
-- ============================================================================
-- An action nobody worked on held its kind's only active slot for good: the
-- nightly pass linked new signals to it, and the brand was told nothing new
-- until someone closed it. Now, once an action is stale (still New, nobody's
-- event for 30 days, 00432) and its kind still fires, the pass dismisses it
-- with dismiss_reason 'replaced' and opens a new action from tonight's
-- signals (server/src/lib/action-center/generate.js).
--
--   * actions.dismiss_reason also takes 'replaced'. People never choose it:
--     the dismiss dialog offers the four reasons of 00366.
--   * action_scorecard leaves replaced actions out: nobody closed them, so
--     they are neither a result nor a turned-down action, and the priority
--     score's past success (learning B4) reads the same function.
--
-- Constraint and function only; nothing is backfilled. It applies in seconds.

alter table public.actions
  drop constraint if exists actions_dismiss_reason_check;

alter table public.actions
  add constraint actions_dismiss_reason_check
  check (
    dismiss_reason is null
    or dismiss_reason in ('not_relevant', 'already_done', 'wrong_data', 'not_now', 'replaced')
  );

comment on column public.actions.dismiss_reason is
  'Why the action was dismissed (00366, learning A5): not_relevant, already_done, wrong_data or not_now from a person, or replaced when the nightly pass replaced it after it went stale (00563); null when no reason was given or the action is not dismissed.';

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
       -- Replaced by the nightly pass after it went stale (00563): nobody
       -- closed it, so it is neither a result nor a turned-down action.
       and a.dismiss_reason is distinct from 'replaced'
       -- Closed in the range (UX audit AC-61, decision D13): a completed
       -- action by when it was completed, a dismissed one by its last change
       -- (dismissing sets no completed_at), as History's list reads them.
       and (
         p_since is null
         or case
              when a.status = 'completed' then coalesce(a.completed_at, a.updated_at)
              else a.updated_at
            end >= p_since
       )
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

comment on function public.action_scorecard(uuid, timestamptz, text) is
  'A brand''s actions closed since a day (completed by completed_at, dismissed by updated_at; 00553, AC-61), by kind or (p_by ''play'') by the play they were opened with: completed, results, median change in the main metric, dismissed and why (00368, learning B3; 00484, AC plan P-4); actions replaced after going stale left out (00563). RLS applies to the caller.';

notify pgrst, 'reload schema';
