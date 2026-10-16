import { computeAiVisibilityScore } from '@/lib/visibility-score';

/**
 * The Insights summary line (VIS-006): the brand's rank and the gap to its
 * neighbour, and the platforms that moved Visibility most. A fixed template
 * over numbers the page already shows, no AI call.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** One row of insights_platform_compare[_daily] (00132). */
export interface PlatformRow {
  model_used: string | null;
  platform: string | null;
  win: 'cur' | 'prev';
  answers: number;
  mention_answers: number;
  citation_answers: number;
  sum_inv_position: number | null;
  position_count: number;
}

/** A platform's Visibility in both windows. */
export interface PlatformChange {
  name: string;
  cur: number;
  prev: number;
  change: number;
}

const num = (v: unknown): number => Number(v ?? 0);

/**
 * The RPC payload, or null when it can't be used: missing, or read from
 * rollup rows not yet backfilled (00130) — the summary then names no
 * platform rather than one picked from partial data.
 */
export function parsePlatformRows(raw: unknown): PlatformRow[] | null {
  const r = raw as { complete?: boolean; platforms?: Record<string, unknown>[] } | null;
  if (!r || r.complete !== true) return null;
  return (r.platforms ?? []).map((p) => ({
    model_used: (p.model_used as string | null) ?? null,
    platform: (p.platform as string | null) ?? null,
    win: p.win === 'prev' ? 'prev' : 'cur',
    answers: num(p.answers),
    mention_answers: num(p.mention_answers),
    citation_answers: num(p.citation_answers),
    sum_inv_position:
      p.sum_inv_position === null || p.sum_inv_position === undefined
        ? null
        : num(p.sum_inv_position),
    position_count: num(p.position_count),
  }));
}

interface Sums {
  answers: number;
  mentions: number;
  citations: number;
  invPosition: number;
  positions: number;
}

const score = (s: Sums) =>
  computeAiVisibilityScore({
    answers: s.answers,
    mentionAnswers: s.mentions,
    citationAnswers: s.citations,
    positionFactor: s.positions > 0 ? s.invPosition / s.positions : null,
  });

/**
 * Each platform's Visibility change, with model slugs folded into their
 * platform the way "Share of Voice by Platform" names them. Only platforms
 * answered in both windows; biggest rise first.
 */
export function platformChanges(
  rows: PlatformRow[],
  platformOf: (modelUsed: string | null, platform: string | null) => string,
): PlatformChange[] {
  const sums = new Map<string, { cur: Sums; prev: Sums }>();
  const empty = (): Sums => ({
    answers: 0,
    mentions: 0,
    citations: 0,
    invPosition: 0,
    positions: 0,
  });
  for (const r of rows) {
    const name = platformOf(r.model_used, r.platform);
    const entry = sums.get(name) ?? { cur: empty(), prev: empty() };
    const s = entry[r.win];
    s.answers += r.answers;
    s.mentions += r.mention_answers;
    s.citations += r.citation_answers;
    s.invPosition += r.sum_inv_position ?? 0;
    s.positions += r.position_count;
    sums.set(name, entry);
  }

  const out: PlatformChange[] = [];
  for (const [name, { cur, prev }] of sums) {
    const c = score(cur);
    const p = score(prev);
    if (c === null || p === null) continue;
    out.push({ name, cur: c, prev: p, change: round1(c - p) });
  }
  return out.sort((a, b) => b.change - a.change || a.name.localeCompare(b.name));
}

/** The platform that rose most and the one that fell most; null when none moved that way. */
export function platformMovers(changes: PlatformChange[]): {
  up: PlatformChange | null;
  down: PlatformChange | null;
} {
  const up = changes.find((c) => c.change > 0) ?? null;
  const falling = changes.filter((c) => c.change < 0);
  return { up, down: falling.length > 0 ? falling[falling.length - 1] : null };
}

export interface RankSummary {
  rank: number;
  count: number;
  /** The brand directly ahead, or, when first, the runner-up. */
  neighbour: { name: string; gap: number; side: 'behind' | 'ahead' | 'tied' };
}

/** The brand's place on the leaderboard (brands sorted by score, as shown). */
export function rankSummary(
  brands: { name: string; score: number | null; isOwnBrand: boolean }[],
): RankSummary | null {
  const i = brands.findIndex((b) => b.isOwnBrand);
  if (i < 0 || brands.length < 2) return null;
  const own = brands[i].score ?? 0;
  const other = i > 0 ? brands[i - 1] : brands[1];
  const gap = round1(Math.abs((other.score ?? 0) - own));
  return {
    rank: i + 1,
    count: brands.length,
    neighbour: { name: other.name, gap, side: gap === 0 ? 'tied' : i > 0 ? 'behind' : 'ahead' },
  };
}
