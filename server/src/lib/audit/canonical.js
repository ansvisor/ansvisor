import * as cheerio from 'cheerio';
import { PageFetchError, fetchPage } from '../safe-fetch.js';

/**
 * Whether a page's canonical tag points where it should (AC plan P-11,
 * spec §9): to the page itself, or to a page on the same site that answers
 * 200, isn't a redirect and isn't noindex. Site Audit reads the target once
 * when it isn't the page (context.js), with the free reader (safe-fetch,
 * never Scrape.do), and keeps what it found in the canonical signal's
 * evidence; the score stays the tag's presence (rubric). The nightly audits
 * family raises `canonical_issue` from it (F14), and the fix task's check
 * reads the page again the same way (task-checks.js).
 *
 * A target's state:
 *   - 'self': the page itself (its own address, a trailing slash or www aside);
 *   - 'ok': another page of the site, live and indexable;
 *   - 'invalid': no address can be made of it;
 *   - 'other_host': another site;
 *   - 'redirect': it redirects (to `to`);
 *   - 'noindex': it asks not to be indexed;
 *   - 'not_found': 404 or 410;
 *   - 'error_status': another error status (`status`);
 *   - 'unreadable': it couldn't be read (a timeout, a bot wall): no answer.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 512 * 1024;

/** The states that are an issue, and a missing tag. */
export const CANONICAL_ISSUES = Object.freeze([
  'missing',
  'invalid',
  'other_host',
  'redirect',
  'noindex',
  'not_found',
  'error_status',
]);

/** A page's canonical tag's href, trimmed; null for none. */
export function canonicalHref($) {
  const href = $('link[rel="canonical"]').first().attr('href');
  return typeof href === 'string' && href.trim() ? href.trim() : null;
}

/** An address as compared: its host without www, its path without a trailing slash, its query. */
export function canonicalKey(address) {
  try {
    const u = new URL(address);
    if (!/^https?:$/.test(u.protocol)) return null;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

const hostOf = (address) => new URL(address).hostname.replace(/^www\./, '').toLowerCase();

/** Whether a page asks not to be indexed (its robots meta tags). */
export function asksNoindex($) {
  return $('meta[name="robots"], meta[name="googlebot"]')
    .map((_, el) => String($(el).attr('content') ?? '').toLowerCase())
    .get()
    .some((content) => /\bnoindex\b/.test(content));
}

/**
 * Where a page's canonical tag points, read as above. Never throws.
 *
 * @param {string} pageUrl - the page's address, after its redirects
 * @param {string|null} href - its canonical tag's href (canonicalHref)
 * @returns {Promise<{ state: string, target?: string, to?: string, status?: number }|null>}
 *   null for a page with no tag
 */
export async function probeCanonical(pageUrl, href, { fetchImpl = fetchPage } = {}) {
  if (!href) return null;
  let target;
  try {
    target = new URL(href, pageUrl).href;
  } catch {
    return { state: 'invalid' };
  }
  const key = canonicalKey(target);
  if (!key) return { state: 'invalid' };
  if (key === canonicalKey(pageUrl)) return { state: 'self', target };
  if (hostOf(target) !== hostOf(pageUrl)) return { state: 'other_host', target };
  try {
    const page = await fetchImpl(target, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      truncate: true,
    });
    if (page.url && canonicalKey(page.url) !== key) {
      return { state: 'redirect', target, to: page.url };
    }
    if (page.status < 200 || page.status > 299) {
      return { state: 'error_status', target, status: page.status };
    }
    if (asksNoindex(cheerio.load(page.html ?? ''))) return { state: 'noindex', target };
    return { state: 'ok', target };
  } catch (err) {
    if (err instanceof PageFetchError && err.code === 'http_error') {
      if (err.status === 404 || err.status === 410) return { state: 'not_found', target };
      if (err.status >= 500) return { state: 'error_status', target, status: err.status };
    }
    return { state: 'unreadable', target };
  }
}

/**
 * probeCanonical for Site Audit, whose page comes through Scrape.do without
 * the address it ended on. A tag that isn't the requested address is
 * compared with the page's address after its redirects, read once with the
 * free reader: a page that redirected to another site and points to itself
 * there is 'self', not 'other_host'. When that address can't be read, a tag
 * on another site says nothing ('unreadable'). Never throws.
 *
 * @param {string} requestedUrl - the address Site Audit asked for
 * @param {string|null} href - the page's canonical tag's href (canonicalHref)
 */
export async function probeAuditCanonical(requestedUrl, href, { fetchImpl = fetchPage } = {}) {
  if (!href) return null;
  let target;
  try {
    target = new URL(href, requestedUrl).href;
  } catch {
    return { state: 'invalid' };
  }
  const key = canonicalKey(target);
  if (key && key === canonicalKey(requestedUrl)) return { state: 'self', target };

  let finalUrl = null;
  try {
    const page = await fetchImpl(requestedUrl, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      truncate: true,
    });
    finalUrl = page.url || requestedUrl;
  } catch {
    finalUrl = null;
  }
  if (finalUrl) return probeCanonical(finalUrl, href, { fetchImpl });
  if (key && hostOf(target) !== hostOf(requestedUrl)) return { state: 'unreadable', target };
  return probeCanonical(requestedUrl, href, { fetchImpl });
}

/**
 * The issue the canonical signal's evidence shows, or null: a missing tag,
 * or a target in a state above that's an issue.
 *
 * @param {{ canonical?: string|null, target?: { state?: string }|null }} evidence
 */
export function canonicalIssue(evidence = {}) {
  if (!evidence?.canonical) return 'missing';
  const state = evidence.target?.state;
  return state && CANONICAL_ISSUES.includes(state) ? state : null;
}
