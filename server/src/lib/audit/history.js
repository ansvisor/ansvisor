/**
 * Pure helpers for the Site Audit history reads (hub trend chart and the
 * Recent audits list), kept out of the route so they can be unit tested.
 */

import { normHost } from './host.js';

/** How many recent completed audits the trend endpoint reads. */
export const TREND_LIMIT = 500;

/** Default / maximum page size of the Recent audits list. */
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 100;

function toInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * Parse `limit` / `offset` query params for the audit list. Missing or invalid
 * values fall back to the first page of LIST_DEFAULT_LIMIT, so callers that
 * pass neither keep the old "newest 50" behaviour.
 */
export function parseListPage(query = {}) {
  const limit = toInt(query.limit);
  const offset = toInt(query.offset);
  return {
    limit: limit !== null && limit > 0 ? Math.min(limit, LIST_MAX_LIMIT) : LIST_DEFAULT_LIMIT,
    offset: offset !== null && offset > 0 ? offset : 0,
  };
}

/**
 * Turn completed audit rows read NEWEST first into the chart's points: keep
 * only audits of the primary domain (host of final_url, else url) and return
 * them oldest → newest so the chart ends at the latest audit.
 */
export function buildTrendPoints(rowsNewestFirst, primaryHost) {
  if (!primaryHost) return [];
  return (rowsNewestFirst ?? [])
    .filter((r) => (normHost(r.final_url) ?? normHost(r.url)) === primaryHost)
    .map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      totalScore: r.total_score === null ? null : Number(r.total_score),
      categoryScores: r.category_scores ?? {},
    }))
    .reverse();
}
