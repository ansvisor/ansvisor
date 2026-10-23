import * as cheerio from 'cheerio';
import supabaseAdmin from '../config/supabase.js';
import { collectDates } from './audit/signals/authority.js';
import { PageFetchError, fetchPage } from './safe-fetch.js';

/**
 * The links of a Content Editor draft, read for Trust (Quality spec §2.2):
 * does each answer ("No broken links"), and how old is the page it points to
 * ("Fresh sources"). Each address is read through the guarded fetch
 * (safe-fetch.js: public addresses only, redirects checked, size and time
 * capped) at most once a day, whoever's draft has it (content_link_checks,
 * 00253).
 */

/** The most links one call reads. */
export const MAX_LINKS = 20;
/** How long a link's read holds. */
export const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
/** A link that hasn't answered by then is unknown, not broken. */
export const LINK_TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;

/** Answers that say the page is gone or the address is wrong. */
const GONE = new Set([400, 404, 410, 451]);

/**
 * How a read reads as a link: 'ok' when it answers (a page, or a file such
 * as a PDF), 'broken' when the page is gone or the site is nowhere, and
 * 'unknown' when it wouldn't tell: too slow, a bot wall (401, 403, 429), a
 * server error that may pass, or an address the fetch won't read.
 *
 * @param {unknown} err the fetch's error, or null when it read the page
 * @returns {'ok'|'broken'|'unknown'}
 */
export function linkStatus(err) {
  if (!err) return 'ok';
  if (!(err instanceof PageFetchError)) return 'unknown';
  switch (err.code) {
    case 'not_html':
    case 'too_large':
      return 'ok';
    case 'http_error':
      return GONE.has(err.status) ? 'broken' : 'unknown';
    case 'unreachable':
    case 'too_many_redirects':
    case 'invalid_url':
      return 'broken';
    default:
      return 'unknown';
  }
}

/** The newest date a page gives for itself, or null. */
export function pageDate(html) {
  const dates = collectDates({ $: cheerio.load(html) });
  // A date ahead of today is a page's mistake, not its age.
  const past = dates.filter((t) => t <= Date.now());
  return past.length ? new Date(Math.max(...past)).toISOString() : null;
}

async function readLink(url, fetcher) {
  try {
    const page = await fetcher(url, { timeoutMs: LINK_TIMEOUT_MS });
    return { url, status: 'ok', httpStatus: page.status, date: pageDate(page.html) };
  } catch (err) {
    return {
      url,
      status: linkStatus(err),
      httpStatus: err instanceof PageFetchError ? (err.status ?? null) : null,
      date: null,
    };
  }
}

/** Runs `work` over `items`, `limit` at a time, keeping their order. */
async function inTurns(items, limit, work) {
  const out = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * Each link's status and date, in the order given (each address once, http
 * and https only, MAX_LINKS at most). A link read in the last day comes from
 * content_link_checks; the rest are read now and kept there.
 *
 * @param {string[]} urls
 * @param {{ db?: typeof supabaseAdmin, fetcher?: typeof fetchPage, now?: number, log?: { error: Function } }} [deps]
 * @returns {Promise<{ url: string, status: 'ok'|'broken'|'unknown', httpStatus: number|null, date: string|null }[]>}
 */
export async function checkLinks(urls, deps = {}) {
  const { db = supabaseAdmin, fetcher = fetchPage, now = Date.now(), log = console } = deps;
  const links = [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))].slice(0, MAX_LINKS);
  if (!links.length) return [];

  const { data: kept, error } = await db
    .from('content_link_checks')
    .select('url, status, http_status, page_date, checked_at')
    .in('url', links)
    .gte('checked_at', new Date(now - CHECK_TTL_MS).toISOString());
  if (error) throw new Error(error.message);
  const known = new Map(
    (kept ?? []).map((row) => [
      row.url,
      { url: row.url, status: row.status, httpStatus: row.http_status, date: row.page_date },
    ]),
  );

  const toRead = links.filter((url) => !known.has(url));
  const read = await inTurns(toRead, CONCURRENCY, (url) => readLink(url, fetcher));
  if (read.length) {
    const checkedAt = new Date(now).toISOString();
    const { error: keepError } = await db.from('content_link_checks').upsert(
      read.map((r) => ({
        url: r.url,
        status: r.status,
        http_status: r.httpStatus,
        page_date: r.date,
        checked_at: checkedAt,
      })),
      { onConflict: 'url' },
    );
    // The reads stand without being kept: the next call reads them again.
    if (keepError) log.error({ err: keepError }, 'content link checks not kept');
    for (const r of read) known.set(r.url, r);
  }
  return links.map((url) => known.get(url));
}
