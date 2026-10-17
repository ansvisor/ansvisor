/**
 * Site Audit's Opportunities inbox (SA-004): the brand's pages worth auditing,
 * each with why. Pure, so the route only reads rows and this decides what
 * they add up to.
 *
 * Sources in this version:
 * - Google Analytics: page_opportunities' open "no AI traffic" pages,
 *   valuable pages AI engines send no visitors to (refreshed nightly).
 * - Site pages (site_pages: the sitemap, GA and cited pages): pages never
 *   audited, or whose last audit is older than auditMaxAgeDays.
 * - Citations: prompts where a competitor is cited and the brand never is
 *   (audit_competitor_cited_prompts), each through the brand page closest
 *   to it (the prompt's target URL, else the best site_pages match).
 *
 * Pinned pages always show, first. Excluded pages are left out of the rows
 * and listed apart, so they can be put back.
 */

import { isExcludedPath } from '../page-paths.js';
import { candidatePages } from '../page-matching.js';
import { pageKey } from './history.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One key per page across GA paths, site_pages URLs, audits and prefs: the
 * Pages list's key (host without www., path without a trailing slash),
 * lowercased, since GA lowercases its paths. Null for something that isn't a
 * URL.
 */
export function opportunityKey(url) {
  return pageKey(url)?.key.toLowerCase() ?? null;
}

const pathOf = (url) => pageKey(url)?.path ?? '/';

/**
 * The brand pages closest to the prompts a competitor is cited on and the
 * brand never is: the prompt's target URLs when it has any (a customer said
 * which page answers it), else the site page that best matches its text.
 * Prompts with no such page are left out: there is nothing to audit.
 *
 * @param {object} input
 * @param {Array<{ prompt_id: string, prompt_text: string, own_results: number|string, competitor_domains: string[] }>} input.prompts
 *   audit_competitor_cited_prompts rows
 * @param {Array<{ prompt_id: string, url: string }>} input.targetUrls  prompt_target_urls of those prompts
 * @param {Array<{ url: string, title?: string|null, h1?: string|null, description?: string|null }>} input.sitePages
 * @param {Map<string, string>} input.competitorNames  competitor host → name
 * @returns {Array<{ url: string, prompts: number, competitors: string[] }>}
 */
export function competitorGapPages({
  prompts = [],
  targetUrls = [],
  sitePages = [],
  competitorNames,
}) {
  const targets = new Map();
  for (const t of targetUrls) {
    if (!targets.has(t.prompt_id)) targets.set(t.prompt_id, []);
    targets.get(t.prompt_id).push(t.url);
  }
  const pages = new Map();
  for (const prompt of prompts) {
    if (Number(prompt.own_results) > 0) continue;
    const urls =
      targets.get(prompt.prompt_id) ??
      candidatePages(prompt.prompt_text, sitePages, 1).map((page) => page.url);
    for (const url of urls) {
      const key = opportunityKey(url);
      if (!key) continue;
      if (!pages.has(key)) pages.set(key, { url, prompts: new Set(), competitors: new Set() });
      const page = pages.get(key);
      page.prompts.add(prompt.prompt_id);
      for (const domain of prompt.competitor_domains ?? []) {
        page.competitors.add(competitorNames?.get(domain) ?? domain);
      }
    }
  }
  return [...pages.values()].map((page) => ({
    url: page.url,
    prompts: page.prompts.size,
    competitors: [...page.competitors].sort((a, b) => a.localeCompare(b)),
  }));
}

/**
 * @param {object} input
 * @param {string|null} input.primaryHost   the brand's primary host (normStoredDomain)
 * @param {Array<{ landing_page: string, value_signal: string, value_percentile: number|string, sessions: number, citation_state: string|null, citations: number|null }>} input.gaPages
 *   open page_opportunities rows (paths on the primary host)
 * @param {Array<{ url: string, title: string|null, ga_sessions: number|null, ai_citations: number|null }>} input.sitePages
 * @param {Array<{ key: string, url: string, score: number|null, auditId: string, lastAuditedAt: string, status: string }>} input.auditPages
 *   buildAuditPages output
 * @param {Array<{ url: string, prompts: number, competitors: string[] }>} [input.competitorPages]
 *   competitorGapPages output
 * @param {Array<{ page_key: string, url: string, state: 'pinned'|'excluded' }>} input.prefs
 * @param {number} input.staleDays   an audit older than this no longer counts
 * @param {number} [input.now]
 */
export function buildOpportunities({
  primaryHost,
  gaPages = [],
  sitePages = [],
  auditPages = [],
  competitorPages = [],
  prefs = [],
  staleDays,
  now = Date.now(),
}) {
  const audits = new Map(auditPages.map((p) => [p.key.toLowerCase(), p]));
  const prefsByKey = new Map(prefs.map((p) => [p.page_key, p]));
  const pages = new Map();

  const pageFor = (url) => {
    const key = opportunityKey(url);
    if (!key) return null;
    if (!pages.has(key)) {
      pages.set(key, {
        key,
        url,
        path: pathOf(url),
        title: null,
        reasons: [],
        pinned: false,
        sessions: null,
        citations: null,
      });
    }
    return pages.get(key);
  };

  if (primaryHost) {
    for (const row of gaPages) {
      const page = pageFor(`https://${primaryHost}${row.landing_page}`);
      if (!page) continue;
      page.reasons.push({
        type: 'no_ai_traffic',
        signal: row.value_signal,
        percentile: Number(row.value_percentile),
        citationState: row.citation_state ?? null,
      });
      page.sessions = row.sessions ?? page.sessions;
      page.citations = row.citations ?? page.citations;
    }
  }

  const staleBefore = now - staleDays * DAY_MS;
  for (const row of sitePages) {
    const key = opportunityKey(row.url);
    if (!key) continue;
    const audit = audits.get(key);
    const audited = audit && audit.score !== null;
    const stale = audited && Date.parse(audit.lastAuditedAt) < staleBefore;
    if (audited && !stale && !pages.has(key)) continue;
    const page = pageFor(row.url);
    page.title = row.title ?? page.title;
    page.sessions = page.sessions ?? row.ga_sessions ?? null;
    page.citations = page.citations ?? row.ai_citations ?? null;
    if (!audited) page.reasons.push({ type: 'never_audited' });
    else if (stale) {
      page.reasons.push({
        type: 'stale_audit',
        days: Math.floor((now - Date.parse(audit.lastAuditedAt)) / DAY_MS),
      });
    }
  }

  for (const gap of competitorPages) {
    const page = pageFor(gap.url);
    if (!page) continue;
    page.reasons.push({
      type: 'competitor_cited',
      prompts: gap.prompts,
      competitors: gap.competitors,
    });
  }

  for (const pref of prefs) {
    const page = pref.state === 'pinned' ? pageFor(pref.url) : null;
    if (page) page.pinned = true;
  }

  const rows = [];
  const excluded = [];
  for (const page of pages.values()) {
    const pref = prefsByKey.get(page.key);
    if (pref?.state === 'excluded') {
      excluded.push({ key: page.key, url: page.url, path: page.path, title: page.title });
      continue;
    }
    // Checkout, login, legal and the like carry no opportunity, unless a team pinned one.
    if (!page.pinned && isExcludedPath(page.path)) continue;
    if (!page.pinned && page.reasons.length === 0) continue;

    const audit = audits.get(page.key);
    rows.push({
      ...page,
      running: audit?.status === 'running',
      lastAudit:
        audit && audit.score !== null
          ? { at: audit.lastAuditedAt, score: audit.score, auditId: audit.auditId }
          : null,
    });
  }
  // Excluded pages the inbox no longer lists still show, to be put back.
  for (const pref of prefs) {
    if (pref.state === 'excluded' && !excluded.some((e) => e.key === pref.page_key)) {
      excluded.push({ key: pref.page_key, url: pref.url, path: pathOf(pref.url), title: null });
    }
  }

  rows.sort(compareOpportunities);
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  return { rows, excluded };
}

const gaPercentile = (row) => row.reasons.find((r) => r.type === 'no_ai_traffic')?.percentile ?? -1;
const neverAudited = (row) => row.reasons.some((r) => r.type === 'never_audited');
const competitorPrompts = (row) =>
  row.reasons.find((r) => r.type === 'competitor_cited')?.prompts ?? 0;

/**
 * Until the priority score (SA-005): pinned first, then GA's most valuable
 * pages without AI traffic, then the pages closest to the most prompts a
 * competitor wins, then pages never audited before stale ones, then the most
 * cited and visited.
 */
export function compareOpportunities(a, b) {
  return (
    Number(b.pinned) - Number(a.pinned) ||
    gaPercentile(b) - gaPercentile(a) ||
    competitorPrompts(b) - competitorPrompts(a) ||
    Number(neverAudited(b)) - Number(neverAudited(a)) ||
    (b.citations ?? 0) - (a.citations ?? 0) ||
    (b.sessions ?? 0) - (a.sessions ?? 0) ||
    a.path.localeCompare(b.path)
  );
}

/**
 * AI visits per page over the window, from ae_page_traffic_evidence: Google
 * Analytics where it has the page, else the tracking snippet, never both
 * added (the snippet counts the visits GA counts), as mergeTrafficPages does.
 *
 * @param {{ analytics?: Array<{ page: string, cur_sessions: number }>, snippet?: Array<{ page: string, cur_sessions: number }> }} evidence
 * @returns {Map<string, number>} by the page string the RPC was asked for
 */
export function aiVisitsByPage(evidence) {
  const sum = (rows) => {
    const totals = new Map();
    for (const r of rows ?? []) {
      if (!r.page) continue;
      totals.set(r.page, (totals.get(r.page) ?? 0) + Number(r.cur_sessions ?? 0));
    }
    return totals;
  };
  const visits = sum(evidence?.snippet);
  for (const [page, sessions] of sum(evidence?.analytics)) visits.set(page, sessions);
  return visits;
}
