import type { Demand } from '@/lib/action-center/first-day';

/**
 * The swap dialog's candidates (Simplify PR 16, behind SIMPLE_NAV): tracked
 * prompts someone could pause to make room for one waiting for a spot (or a
 * paused one they want back). Pure: the server action reads, this orders.
 *
 * The plan's limit belongs to the workspace, so the candidates come from
 * every brand the person can see in it: the brand on screen first, then the
 * others. Within each, the least useful first: the lowest demand (each
 * brand's prompt_volumes, in thirds as Today's first day reads them), then
 * how rarely AI named the brand there in the last 30 days (the Tracked
 * Prompts table's own read).
 */
export interface PauseCandidate {
  id: string;
  text: string;
  brandId: string;
  brandName: string;
  /** The brand on screen. */
  current: boolean;
  /** Spots pausing it frees: one per location it is tracked in. */
  locations: number;
  /** Against the brand's other prompts; null when its demand wasn't measured. */
  demand: Demand | null;
  /** Answers that named the brand in the last 30 days, of `answers`. */
  mentions: number;
  answers: number;
}

/** Low demand first; an unmeasured one after low, before medium. */
const DEMAND_RANK: Record<Demand | 'none', number> = { low: 0, none: 1, medium: 2, high: 3 };

/** How often AI named the brand on it; null with no answers to go by. */
export function mentionRate(
  candidate: Pick<PauseCandidate, 'mentions' | 'answers'>,
): number | null {
  return candidate.answers > 0 ? candidate.mentions / candidate.answers : null;
}

/** The order the dialog lists them in: this brand first, then the least useful first. */
export function rankPauseCandidates(candidates: readonly PauseCandidate[]): PauseCandidate[] {
  const rate = (c: PauseCandidate) => mentionRate(c) ?? Number.POSITIVE_INFINITY;
  return [...candidates].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      DEMAND_RANK[a.demand ?? 'none'] - DEMAND_RANK[b.demand ?? 'none'] ||
      rate(a) - rate(b) ||
      a.mentions - b.mentions ||
      a.text.localeCompare(b.text),
  );
}

/**
 * Spots still missing for a prompt that needs `need` (one per location)
 * when `free` are free; 0 once it fits. `free` is null on an unlimited plan.
 */
export function spotsShort(need: number, free: number | null): number {
  return free === null ? 0 : Math.max(0, need - free);
}

/** Spots these candidates free together. */
export function spotsFreed(
  candidates: readonly Pick<PauseCandidate, 'id' | 'locations'>[],
  ids: ReadonlySet<string>,
): number {
  return candidates.reduce((sum, c) => (ids.has(c.id) ? sum + c.locations : sum), 0);
}

/**
 * The fewest candidates, taken in the dialog's order, that free `short`
 * spots: what it ticks first. Empty when nothing is short; null when even
 * all of them don't free enough.
 */
export function firstPicks(
  candidates: readonly Pick<PauseCandidate, 'id' | 'locations'>[],
  short: number,
): string[] | null {
  if (short <= 0) return [];
  const picks: string[] = [];
  let freed = 0;
  for (const c of candidates) {
    picks.push(c.id);
    freed += c.locations;
    if (freed >= short) return picks;
  }
  return null;
}
