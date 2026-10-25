import { z } from 'zod';

/**
 * Quality's weights against AI citations (Content Editor Quality spec §11,
 * Phase 3, CE-055): "check whether pages with higher scores get more AI
 * citations … Adjust the weights from the result. Until then, the
 * 'Ansvisor estimate' label stays."
 *
 * It reads rows a maintainer exports, one page each: its type's profile,
 * each check's share of its points (0–1) by score, and the AI citations the
 * page got over the same window. It gives back aggregates only: per profile
 * and check, how many pages had the check and the rank correlation
 * (Spearman's rho) between its share and the citations; and, given the
 * weights in use, the ones the correlations suggest. Nothing here reads a
 * database or the network, and nothing of a page (its URL, its brand) is
 * read from a row or kept in what it returns: a row's other fields are
 * dropped.
 */

export const QUALITY_PROFILES = ['article', 'product', 'category', 'feature', 'comparison'];
export const QUALITY_SCORES = ['eeat', 'trust', 'readability'];

/** The fewest pages a check's correlation is read from: fewer say nothing. */
export const MIN_PAGES = 30;

const shares = z.record(z.string().min(1).max(40), z.number().min(0).max(1));

/** One page's row: its profile, its checks' shares by score, its AI citations. */
export const calibrationRow = z.object({
  profile: z.enum(QUALITY_PROFILES),
  checks: z.object({
    eeat: shares.optional(),
    trust: shares.optional(),
    readability: shares.optional(),
  }),
  citations: z.number().int().min(0),
});

/**
 * The rows of a JSON-lines text: each line a page's row; a blank line is
 * skipped, and a line that isn't one is counted, never kept or printed.
 */
export function parseRows(text) {
  const rows = [];
  let invalid = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      invalid += 1;
      continue;
    }
    const row = calibrationRow.safeParse(value);
    if (row.success) rows.push(row.data);
    else invalid += 1;
  }
  return { rows, invalid };
}

/** Each value's rank, 1 for the smallest, ties sharing their average rank. */
export function ranks(values) {
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const out = new Array(values.length);
  for (let start = 0; start < order.length; ) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].value === order[start].value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) out[order[k].i] = rank;
    start = end + 1;
  }
  return out;
}

/**
 * Spearman's rank correlation of two equal-length lists: -1 to 1, rounded
 * to three places; null below three pairs, or when either list is all one
 * value (it says nothing about the other).
 */
export function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (rx.length + 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    cov += (rx[i] - mean) * (ry[i] - mean);
    vx += (rx[i] - mean) ** 2;
    vy += (ry[i] - mean) ** 2;
  }
  if (vx === 0 || vy === 0) return null;
  return Math.round((cov / Math.sqrt(vx * vy)) * 1000) / 1000;
}

/**
 * Integer points that add up to `total`, as near as can be to the shares
 * given (the largest remainders round up).
 */
function toPoints(shares, total) {
  const keys = Object.keys(shares);
  const sum = keys.reduce((s, k) => s + shares[k], 0);
  if (!keys.length || sum <= 0) return Object.fromEntries(keys.map((k) => [k, 0]));
  const exact = keys.map((k) => ({ k, v: (shares[k] / sum) * total }));
  const out = Object.fromEntries(exact.map(({ k, v }) => [k, Math.floor(v)]));
  let left = total - exact.reduce((s, { k }) => s + out[k], 0);
  for (const { k } of [...exact].sort((a, b) => (b.v % 1) - (a.v % 1))) {
    if (left <= 0) break;
    out[k] += 1;
    left -= 1;
  }
  return out;
}

/**
 * A score's weights as its checks' correlations suggest: the points of the
 * checks read from enough pages are shared among them by their positive
 * correlation (one that goes with fewer citations gets none); a check not
 * read enough keeps its points. The score's total stays as it was. With no
 * positive correlation among them, the weights stay as they are.
 */
export function suggestWeights(current, stats) {
  const read = Object.keys(current).filter(
    (check) => current[check] > 0 && stats[check] && stats[check].rho !== null,
  );
  const positive = Object.fromEntries(read.map((c) => [c, Math.max(0, stats[c].rho)]));
  if (!read.length || Object.values(positive).every((rho) => rho === 0)) return { ...current };
  const budget = read.reduce((sum, c) => sum + current[c], 0);
  return { ...current, ...toPoints(positive, budget) };
}

/**
 * The calibration: per profile, its pages, and per score and check, the
 * pages with it and its correlation with the citations (null when fewer
 * than `minPages` pages had it); with the weights in use (as
 * PROFILE_WEIGHTS gives them: profile → score → check → points), the ones
 * suggested.
 */
export function calibrate(rows, { minPages = MIN_PAGES, weights = null } = {}) {
  const profiles = {};
  for (const profile of QUALITY_PROFILES) {
    const pages = rows.filter((row) => row.profile === profile);
    if (!pages.length) continue;
    const scores = {};
    for (const score of QUALITY_SCORES) {
      const checks = new Set(pages.flatMap((row) => Object.keys(row.checks[score] ?? {})));
      const stats = {};
      for (const check of [...checks].sort()) {
        const pairs = pages.filter((row) => row.checks[score]?.[check] !== undefined);
        stats[check] = {
          pages: pairs.length,
          rho:
            pairs.length >= minPages
              ? spearman(
                  pairs.map((row) => row.checks[score][check]),
                  pairs.map((row) => row.citations),
                )
              : null,
        };
      }
      const current = weights?.[profile]?.[score] ?? null;
      scores[score] = {
        checks: stats,
        ...(current ? { suggested: suggestWeights(current, stats) } : {}),
      };
    }
    profiles[profile] = { pages: pages.length, scores };
  }
  return { pages: rows.length, minPages, profiles };
}
