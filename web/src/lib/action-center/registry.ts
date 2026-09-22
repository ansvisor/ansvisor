/**
 * The action registry — static product knowledge about every action kind
 * the generator can produce. Same division of labor as signals: the server
 * (server/src/lib/action-center/generate.js ACTION_RULES) owns what gets
 * stored; this file owns display — i18n template keys, task lists, and the
 * context tags a row shows.
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

export interface ActionKindMeta {
  kind: ActionKind;
  /** Ordered task template keys — the DB rows carry the same keys. */
  taskKeys: string[];
}

export const ACTION_KINDS: Record<ActionKind, ActionKindMeta> = {
  recover_visibility: {
    kind: 'recover_visibility',
    taskKeys: ['analyze_losses', 'coverage_gaps', 'update_content', 'internal_links', 'validate'],
  },
  protect_visibility: {
    kind: 'protect_visibility',
    taskKeys: ['diagnose_slip', 'review_responses', 'reinforce_content', 'validate'],
  },
  expand_platform_visibility: {
    kind: 'expand_platform_visibility',
    taskKeys: ['compare_platforms', 'coverage_gaps', 'optimize_content', 'validate'],
  },
  close_citation_gap: {
    kind: 'close_citation_gap',
    taskKeys: ['compare_citations', 'identify_sources', 'strengthen_sources', 'validate'],
  },
  capture_ai_traffic: {
    kind: 'capture_ai_traffic',
    taskKeys: ['review_pages', 'coverage_gaps', 'optimize_content', 'validate'],
  },
  convert_mentions: {
    kind: 'convert_mentions',
    taskKeys: ['identify_prompts', 'create_citable_content', 'strengthen_sources'],
  },
  fix_low_scores: {
    kind: 'fix_low_scores',
    taskKeys: ['review_audits', 'fix_issues', 'revalidate'],
  },
  close_competitor_gap: {
    kind: 'close_competitor_gap',
    taskKeys: ['analyze_competitor', 'coverage_gaps', 'strengthen_content', 'validate'],
  },
};

export function isActionKind(value: string): value is ActionKind {
  return value in ACTION_KINDS;
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
