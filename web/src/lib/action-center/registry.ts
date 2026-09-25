/**
 * The action registry — what this build knows how to present.
 *
 * Same division of labor as signals, with one asymmetry worth naming: the
 * server's definition registry (server/src/lib/action-center/definitions) is
 * the source of truth for which actions EXIST, and it is meant to grow
 * without this file following. So the list below is not a contract — it is
 * the set of kinds we have written copy and an icon for. Anything the server
 * raises that is not here still reaches the user, presented from its
 * category and its id; see lib/action-center/display.ts.
 *
 * Dropping a kind from this list therefore degrades an action; it never
 * hides one.
 */

export type ActionCategory = 'growth' | 'protect' | 'recover' | 'fix' | 'compete';

export type ActionImpact = 'high' | 'medium' | 'low';

/** Was the work done? Execution only — see ActionOutcome for whether it helped. */
export type ActionStatus = 'new' | 'in_progress' | 'on_hold' | 'completed' | 'dismissed';

/**
 * Did the work help?
 *
 * Kept apart from ActionStatus on purpose: an action is completed by someone
 * finishing it, and measured afterwards by something re-reading its metrics.
 * `no_improvement` used to live in the status column, which made the two
 * questions unanswerable for an action that was completed but never measured
 * — today, every one of them.
 */
export type ActionOutcome =
  | 'pending_measurement'
  | 'improved'
  | 'no_meaningful_change'
  | 'declined'
  | 'not_measurable';

/** A kind this build has copy and an icon for. */
export type ActionKind =
  | 'recover_visibility'
  | 'protect_visibility'
  | 'expand_platform_visibility'
  | 'close_citation_gap'
  | 'capture_ai_traffic'
  | 'convert_mentions'
  | 'fix_low_scores'
  | 'close_competitor_gap';

export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'waiting_approval'
  | 'completed'
  | 'skipped'
  | 'failed';

export const ACTION_CATEGORIES: readonly ActionCategory[] = [
  'growth',
  'protect',
  'recover',
  'fix',
  'compete',
];

export const ACTION_STATUSES: readonly ActionStatus[] = [
  'new',
  'in_progress',
  'on_hold',
  'completed',
  'dismissed',
];

export const ACTION_OUTCOMES: readonly ActionOutcome[] = [
  'pending_measurement',
  'improved',
  'no_meaningful_change',
  'declined',
  'not_measurable',
];

/** An action whose cycle is over: it is history, and its kind's slot is free. */
export const CLOSED_ACTION_STATUSES: readonly ActionStatus[] = ['completed', 'dismissed'];

export const ACTION_IMPACTS: readonly ActionImpact[] = ['high', 'medium', 'low'];

export const TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'waiting_approval',
  'completed',
  'skipped',
  'failed',
];

/** Statuses that leave the progress denominator — the work is not outstanding. */
export const UNCOUNTED_TASK_STATUSES: readonly TaskStatus[] = ['skipped', 'failed'];

export const ACTION_KINDS: readonly ActionKind[] = [
  'recover_visibility',
  'protect_visibility',
  'expand_platform_visibility',
  'close_citation_gap',
  'capture_ai_traffic',
  'convert_mentions',
  'fix_low_scores',
  'close_competitor_gap',
];

/**
 * Is this one of the kinds we have copy for?
 *
 * A guard, not a filter. Callers use it to choose between the written
 * presentation and the generic one — never to decide whether a row is real.
 */
export function isActionKind(value: string): value is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(value);
}

/** Sort orders the toolbar offers. Priority is impact-weighted evidence. */
export type ActionSort = 'priority' | 'impact' | 'newest' | 'due_date' | 'updated';
export const ACTION_SORTS: readonly ActionSort[] = [
  'priority',
  'impact',
  'newest',
  'due_date',
  'updated',
];
