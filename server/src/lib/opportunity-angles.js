/**
 * Another angle when the needs run out (owner decision 2026-11-03).
 *
 * Each need (prompt cluster) gets one opportunity, so once most needs have
 * one, New has little left to write for. When a request runs out of needs
 * with no opportunity, the rest of it is written as another angle
 * (CONTENT-006) on needs the brand is still barely seen for. That only
 * happens where the existing work has had its chance: the opportunity is
 * done or dismissed, or has been open for ANGLE_AFTER_DAYS. A need dismissed
 * as "The topic doesn't matter to us" never gets one.
 *
 * The nightly run does the same, more sparingly: on a night with no need
 * left to write for, at most NIGHTLY_ANGLES, on the need with the most
 * demand whose opportunity has been done for ANGLE_AFTER_DAYS.
 *
 * Pure on purpose: the generator and the New dialog's availability read the
 * rows, this picks.
 */

import { OPEN_OPPORTUNITY_STATUSES } from './opportunity-limits.js';
import { clustersOf, findSameQuestion, isOpen } from './opportunity-same-question.js';

/** Brand visibility (% of answers mentioning or citing it) below which a need is still barely seen. */
export const STILL_LOW_VISIBILITY = 20;

/** How long an open opportunity has had its chance before its need may get another angle. */
export const ANGLE_AFTER_DAYS = 30;

/** Angles one nightly run may write, only when no need is left without an opportunity. */
export const NIGHTLY_ANGLES = 1;

const DAY_MS = 86_400_000;

/** The opportunities on a cluster, as its own or a merged one; archived ones don't count. */
function onCluster(rows, clusterId) {
  return (rows || []).filter(
    (r) =>
      r.status !== 'archived' &&
      (r.cluster_id === clusterId || (r.related_cluster_ids || []).includes(clusterId)),
  );
}

/**
 * Since when an open opportunity has had its chance: when it was made, or
 * when it was last reopened (opportunity-reopen.js), whichever is later. A
 * done opportunity the same run reopened starts its 30 days again.
 */
function openSince(row) {
  const times = [row.created_at, row.reopenedAt]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : NaN;
}

/**
 * Whether this opportunity's work has had its chance, so its need may get
 * another angle. At night only work done ANGLE_AFTER_DAYS ago counts.
 */
function hadItsChance(row, now, nightly) {
  const days = (at) => (now - at) / DAY_MS;
  if (nightly) return row.status === 'done' && days(Date.parse(row.updated_at)) >= ANGLE_AFTER_DAYS;
  if (row.status === 'done') return true;
  if (row.status === 'dismissed') return row.dismissReason !== 'not_relevant';
  if (!OPEN_OPPORTUNITY_STATUSES.includes(row.status)) return false;
  return days(openSince(row)) >= ANGLE_AFTER_DAYS;
}

/**
 * Whether an open opportunity other than the need's own already answers it
 * (one open opportunity per question, #1923): one holding the need as a
 * related cluster (a Send to Content or task opportunity), or one answering
 * the need's question. An angle there would sit next to it, unmerged.
 */
function answeredElsewhere(c, own, openRows) {
  const others = openRows.filter((r) => isOpen(r) && !own.has(r.id));
  if (others.some((r) => clustersOf(r).includes(c.id))) return true;
  const question = c.metrics.representative;
  return !!findSameQuestion(
    { question: question?.text ?? null, promptId: question?.id ?? null, clusterIds: [c.id] },
    others,
  );
}

/**
 * Covered needs a request may write another angle on, best score first (at
 * night, most demand first): with answers, the brand still under
 * STILL_LOW_VISIBILITY, every opportunity on the need past its chance
 * (hadItsChance), and no other open opportunity in `openRows` answering it
 * (answeredElsewhere). Each comes with the opportunity it's an angle on: the
 * newest on the need.
 *
 * @param {{ id: string, score: number, metrics: { tested: number, visibility: number, demand?: number } }[]} candidates
 * @param {{ id: string, title: string, status: string, created_at?: string, updated_at?: string, reopenedAt?: string|null, dismissReason?: string|null, decision?: string|null, cluster_id: string, related_cluster_ids?: string[] }[]} rows
 * @param {{ covered: Set<string>, inFocus?: (c: object) => boolean, now?: number, nightly?: boolean, openRows?: object[] }} opts
 *   `openRows`: every opportunity of the brand, as loadOpportunityBaskets reads them
 * @returns {(object & { angleOf: { id: string, title: string, decision: string|null } })[]}
 */
export function angleCandidates(
  candidates,
  rows,
  { covered, inFocus = () => true, now = Date.now(), nightly = false, openRows = [] },
) {
  const picked = [];
  for (const c of candidates) {
    if (!covered.has(c.id) || !inFocus(c)) continue;
    if (!(c.metrics.tested > 0) || !(c.metrics.visibility < STILL_LOW_VISIBILITY)) continue;
    const on = onCluster(rows, c.id);
    if (!on.length || !on.every((r) => hadItsChance(r, now, nightly))) continue;
    if (answeredElsewhere(c, new Set(on.map((r) => r.id)), openRows)) continue;
    const latest = [...on].sort(
      (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0),
    )[0];
    picked.push({
      ...c,
      angleOf: { id: latest.id, title: latest.title, decision: latest.decision ?? null },
    });
  }
  return nightly
    ? picked.sort((a, b) => (b.metrics.demand || 0) - (a.metrics.demand || 0))
    : picked.sort((a, b) => b.score - a.score);
}

/** Hours after a nightly angle in which the nightly run writes no other. */
export const NIGHTLY_ANGLE_GAP_HOURS = 20;

/**
 * Whether the nightly run wrote another angle lately (NIGHTLY_ANGLE_GAP_HOURS):
 * a system opportunity marked as an angle (source_data.alternativeOf).
 *
 * @param {{ source?: string, created_at?: string, source_data?: { alternativeOf?: unknown } }[]} rows
 */
export function recentNightlyAngle(rows, now = Date.now()) {
  return (rows || []).some(
    (r) =>
      r.source === 'system' &&
      !!r.source_data?.alternativeOf &&
      now - Date.parse(r.created_at) < NIGHTLY_ANGLE_GAP_HOURS * 3_600_000,
  );
}

/**
 * What the model is told for a need it writes another angle on, in that
 * need's own entry: the opportunity it already has, and that this one must
 * differ in kind (alternativeInstruction, for one need at a time).
 */
export function angleLine({ title, decision }) {
  return `This need already has the opportunity "${title}"${decision ? ` (decided as "${decision}")` : ''}, and the brand is still barely seen for it. Write another angle on it: one that differs clearly in content type, format, audience or decision. Don't repeat its title or approach, and set sameAs to null.`;
}
