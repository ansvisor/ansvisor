import { changeSe } from './why/explain';

/**
 * Chat Home's "Since you left" (CHAT-22 §1, mockup #s-home `.since`): the
 * brand's citations per engine from the day the person last left Home to
 * yesterday, against as many days before, from the tracking counts Why did
 * it move reads (chat_why_cells, 00423). The engine whose citations fell
 * most and the one whose rose most, each only when its citation rate moved
 * beyond normal swing as Why counts it, so fewer runs alone isn't a drop.
 * UTC days, as the counts keep them. Pure.
 */

/** Days "Since you left" counts at most, however long the person was away. */
export const SINCE_MAX_DAYS = 30;

const DAY_MS = 86_400_000;

export interface SincePeriods {
  a: { from: string; to: string };
  b: { from: string; to: string };
}

export interface SinceMove {
  /** The engine as the tracking counts name it (a model or platform slug). */
  engine: string;
  /** Answers citing the brand's pages, in the days before and since. */
  before: number;
  now: number;
}

export interface SinceYouLeft {
  /** The first day counted, YYYY-MM-DD. */
  from: string;
  /** When the person last left Home. */
  seenAt: string;
  drop: SinceMove | null;
  win: SinceMove | null;
}

/** One engine's counts in a period, as chat_why_cells gives them per prompt and location. */
export interface SinceCell {
  engine: string;
  period: 'a' | 'b';
  answers: number;
  citationAnswers: number;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * From the day Home was last left (at most SINCE_MAX_DAYS back) to
 * yesterday, and as many days just before it; null until a whole day has
 * passed since, or for a time that isn't one.
 */
export function sincePeriods(seenAt: string, now: number): SincePeriods | null {
  const seen = Date.parse(seenAt);
  if (Number.isNaN(seen)) return null;
  const today = Date.parse(dayOf(now));
  const to = today - DAY_MS;
  const from = Math.max(Date.parse(dayOf(seen)), today - SINCE_MAX_DAYS * DAY_MS);
  if (from > to) return null;
  const days = (to - from) / DAY_MS + 1;
  return {
    a: { from: dayOf(from - days * DAY_MS), to: dayOf(from - DAY_MS) },
    b: { from: dayOf(from), to: dayOf(to) },
  };
}

/** The biggest drop and the biggest win in citations, by engine; null for either without one. */
export function sinceMoves(cells: SinceCell[]): Pick<SinceYouLeft, 'drop' | 'win'> {
  const engines = new Map<string, Record<'a' | 'b', { num: number; den: number }>>();
  for (const cell of cells) {
    const counts = engines.get(cell.engine) ?? { a: { num: 0, den: 0 }, b: { num: 0, den: 0 } };
    counts[cell.period].num += cell.citationAnswers;
    counts[cell.period].den += cell.answers;
    engines.set(cell.engine, counts);
  }
  let drop: SinceMove | null = null;
  let win: SinceMove | null = null;
  for (const [engine, { a, b }] of engines) {
    // Tracked in both periods: an engine added or dropped isn't a move.
    if (a.den <= 0 || b.den <= 0) continue;
    const se = changeSe('citations', [a], [b]);
    const rate = (b.num / b.den - a.num / a.den) * 100;
    if (se === null || Math.abs(rate) <= 2 * se) continue;
    const delta = b.num - a.num;
    const move = { engine, before: a.num, now: b.num };
    if (rate < 0 && delta < 0 && (!drop || delta < drop.now - drop.before)) drop = move;
    if (rate > 0 && delta > 0 && (!win || delta > win.now - win.before)) win = move;
  }
  return { drop, win };
}
