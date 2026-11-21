import type { Signal } from '@/lib/signals/map';
import { SIGNAL_KINDS, type SignalCategory } from '@/lib/signals/registry';

/**
 * Today's "Since yesterday" (simplification plan PR 8): the
 * biggest changes the nightly checks found since the person last looked,
 * read from the brand's signals. No thresholds of its own: the detectors'
 * noise rules already decide what becomes a signal, and Today shows only
 * the high and medium impact ones, at most 5, the biggest first. Pure: the
 * server action reads the rows.
 */

/** How many changes Today lists. */
export const SINCE_MAX = 5;

/** How far back "Since …" reaches at most: a week away reads "Since" that day. */
export const SINCE_DAYS = 7;

/** The menu section a signal's category belongs to: off the person's menu, it isn't listed. */
export const SIGNAL_SECTIONS: Record<SignalCategory, string> = {
  visibility: 'insights',
  mention: 'mentions',
  citation: 'citations',
  traffic: 'traffic',
  competitor: 'competitors',
  technical: 'audit',
};

/** How a change reads: good news, bad news, or a competitor's move. */
export type ChangeDirection = 'up' | 'down' | 'rival';

const DAY_MS = 86_400_000;

/**
 * Where "Since …" starts: the person's last visit to Today or the start of
 * the latest nightly run, whichever is earlier, at most a week back. So the
 * night's changes stay all day, and a Monday reads "Since Friday". With
 * neither, the last day.
 */
export function sinceStart(input: {
  seenAt: string | null;
  nightlyStart: string | null;
  now: Date;
}): string {
  const floor = input.now.getTime() - SINCE_DAYS * DAY_MS;
  const times = [input.seenAt, input.nightlyStart]
    .map((at) => (at ? Date.parse(at) : NaN))
    .filter((at) => !Number.isNaN(at));
  const start = times.length > 0 ? Math.min(...times) : input.now.getTime() - DAY_MS;
  return new Date(Math.max(start, floor)).toISOString();
}

/** Up for good news, Down for bad, Rival for a competitor gaining on the brand. */
export function changeDirection(signal: Pick<Signal, 'kind' | 'category'>): ChangeDirection {
  const positive = SIGNAL_KINDS[signal.kind]?.positive ?? false;
  if (positive) return 'up';
  return signal.category === 'competitor' ? 'rival' : 'down';
}

const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1 };

/**
 * The changes to list, biggest first (impact, then the size of the change),
 * from the open signals found in the window, without those whose section is
 * off the person's menu. Changes of one kind ("Rival A is mentioned far more
 * than you", "Rival B …") count as one row (AC-06), so `items` holds every
 * change of the first 5 rows, as groupChanges groups them. `total` counts
 * every high and medium one, `small` the low ones ("Small moves are in all
 * signals").
 */
export function pickChanges(
  signals: readonly Signal[],
  hidden: ReadonlySet<string>,
): { items: Signal[]; total: number; small: number } {
  const shown = signals.filter((signal) => !hidden.has(SIGNAL_SECTIONS[signal.category]));
  const big = shown
    .filter((signal) => signal.impact in IMPACT_RANK)
    .sort(
      (a, b) =>
        IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] ||
        Math.abs(b.changeValue ?? 0) - Math.abs(a.changeValue ?? 0) ||
        Date.parse(b.lastDetectedAt) - Date.parse(a.lastDetectedAt),
    );
  const rows = new Set<string>();
  for (const signal of big) {
    if (rows.size === SINCE_MAX) break;
    rows.add(signal.kind);
  }
  return {
    items: big.filter((signal) => rows.has(signal.kind)),
    total: big.length,
    small: shown.length - big.length,
  };
}

/** One row of Since yesterday: a change, or several of one kind. */
export interface ChangeGroup {
  kind: string;
  /** Biggest first; the first is the row's when it is alone. */
  signals: Signal[];
  /** The actions they added, each once, in their order. */
  actionIds: string[];
}

/**
 * The listed changes as rows (AC-06): one per signal kind, in the order the
 * first of each kind is listed, so five near-identical lines read as one.
 */
export function groupChanges(items: readonly Signal[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const signal of items) {
    const group = groups.get(signal.kind) ?? { kind: signal.kind, signals: [], actionIds: [] };
    group.signals.push(signal);
    if (signal.actionId && !group.actionIds.includes(signal.actionId)) {
      group.actionIds.push(signal.actionId);
    }
    groups.set(signal.kind, group);
  }
  return [...groups.values()];
}

/**
 * Signal kinds whose group has a line of its own ("5 rivals are mentioned
 * far more than you"); the others read "<first change> and 4 similar changes".
 */
export const GROUP_TITLE_KINDS: readonly string[] = [
  'competitor_leads',
  'competitor_momentum',
  'competitor_surge',
  'competitor_crossed',
  'competitor_overtaken',
];

/** The largest move of a competitor since the run before, in points; 0 with none. */
export function largestRivalMove(competitors: readonly { change: number | null }[]): number {
  return competitors.reduce((max, c) => Math.max(max, Math.abs(c.change ?? 0)), 0);
}

/**
 * A change's line as a sentence, so "An action was added." reads as the
 * next one: a period after it unless it already ends with one, "!" or "?".
 * Signal titles are headlines and mostly have none.
 */
export function asSentence(text: string): string {
  const line = text.trimEnd();
  return /[.!?]$/.test(line) ? line : `${line}.`;
}
