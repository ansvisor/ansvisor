import { CLOSED_ACTION_STATUSES, type ActionStatus } from '@/lib/action-center/registry';

/**
 * The Actions list's summary: what is new since the person's last visit,
 * and what closed this week. The count alone stayed level while new actions
 * kept coming, so it read as if older ones were deleted; they never are.
 *
 * The last visit is kept in this browser, per person and brand, as the
 * editor's last draft is: storage unavailable (private mode) reads as no
 * visit, so nothing is marked New rather than everything.
 */

/** "Closed this week": completed or dismissed in the last this many days. */
export const CLOSED_WEEK_DAYS = 7;

const visitKey = (userId: string, brandId: string) => `aeo:actions-visit:${userId}:${brandId}`;

/** When the person last opened the Actions list on the brand (ISO), or null. */
export function readActionsVisit(userId: string, brandId: string): string | null {
  try {
    const kept = localStorage.getItem(visitKey(userId, brandId));
    return kept && !Number.isNaN(Date.parse(kept)) ? kept : null;
  } catch {
    return null;
  }
}

export function writeActionsVisit(userId: string, brandId: string, at: Date): void {
  try {
    localStorage.setItem(visitKey(userId, brandId), at.toISOString());
  } catch {
    // Not kept: the next visit marks nothing New.
  }
}

/**
 * Created since the last visit. Only a row's creation counts: one a new
 * signal updated keeps its dot, not New. No visit kept: nothing is New.
 */
export function isNewSinceVisit(action: { createdAt: string }, visit: string | null): boolean {
  if (!visit) return false;
  const created = Date.parse(action.createdAt);
  return !Number.isNaN(created) && created > Date.parse(visit);
}

/** The start of "this week": CLOSED_WEEK_DAYS before `now`, as ISO. */
export function closedSince(now: Date): string {
  return new Date(now.getTime() - CLOSED_WEEK_DAYS * 24 * 60 * 60_000).toISOString();
}

/**
 * Completed or dismissed in the last week: closed, and last changed since
 * then (closing an action stamps updated_at). getClosedThisWeekCount counts
 * the same rows on the server.
 */
export function isClosedThisWeek(
  action: { status: ActionStatus; updatedAt: string },
  now: Date,
): boolean {
  if (!CLOSED_ACTION_STATUSES.includes(action.status)) return false;
  const updated = Date.parse(action.updatedAt);
  return !Number.isNaN(updated) && updated >= Date.parse(closedSince(now));
}
