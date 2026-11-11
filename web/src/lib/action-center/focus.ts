import type { FocusPin } from '@/lib/user-brand-state';

/**
 * Today's focus (simplification plan PR 7): the 3 actions a
 * person works on, on Action Center › Today.
 *
 * The ranking is the server's (GET /api/action-center/today), shared with
 * the Chat Inbox's daily suggestion, so the two never disagree. What this
 * adds is that the focus holds still: the actions the person has in it
 * (user_brand_state.focus) stay while they are still open and theirs to do,
 * and only an empty slot takes the next one from the ranking. A slot filled
 * since the person's last visit to Today is marked New. "Skip for now"
 * hides an action from this person's focus for 7 days; the action itself
 * doesn't change. Pure: the server action reads and keeps the state.
 */

/** How many actions the focus holds. */
export const FOCUS_SLOTS = 3;

/** How long "Skip for now" keeps an action out of the person's focus. */
export const SKIP_DAYS = 7;

/**
 * Action kinds that remind of a recurring chore, such as the weekly
 * ChatGPT Business Hub numbers (#2305). They never take a focus slot: they
 * are listed under Waiting for you. Read by name, so a kind this install
 * doesn't raise simply never matches.
 */
export const REMINDER_KINDS: readonly string[] = ['business_hub_numbers'];

export const isReminderKind = (kind: string) => REMINDER_KINDS.includes(kind);

/** The statuses the focus keeps, as the ranking lists them: not on hold, completed or dismissed. */
const OPEN = ['new', 'in_progress'];

/** What decides whether an action may hold a slot. */
export interface FocusCandidate {
  id: string;
  kind: string;
  status: string;
  assigneeId: string | null;
}

/** A slot as Today shows it. */
export interface FocusSlot {
  id: string;
  /** When it took its slot. */
  addedAt: string;
  /** Filled since the person's last visit to Today. */
  isNew: boolean;
}

/** The actions a person skipped, from their hidden cards (expired ones are already left out). */
export function skippedActions(hidden: Record<string, string | null>): Set<string> {
  return new Set(
    Object.keys(hidden).flatMap((key) => (key.startsWith('skip:') ? [key.slice(5)] : [])),
  );
}

/**
 * The person's focus now: the actions they keep that still fit, in their
 * order, then the best of the ranking for the slots left. An action fits
 * while it is open (new or in progress), unassigned or theirs, not a
 * reminder and not skipped; one that can't be read (deleted, or no longer
 * theirs to see) doesn't. `changed` says the focus to keep differs from
 * the one kept.
 */
export function pickFocus(input: {
  pins: readonly FocusPin[];
  /** The server's ranking, best first. */
  ranking: readonly string[];
  /** The actions that could be read, by id. */
  actions: ReadonlyMap<string, FocusCandidate>;
  skipped: ReadonlySet<string>;
  userId: string;
  now: Date;
  /** The person's last visit to Today; null before their first. */
  seenAt: string | null;
}): { slots: FocusSlot[]; changed: boolean } {
  const { pins, ranking, actions, skipped, userId, now, seenAt } = input;
  const fits = (id: string) => {
    const action = actions.get(id);
    return (
      action !== undefined &&
      OPEN.includes(action.status) &&
      (action.assigneeId === null || action.assigneeId === userId) &&
      !isReminderKind(action.kind) &&
      !skipped.has(id)
    );
  };

  const kept: FocusPin[] = [];
  for (const pin of pins) {
    if (kept.length === FOCUS_SLOTS) break;
    if (fits(pin.id) && !kept.some((other) => other.id === pin.id)) kept.push(pin);
  }
  const at = now.toISOString();
  for (const id of ranking) {
    if (kept.length === FOCUS_SLOTS) break;
    if (fits(id) && !kept.some((other) => other.id === id)) kept.push({ id, addedAt: at });
  }

  const seen = seenAt === null ? null : Date.parse(seenAt);
  const slots = kept.map((pin) => ({
    id: pin.id,
    addedAt: pin.addedAt,
    isNew: seen !== null && !Number.isNaN(seen) && Date.parse(pin.addedAt) > seen,
  }));
  const changed =
    slots.length !== pins.length ||
    slots.some((slot, i) => slot.id !== pins[i].id || slot.addedAt !== pins[i].addedAt);
  return { slots, changed };
}

/** The server's ranking, read defensively: Today's then the Next's ids, each once. */
export function rankedIds(body: unknown): string[] {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const ids: string[] = [];
  for (const list of [record.today, record.next]) {
    for (const entry of Array.isArray(list) ? list : []) {
      const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : null;
      if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** A brand's headline numbers, as the overview read gives them. */
export interface StandingSummary {
  brand: { name: string };
  totals: { aiVisibilityScore: number | null };
  topCompetitors: { name: string; score: number | null }[];
}

/** Where the brand stands among the brands its answers name. */
export interface TodayStanding {
  score: number;
  /** Since the run before; null without one. */
  change: number | null;
  /** 1 for first. */
  rank: number;
  /** The brand and the competitors with a score. */
  of: number;
  /** The brand just above (behind it), or just below when it leads; null alone. */
  neighbour: { name: string; gap: number; ahead: boolean } | null;
  /** Each competitor's score and change since the run before. */
  competitors: { name: string; score: number; change: number | null }[];
}

const tenth = (value: number) => Math.round(value * 10) / 10;

/**
 * The brand's score, its change since the run before, its rank among the
 * competitors with a score and the gap to the next brand. Null when the
 * brand has no score on the latest run's answers.
 */
export function standingFrom(
  current: StandingSummary,
  previous: StandingSummary | null,
): TodayStanding | null {
  const score = current.totals.aiVisibilityScore;
  if (score === null || !Number.isFinite(score)) return null;
  const before = previous?.totals.aiVisibilityScore ?? null;
  const previousOf = new Map(
    (previous?.topCompetitors ?? []).flatMap((c) => (c.score === null ? [] : [[c.name, c.score]])),
  );
  const competitors = current.topCompetitors.flatMap((c) =>
    c.score === null
      ? []
      : [
          {
            name: c.name,
            score: tenth(c.score),
            change: previousOf.has(c.name) ? tenth(c.score - previousOf.get(c.name)!) : null,
          },
        ],
  );
  // Ties go to the brand: it isn't behind a competitor with the same score.
  const ranked = [
    { name: current.brand.name, score, self: true },
    ...competitors.map((c) => ({ name: c.name, score: c.score, self: false })),
  ].sort((a, b) => b.score - a.score || Number(b.self) - Number(a.self));
  const at = ranked.findIndex((entry) => entry.self);
  const other = at > 0 ? ranked[at - 1] : ranked[at + 1];
  return {
    score: tenth(score),
    change: before === null ? null : tenth(score - before),
    rank: at + 1,
    of: ranked.length,
    neighbour: other
      ? { name: other.name, gap: tenth(Math.abs(other.score - score)), ahead: at === 0 }
      : null,
    competitors,
  };
}
