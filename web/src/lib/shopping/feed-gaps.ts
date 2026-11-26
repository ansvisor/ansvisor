import {
  FIRST_WORDS,
  READINESS_CHECKS,
  readiness,
  type CatalogProductRow,
  type ReadinessCheck,
} from './products';

/**
 * What a brand's product feed is missing for AI shopping answers, the whole
 * catalog at once (the Shopping Feed Advisor agent's read): for each of
 * Product Visibility's readiness checks (products.ts READINESS_CHECKS), how
 * many live products miss it and a few of them, ordered by impact: the
 * readiness points the catalog loses on it (what the check is worth × the
 * products that miss it). Worked out from the catalog alone, as each
 * product's readiness is, so it says nothing about AI answers themselves.
 */

/** Products named for each gap, as examples. */
export const FEED_GAP_EXAMPLES = 5;

/** A product a gap names: enough to find and fix it. */
export interface FeedGapProduct {
  id: string;
  title: string;
  url: string | null;
}

export interface FeedGap {
  /** The readiness check (gtin, image, inStock, price, description, typeFirst, category, brand). */
  check: ReadinessCheck;
  /** What the check is worth in a product's readiness, of 100. */
  points: number;
  /** Live products that miss it. */
  missing: number;
  /** Their share of the products read, 0–1. */
  share: number;
  /** Readiness points lost across the catalog: points × missing. The gaps' order. */
  impact: number;
  /** The first FEED_GAP_EXAMPLES products that miss it, by title. */
  examples: FeedGapProduct[];
}

export interface FeedGaps {
  /** Live products read. */
  products: number;
  /** The catalog has more live products than one read takes: the counts cover `products`. */
  capped: boolean;
  /** The catalog's average readiness, 0–100; null without products. */
  average_readiness: number | null;
  /** Products that miss no check. */
  complete: number;
  /** Each check some product misses, the most readiness lost first. */
  gaps: FeedGap[];
  /**
   * Products whose type is unknown (no product type or category), so whether
   * their description names it in its first words can't be checked.
   */
  type_unknown: number;
  /** Description words: the median, and how many products have none at all. */
  description_words: { median: number | null; empty: number };
  /** The words of a description AI shopping reads first, as the typeFirst check counts them. */
  first_words: number;
}

const wordCount = (text: string | null) =>
  String(text ?? '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean).length;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** The feed's gaps, from its live products as Product Visibility reads them. */
export function feedGaps(products: readonly CatalogProductRow[], capped = false): FeedGaps {
  const byTitle = [...products].sort(
    (a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1),
  );
  const checks = Object.keys(READINESS_CHECKS) as ReadinessCheck[];
  const missedBy = new Map<ReadinessCheck, CatalogProductRow[]>(checks.map((c) => [c, []]));
  let scoreSum = 0;
  let complete = 0;
  let typeUnknown = 0;
  const words: number[] = [];
  for (const product of byTitle) {
    const read = readiness(product);
    scoreSum += read.score;
    if (!read.missing.length) complete += 1;
    if (read.unknown.includes('typeFirst')) typeUnknown += 1;
    for (const check of read.missing) missedBy.get(check)!.push(product);
    words.push(wordCount(product.description));
  }
  const total = byTitle.length;
  const gaps = checks
    .map((check) => {
      const missed = missedBy.get(check)!;
      const points = READINESS_CHECKS[check];
      return {
        check,
        points,
        missing: missed.length,
        share: total ? Math.round((1000 * missed.length) / total) / 1000 : 0,
        impact: points * missed.length,
        examples: missed
          .slice(0, FEED_GAP_EXAMPLES)
          .map(({ id, title, url }) => ({ id, title, url })),
      };
    })
    .filter((gap) => gap.missing > 0)
    // The most points lost first; on a tie, the check worth more, then the checks' own order.
    .sort((a, b) => b.impact - a.impact || b.points - a.points);
  return {
    products: total,
    capped,
    average_readiness: total ? Math.round(scoreSum / total) : null,
    complete,
    gaps,
    type_unknown: typeUnknown,
    description_words: { median: median(words), empty: words.filter((n) => n === 0).length },
    first_words: FIRST_WORDS,
  };
}
