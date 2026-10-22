import { formatCompactNumber } from '@/lib/format';
import type { PromptVolume } from '@/types';

/**
 * PROMPT-013: an estimated AI search volume is shown as a range with a
 * confidence, never as a bare number that reads as measured.
 *
 * A prompt's estimate is the median Google volume of its related keywords ×
 * the AI adoption rate (00154, 00155). How far it can be trusted follows from
 * those keywords: how many have Google search data, and how closely their
 * volumes agree. The range is the AI share of the lowest and highest of them,
 * kept within ½× to 2× of the estimate; with one keyword to go by, it is
 * exactly that.
 */

export type EstimateConfidence = 'high' | 'medium' | 'low';

export interface VolumeEstimate {
  /** The stored point estimate: what sorting and totals add up. */
  value: number;
  low: number;
  high: number;
  confidence: EstimateConfidence;
  /** Keywords with Google search data, out of `keywords`. */
  measured: number;
  keywords: number;
  /** The AI adoption rate the estimate used (0.45 = 45%). */
  rate: number;
  /** When the Google volumes were fetched; the latest one for a total. */
  asOf: string | null;
  /** Fetched long enough ago to count one level less. */
  stale: boolean;
}

/** High: at least this many keywords with data, the largest at most AGREE_HIGH × the smallest. */
const HIGH_MIN_MEASURED = 3;
const AGREE_HIGH = 3;
/** Medium: at least two, the largest at most AGREE_MEDIUM × the smallest. */
const AGREE_MEDIUM = 10;
/** Volumes this old count one level less. */
export const STALE_DAYS = 183;
/** The range never strays further than this factor from the estimate (the whole range with one keyword)… */
const MAX_STRETCH = 2;
/** …and is always at least this wide either side of it. */
const MIN_BAND = 0.25;

const LEVELS: EstimateConfidence[] = ['low', 'medium', 'high'];

/** Rounds to two significant figures, down or up: 396 → 390, 1,980 → 2,000. */
function roundTo2(value: number, direction: 'down' | 'up'): number {
  if (value <= 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1);
  return (direction === 'down' ? Math.floor(value / step) : Math.ceil(value / step)) * step;
}

/** The range around `value`: [low, high] stretched to the rules above, then rounded outwards. */
function bounds(value: number, low: number, high: number): { low: number; high: number } {
  if (value <= 0) return { low: 0, high: 0 };
  const lo = Math.min(Math.max(low, value / MAX_STRETCH), value * (1 - MIN_BAND));
  const hi = Math.max(Math.min(high, value * MAX_STRETCH), value * (1 + MIN_BAND));
  return { low: roundTo2(lo, 'down'), high: roundTo2(hi, 'up') };
}

type VolumeRow = Pick<
  PromptVolume,
  'estAiVolume' | 'googleVolumes' | 'aiVolumeMultiplier' | 'keywords' | 'fetchedAt'
>;

/** One prompt's estimate, from its keywords' Google volumes. */
export function promptVolumeEstimate(row: VolumeRow, now: Date = new Date()): VolumeEstimate {
  const value = Math.max(0, row.estAiVolume);
  const volumes = Object.values(row.googleVolumes ?? {}).filter((v) => v > 0);
  const measured = volumes.length;
  const smallest = Math.min(...volumes);
  const largest = Math.max(...volumes);
  const spread = measured > 0 ? largest / smallest : Infinity;

  let level =
    measured >= HIGH_MIN_MEASURED && spread <= AGREE_HIGH
      ? 2
      : measured >= 2 && spread <= AGREE_MEDIUM
        ? 1
        : 0;
  const fetched = row.fetchedAt ? Date.parse(row.fetchedAt) : NaN;
  const stale =
    Number.isFinite(fetched) && now.getTime() - fetched > STALE_DAYS * 24 * 60 * 60 * 1000;
  if (stale) level = Math.max(0, level - 1);
  if (value === 0) level = 0;

  const range =
    measured >= 2
      ? bounds(value, smallest * row.aiVolumeMultiplier, largest * row.aiVolumeMultiplier)
      : bounds(value, value / MAX_STRETCH, value * MAX_STRETCH);

  return {
    value,
    ...range,
    confidence: LEVELS[level],
    measured,
    keywords: Math.max(row.keywords?.length ?? 0, Object.keys(row.googleVolumes ?? {}).length),
    rate: row.aiVolumeMultiplier,
    asOf: row.fetchedAt ?? null,
    stale,
  };
}

export interface EstimateTotal extends VolumeEstimate {
  /** How many prompts were added up, and at each confidence. */
  count: number;
  byConfidence: Record<EstimateConfidence, number>;
}

/**
 * Prompts added up: the lows and the highs summed. High when at least 80% of
 * the volume is from high-confidence prompts, low when more than half is from
 * low-confidence ones, medium in between.
 */
export function sumEstimates(estimates: VolumeEstimate[]): EstimateTotal {
  const byConfidence: Record<EstimateConfidence, number> = { high: 0, medium: 0, low: 0 };
  const volumeAt: Record<EstimateConfidence, number> = { high: 0, medium: 0, low: 0 };
  let value = 0;
  let low = 0;
  let high = 0;
  let asOf: string | null = null;
  for (const e of estimates) {
    byConfidence[e.confidence] += 1;
    volumeAt[e.confidence] += e.value;
    value += e.value;
    low += e.low;
    high += e.high;
    if (e.asOf && (!asOf || Date.parse(e.asOf) > Date.parse(asOf))) asOf = e.asOf;
  }
  const confidence: EstimateConfidence =
    value <= 0
      ? 'low'
      : volumeAt.high / value >= 0.8
        ? 'high'
        : volumeAt.low / value > 0.5
          ? 'low'
          : 'medium';
  return {
    value,
    low,
    high,
    confidence,
    measured: estimates.reduce((s, e) => s + e.measured, 0),
    keywords: estimates.reduce((s, e) => s + e.keywords, 0),
    rate: estimates[0]?.rate ?? 0,
    asOf,
    stale: estimates.some((e) => e.stale),
    count: estimates.length,
    byConfidence,
  };
}

/** An estimate's average per prompt: the total's range and value divided by its count. */
export function averageEstimate(total: EstimateTotal): EstimateTotal {
  const n = Math.max(1, total.count);
  return {
    ...total,
    value: Math.round(total.value / n),
    low: roundTo2(total.low / n, 'down'),
    high: roundTo2(total.high / n, 'up'),
  };
}

/** "400–2k", "1–3k", "1.2–4.5M"; "0" when there's nothing to estimate. */
export function formatEstimateRange(estimate: Pick<VolumeEstimate, 'low' | 'high'>): string {
  if (estimate.high <= 0) return '0';
  const low = formatCompactNumber(estimate.low);
  const high = formatCompactNumber(estimate.high);
  if (low === high) return high;
  const unit = /[kMB]$/.exec(high)?.[0];
  if (unit && low.endsWith(unit)) return `${low.slice(0, -1)}–${high}`;
  return `${low}–${high}`;
}

/**
 * An estimate isn't ranked on its own when its confidence is low: lists and
 * sorts that go by volume put it after the rest, and it earns no Opportunity
 * level by itself.
 */
export function rankable(estimate: Pick<VolumeEstimate, 'confidence'>): boolean {
  return estimate.confidence !== 'low';
}
