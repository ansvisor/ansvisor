/**
 * The candidate queue (#818, phase 6).
 *
 * One active action per definition is the right rule — nobody should be
 * handed the same piece of work twice — but until now it left a second
 * finding nowhere to go. Phase 1 stopped such a finding corrupting the open
 * action's scope; it did not stop it being lost. A condition detected while
 * the slot was busy was linked as evidence and then forgotten, because the
 * next cycle is built from whatever happens to be open on the night the slot
 * frees up. Anything that had resolved in between was never worked on at all.
 *
 * So the engine now answers two questions separately. *What did we find?*
 * produces candidates, every night, whether or not anything can be done about
 * them. *What should we act on?* promotes from that queue, subject to the
 * slot, the rest window, eligibility and the daily cap.
 *
 * A candidate's lifecycle mirrors a signal's, deliberately: it waits while
 * its evidence is live, goes stale when the evidence is gone, and comes back
 * if the condition returns. What it must never do is disappear quietly, which
 * is the behaviour this phase exists to end.
 */

import { resolve } from '../../config/action-engine.js';

const DAY_MS = 86_400_000;

const { priority } = resolve();

const IMPACT_SCORE = {
  high: priority.impactHigh,
  medium: priority.impactMedium,
  low: priority.impactLow,
};

/**
 * What a candidate is worth acting on, tonight.
 *
 * Three terms, in the order they matter: how bad it is, how much evidence
 * stands behind it, and how long it has been waiting. The first two reproduce
 * the ordering the Action Center has always used; the third is what a queue
 * needs and a sort does not — without it, a low-impact finding behind a brand
 * with a steady stream of high-impact ones would never come up at all.
 *
 * Both of the lower terms are capped, so evidence and patience can move a
 * candidate up the queue but cannot make it outrank a whole grade of impact
 * on their own. Deliberate: a queue that lets forty pages of low-impact
 * opportunity outrank a visibility collapse is not a priority order, it is a
 * vote.
 *
 * @param {{ impact: string, signalCount: number, firstSeenAt?: string|Date }} candidate
 * @param {Date} now
 */
export function scoreCandidate({ impact, signalCount, firstSeenAt }, now = new Date()) {
  const base = IMPACT_SCORE[impact] ?? IMPACT_SCORE.low;

  // Defensive rather than trusting: a caller that forgets to pass the count
  // used to produce NaN, which sorts as "no opinion" and silently degraded
  // the whole queue to alphabetical order. A scoring bug that still promotes
  // something every night, just the wrong thing, is not one anybody notices.
  const count = Number.isFinite(signalCount) ? Math.max(signalCount, 0) : 0;
  const evidence = Math.min(count, priority.evidenceCap) * priority.evidencePerSignal;

  const seen = firstSeenAt ? new Date(firstSeenAt).getTime() : now.getTime();
  const waitedDays = Math.max(0, Math.floor((now.getTime() - seen) / DAY_MS));
  const age = Math.min(waitedDays, priority.ageCapDays) * priority.agePerDay;

  return base + evidence + age;
}

/**
 * The queue in the order it should be worked, highest first.
 *
 * Ties break on how long the candidate has waited and then on definition id,
 * so two runs over the same data promote the same thing. An engine whose
 * output depends on map iteration order is one nobody can reason about.
 */
export function orderByPriority(candidates, now = new Date()) {
  return [...candidates].sort(
    (a, b) =>
      scoreCandidate(b, now) - scoreCandidate(a, now) ||
      Date.parse(a.firstSeenAt ?? 0) - Date.parse(b.firstSeenAt ?? 0) ||
      String(a.definitionId).localeCompare(String(b.definitionId)),
  );
}
