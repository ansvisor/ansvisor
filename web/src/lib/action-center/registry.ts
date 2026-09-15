/**
 * The action registry — static product knowledge about every action kind
 * the generator can produce. Same division of labor as signals: the server
 * (server/src/lib/action-center/generate.js ACTION_RULES) owns what gets
 * stored; this file owns display — i18n template keys, task lists, and the
 * context tags a row shows.
 */

export type ActionCategory = 'growth' | 'protect' | 'recover' | 'fix' | 'compete';

export type ActionImpact = 'high' | 'medium' | 'low';

export type ActionStatus =
  | 'new'
  | 'in_progress'
  | 'completed'
  | 'on_hold'
  | 'no_improvement'
  | 'dismissed';

export type ActionKind =
  | 'recover_visibility'
  | 'capture_ai_traffic'
  | 'convert_mentions'
  | 'fix_low_scores'
  | 'close_competitor_gap';

export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'canceled';

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
  'completed',
  'on_hold',
  'no_improvement',
  'dismissed',
];

export const ACTION_IMPACTS: readonly ActionImpact[] = ['high', 'medium', 'low'];

export const TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'completed',
  'canceled',
];

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
