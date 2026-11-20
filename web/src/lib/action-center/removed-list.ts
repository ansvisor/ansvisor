import { removedTargets } from './entity-counts';

/**
 * AC-13: what an action lost since it was created, one by one, and whether
 * to re-plan it. The note "(16 prompts removed since this action was
 * created)" opens this list.
 */

/** Why a target left the action's list (action_entities.removed_reason, 00244). */
export type RemovedReason = 'deleted' | 'paused';

/** One removed target: its name, and why when the list says. */
export interface RemovedTarget {
  label: string;
  reason: RemovedReason | null;
}

/** A row of action_entities as the removed list reads it. */
export interface RemovedEntityRow {
  entity_key: string;
  label: string | null;
  removed_reason: string | null;
}

/** The rows as the list shows them: by name, the reason only when it is one we word. */
export function removedListOf(rows: RemovedEntityRow[]): RemovedTarget[] {
  return rows.map((row) => ({
    label: row.label || row.entity_key,
    reason:
      row.removed_reason === 'deleted' || row.removed_reason === 'paused'
        ? row.removed_reason
        : null,
  }));
}

/** Actions whose tasks aren't written from their evidence (the task writer's SENT_KINDS). */
const NOT_REWRITTEN = new Set([
  'prompt_improve',
  'content_opportunity',
  'bridge_links',
  'product_pages_optimize',
]);

/**
 * Whether to offer "Re-plan with the remaining prompts": more than half of
 * the prompts the action was made with are gone, some are left, and its
 * tasks can be written again (Regenerate tasks, which leaves the removed
 * ones out).
 */
export function shouldReplan(action: {
  kind: string;
  status: string;
  payload: Record<string, unknown>;
}): boolean {
  const removed = removedTargets(action.payload);
  if (!removed || action.payload.targetEntity !== 'prompts') return false;
  if (NOT_REWRITTEN.has(action.kind)) return false;
  if (action.status === 'completed' || action.status === 'dismissed') return false;
  const created = Number(action.payload.createdTargetCount ?? 0);
  const left = Number(action.payload.targetCount ?? 0);
  return created > 0 && left > 0 && removed.count * 2 > created;
}
