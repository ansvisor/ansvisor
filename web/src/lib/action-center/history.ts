/**
 * The shapes the History tab reads, and the honest state of each one.
 *
 * History answers a narrower question than the Actions tab: not "what should
 * we do", but "what did we do, and did it work". The second half of that has
 * two parts, and only one of them exists yet.
 *
 * What the product already knows, and this tab shows from real rows: which
 * action ran, what kind it was, what it touched, which signals opened it,
 * what its goal was, which tasks were carried out, who it was assigned to,
 * when it closed and how long that took.
 *
 * What nothing yet measures: the result. An action's `baseline` captures the
 * triggering signals' values at the moment it was created, so the "before"
 * half is recorded — but no pass re-reads those metrics afterwards, so there
 * is no "after" to compare it to. Visibility change, citations change, prompts
 * improved: none of them have a source.
 *
 * So `results` comes back empty and `outcome` reads `pending_measurement`
 * rather than a number, and the UI says so plainly instead of implying a
 * measurement that did not happen. The types below are the full shape the
 * validation pass (#818, phase 2) will fill in; adding it is a matter of
 * populating these, not reshaping them.
 */

import type {
  ActionCategory,
  ActionImpact,
  ActionOutcome,
  ActionStatus,
  TaskStatus,
} from './registry';
import type { SignalSource } from '@/lib/signals/registry';

/** A metric an action moved, read before and after it ran. */
export interface ActionResultMetric {
  id: string;
  label: string;
  metric:
    | 'visibility'
    | 'citations'
    | 'mentions'
    | 'traffic'
    | 'share_of_voice'
    | 'prompts_improved'
    | 'custom';
  before?: number;
  after?: number;
  delta?: number;
  deltaPercent?: number;
  unit: 'percent' | 'number' | 'sessions' | 'citations' | 'mentions' | 'prompts';
  direction: 'higher_is_better' | 'lower_is_better';
}

/** Something an action touched. Deliberately generic — an action's subject is
 *  prompts for one kind and pages for another, and the column shows whichever
 *  the payload actually carries. */
export interface AffectedEntity {
  id: string;
  type: 'prompt' | 'url' | 'keyword' | 'topic' | 'citation' | 'competitor' | 'platform';
  /** Either a named entity, or a bare count when the payload holds only a number. */
  name: string;
  count?: number;
  url?: string;
  platform?: string;
  beforeValue?: string | number;
  afterValue?: string | number;
}

/** A task as it stood when the action closed. */
export interface ActionHistoryTask {
  id: string;
  /** Resolved text: the user's title when they wrote one, else the template. */
  title: string;
  status: TaskStatus;
  completedAt?: string;
}

/** A signal that opened the action. Several signals consolidate into one
 *  action, so this is a list rather than a field. */
export interface TriggerSignal {
  signalId: string;
  kind: string;
  detectedAt: string;
}

export interface ActionHistoryItem {
  id: string;
  actionNo: number;
  kind: string;
  /** Grow / Recover / Protect / Fix / Compete — the module's one classification. */
  type: ActionCategory;
  impact: ActionImpact;
  status: ActionStatus;
  /** Did it help? Read from the action's own column, not inferred here. */
  outcome: ActionOutcome;
  payload: Record<string, unknown>;
  kpiKeys: string[];
  sources: SignalSource[];
  triggerSignals: TriggerSignal[];
  affected: AffectedEntity[];
  /** Empty until something measures an action's effect. */
  results: ActionResultMetric[];
  tasks: ActionHistoryTask[];
  assignee: { id: string; fullName: string | null; avatarUrl: string | null } | null;
  createdAt: string;
  completedAt: string | null;
  /** Calendar days from creation to close. Real — both stamps are recorded. */
  timeToCloseDays: number | null;
}

export interface HistorySummary {
  totalActions: number;
  completed: number;
  completedPercent: number;
  inProgress: number;
  inProgressPercent: number;
  noImprovement: number;
  noImprovementPercent: number;
  dismissed: number;
  dismissedPercent: number;
  /** Highest impact among the actions in range — a readout of what was worked
   *  on, not a claim about what it achieved. That claim needs validation. */
  topImpact: ActionImpact | null;
}

/** Statuses History covers: an action that has run its course, plus the ones
 *  still running so the tab shows the whole arc rather than only its end. */
export const HISTORY_STATUSES: readonly ActionStatus[] = [
  'in_progress',
  'on_hold',
  'completed',
  'dismissed',
];

export const HISTORY_SORTS = ['newest', 'oldest', 'impact'] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];

export const HISTORY_PAGE_SIZE = 10;

const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

export function summarize(items: ActionHistoryItem[]): HistorySummary {
  const total = items.length;
  const count = (status: ActionStatus) => items.filter((i) => i.status === status).length;
  const completed = count('completed');
  const inProgress = count('in_progress');
  // An outcome, not a status: an action reaches it by being completed and
  // then measured, so it is counted from the outcome column.
  const noImprovement = items.filter((i) => i.outcome === 'no_meaningful_change').length;
  const dismissed = count('dismissed');

  const impacts = items.map((i) => i.impact);
  const topImpact: ActionImpact | null = impacts.includes('high')
    ? 'high'
    : impacts.includes('medium')
      ? 'medium'
      : impacts.includes('low')
        ? 'low'
        : null;

  return {
    totalActions: total,
    completed,
    completedPercent: pct(completed, total),
    inProgress,
    inProgressPercent: pct(inProgress, total),
    noImprovement,
    noImprovementPercent: pct(noImprovement, total),
    dismissed,
    dismissedPercent: pct(dismissed, total),
    topImpact,
  };
}

/** Whole days between two stamps, floored — "4 days" means four elapsed. */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
