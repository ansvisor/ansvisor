import { computeAiVisibilityScore } from '@/lib/visibility-score';
import { coverage } from '@/lib/insights-kpis';

/**
 * The Insights summary line (VIS-006): the brand's rank and the gap to its
 * neighbour, and the platforms that moved Visibility most. A fixed template
 * over numbers the page already shows, no AI call.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** One row of insights_platform_compare[_daily] (00132, 00133). */
export interface PlatformRow {
  model_used: string | null;
  platform: string | null;
  win: 'cur' | 'prev';
  answers: number;
  mention_answers: number;
  citation_answers: number;
  sum_inv_position: number | null;
  position_count: number;
  /** 00133: for the platform table's Avg. position. */
  sum_position: number | null;
  /**
   * 00133, current window only: the prompts answered on this engine and the
   * ones where the brand appeared, for the platform table's Coverage.
   */
  visible_prompt_ids: string[];
  active_prompt_ids: string[];
}

/** A platform's Visibility in both windows. */
export interface PlatformChange {
  name: string;
  cur: number;
  prev: number;
  change: number;
}

const num = (v: unknown): number => Number(v ?? 0);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

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
    sum_position:
      p.sum_position === null || p.sum_position === undefined ? null : num(p.sum_position),
    visible_prompt_ids: ids(p.visible_prompt_ids),
    active_prompt_ids: ids(p.active_prompt_ids),
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

/** Fewer answers than this and a platform's numbers aren't shown (spec v2: "Low sample"). */
export const LOW_SAMPLE_ANSWERS = 20;

/**
 * Each platform's Visibility change, with model slugs folded into their
 * platform (`platformOf`). Only platforms with at least LOW_SAMPLE_ANSWERS
 * answers in both windows, so a swing over a handful of answers is never
 * named; biggest rise first.
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
    if (cur.answers < LOW_SAMPLE_ANSWERS || prev.answers < LOW_SAMPLE_ANSWERS) continue;
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

// ─── By AI platform table (VIS-008) ─────────────────────────────────────────

export interface PlatformTableRow {
  name: string;
  /** 'noRuns': no answers this period; 'lowSample': too few to show rates. */
  status: 'ok' | 'lowSample' | 'noRuns';
  /** Answers this period. */
  runs: number;
  visibility: number | null;
  /** Visibility change, following Same prompts; null without one. */
  change: number | null;
  /** % of the prompts answered on the platform where the brand appeared. */
  coverage: number | null;
  shareOfVoice: number | null;
  avgPosition: number | null;
  /** The row with the biggest drop, tinted in the table. */
  worst: boolean;
}

/**
 * The "By AI platform" rows: each platform's values over every prompt in
 * the current window, its change (the same numbers the summary line's movers
 * use) and its share of voice. Platforms answered only in the previous
 * window read "No runs this period", never 0%. Sorted by Visibility, then the
 * low-sample ones, then the ones without runs.
 */
export function platformTable(
  rows: PlatformRow[],
  changes: PlatformChange[],
  shareOfVoice: { provider: string; sov: number }[],
  platformOf: (modelUsed: string | null, platform: string | null) => string,
): PlatformTableRow[] {
  const cur = new Map<
    string,
    Sums & { sumPosition: number; visible: Set<string>; active: Set<string> }
  >();
  const seen = new Set<string>();
  for (const r of rows) {
    const name = platformOf(r.model_used, r.platform);
    seen.add(name);
    if (r.win !== 'cur') continue;
    const s = cur.get(name) ?? {
      answers: 0,
      mentions: 0,
      citations: 0,
      invPosition: 0,
      positions: 0,
      sumPosition: 0,
      visible: new Set<string>(),
      active: new Set<string>(),
    };
    s.answers += r.answers;
    s.mentions += r.mention_answers;
    s.citations += r.citation_answers;
    s.invPosition += r.sum_inv_position ?? 0;
    s.positions += r.position_count;
    s.sumPosition += r.sum_position ?? 0;
    // A prompt answered by two of the platform's engines counts once.
    r.visible_prompt_ids.forEach((id) => s.visible.add(id));
    r.active_prompt_ids.forEach((id) => s.active.add(id));
    cur.set(name, s);
  }

  const out: PlatformTableRow[] = [...seen].map((name) => {
    const s = cur.get(name);
    const runs = s?.answers ?? 0;
    const status = runs === 0 ? 'noRuns' : runs < LOW_SAMPLE_ANSWERS ? 'lowSample' : 'ok';
    const ok = status === 'ok' && s;
    return {
      name,
      status,
      runs,
      visibility: ok ? score(s) : null,
      change: ok ? (changes.find((c) => c.name === name)?.change ?? null) : null,
      coverage: ok ? coverage(s.visible.size, s.active.size) : null,
      shareOfVoice: ok ? (shareOfVoice.find((p) => p.provider === name)?.sov ?? null) : null,
      avgPosition: ok && s.positions > 0 ? round1(s.sumPosition / s.positions) : null,
      worst: false,
    };
  });

  const drops = out.filter((r) => r.change !== null && r.change < 0);
  if (drops.length > 0) {
    drops.reduce((a, b) => (b.change! < a.change! ? b : a)).worst = true;
  }

  const order = { ok: 0, lowSample: 1, noRuns: 2 };
  return out.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      (b.visibility ?? 0) - (a.visibility ?? 0) ||
      b.runs - a.runs ||
      a.name.localeCompare(b.name),
  );
}
