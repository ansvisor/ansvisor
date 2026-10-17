/**
 * Pure helpers for the Site Audit history reads (hub trend chart, the Pages
 * list and the raw audit list), kept out of the route so they can be unit
 * tested.
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

/** Score at or above which a page reads as Good (70/100). */
export const GOOD_SCORE = 0.7;

/** Completed scores drawn in a page's trend line, newest last. */
export const PAGE_TREND_POINTS = 10;

/** Runs listed under a page's history. */
export const PAGE_HISTORY_LIMIT = 50;

/**
 * One key per page, so repeat audits of it share a row: the host without
 * www. and the path without a trailing slash. Query and fragment are ignored.
 * Null for something that isn't a URL.
 */
export function pageKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return { key: `${host}${path}`, host, path };
  } catch {
    return null;
  }
}

const points = (score) => Math.round(score * 100);

/**
 * A page's status from its runs (newest first) and its two latest completed
 * audits: Running while a run is in progress, Failed when none ever
 * completed, Good from 70, Improving below 70 when at least a point above the
 * previous audit, and Needs work otherwise.
 */
export function pageStatus(latestRun, current, previous) {
  if (latestRun?.status === 'running') return 'running';
  if (!current) return 'failed';
  if (current.totalScore >= GOOD_SCORE) return 'good';
  if (previous && points(current.totalScore) > points(previous.totalScore)) return 'improving';
  return 'needs_work';
}

/**
 * Group audit rows read NEWEST first into one entry per page (pageKey of
 * final_url, else url), most recently audited page first. Each page carries
 * its latest completed score and audit, the one before it, a status, its
 * trend and its runs.
 */
export function buildAuditPages(rowsNewestFirst) {
  const groups = new Map();
  // Rows read in slices can repeat one at a slice boundary.
  const seen = new Set();
  for (const r of rowsNewestFirst ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const url = r.final_url ?? r.url;
    const page = pageKey(url) ?? { key: url, host: null, path: url };
    if (!groups.has(page.key)) groups.set(page.key, { ...page, runs: [] });
    groups.get(page.key).runs.push({
      id: r.id,
      url,
      status: r.status,
      totalScore: r.total_score === null ? null : Number(r.total_score),
      createdAt: r.created_at,
    });
  }

  return [...groups.values()].map(({ key, host, path, runs }) => {
    const completed = runs.filter((r) => r.status === 'completed' && r.totalScore !== null);
    const latest = runs[0];
    const current = completed[0] ?? null;
    const previous = completed[1] ?? null;
    return {
      key,
      host,
      path,
      url: (current ?? latest).url,
      auditId: (current ?? latest).id,
      score: current?.totalScore ?? null,
      previousScore: previous?.totalScore ?? null,
      status: pageStatus(latest, current, previous),
      lastAuditedAt: (current ?? latest).createdAt,
      trend: completed
        .slice(0, PAGE_TREND_POINTS)
        .map((r) => r.totalScore)
        .reverse(),
      runs: runs.slice(0, PAGE_HISTORY_LIMIT),
      runCount: runs.length,
    };
  });
}
