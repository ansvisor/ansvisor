-- Detector thresholds against outcomes (learning C6): exports one brand's
-- closed actions (completed or dismissed) with the signals that opened them,
-- one JSON object a line, for src/scripts/calibrate-detector-thresholds.js.
--
-- Run it on one brand (Ansvisor's own, or your own self-hosted data).
-- Running it across customers' brands is not supported; it waits on the
-- cross-brand learning decision (C5) and a privacy policy update.
--
-- Run from server/, with psql (it only reads):
--   psql "<database url>" -X -q -A -t -v brand_id=<brand uuid> \
--     -f src/scripts/export-detector-outcomes.sql > outcomes.jsonl
--
-- brand_id is required; without it the script stops with an error. A line
-- holds the action's id (so each action counts once per signal kind), the
-- signal's kind and values, and how the action ended: no payload, prompt,
-- URL or competitor.

\set ON_ERROR_STOP on

\if :{?brand_id}
\else
  \warn 'Usage: psql "<database url>" -X -q -A -t -v brand_id=<brand uuid> -f src/scripts/export-detector-outcomes.sql > outcomes.jsonl'
  do $$ begin raise exception 'brand_id is required: the export reads one brand only'; end $$;
\endif

select json_build_object(
         'action', a.id,
         'kind', s.kind,
         'current', s.current_value,
         'change', s.change_value,
         'status', a.status,
         'outcome', a.outcome,
         'dismissReason', a.dismiss_reason
       )
  from public.actions a
  join public.action_signals l on l.action_id = a.id
  join public.signals s on s.id = l.signal_id
 where a.brand_id = :'brand_id'::uuid
   and a.deleted_at is null
   and a.status in ('completed', 'dismissed')
 order by a.created_at, a.id, s.kind;
