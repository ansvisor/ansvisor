import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import supabaseAdmin from '../config/supabase.js';
import { jsonLd, metaContent, typesOf } from './audit/signals/helpers.js';
import { linkHref } from './content-links.js';
import { PageFetchError, fetchPage } from './safe-fetch.js';

/**
 * The links of a saved Content Editor draft, read for Trust (Quality spec
 * §2.2): does each answer ("No broken links"), and how old is the page it
 * points to ("Fresh sources"). Each link is read through the guarded fetch
 * (safe-fetch.js: public addresses only, redirects checked, time and size
 * capped) at most once a day, whoever's draft has it (content_link_checks,
 * 00253); a few reads at a time across the server, and the same link once
 * while it is being read.
 */

/** The most links one draft has read. */
export const MAX_LINKS = 20;
/** How long a read holds: a day, or a few hours for one that wouldn't tell. */
export const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const UNKNOWN_TTL_MS = 6 * 60 * 60 * 1000;
/** Reads are dropped after a week. */
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
/** A link that hasn't answered by then is unknown, not broken. */
export const LINK_TIMEOUT_MS = 8_000;
/** A link's page is read up to this much: its head and article come first. */
export const LINK_MAX_BYTES = 1024 * 1024;
const PER_CALL = 4;
/** Links read at once across every draft. */
export const MAX_READS = 8;

/** Answers that say the page is gone. */
const GONE = new Set([404, 410, 451]);
/** Network errors that say the site is nowhere. */
const NOWHERE = new Set(['ENOTFOUND', 'ECONNREFUSED']);

/**
 * How a read reads as a link: 'ok' when it answers (a page, or a file such
 * as a PDF), 'broken' when the page is gone or the site is nowhere, and
 * 'unknown' when it wouldn't tell: too slow, a bot wall (400, 401, 403,
 * 429), a server or certificate error that may pass, a redirect loop that
 * wants a cookie, an address the fetch won't read.
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
      return NOWHERE.has(err.errno) ? 'broken' : 'unknown';
    default:
      return 'unknown';
  }
}

/** The entities whose date is the page's own, not a sidebar's or a comment's. */
const MAIN_TYPES = new Set([
  'article',
  'blogposting',
  'newsarticle',
  'techarticle',
  'scholarlyarticle',
  'report',
  'webpage',
  'howto',
  'faqpage',
]);

/**
 * The page's own newest date: its main JSON-LD entity's dateModified (or
 * datePublished), else its article:modified_time (or published_time), else
 * the first <time datetime> in its article or main. A date ahead of `now`
 * is a page's mistake, not its age. Null when it gives none.
 */
export function pageDate(html, now = Date.now()) {
  const $ = cheerio.load(html);
  const usable = (value) => {
    const t = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isNaN(t) || t > now ? null : t;
  };
  const main = jsonLd({ $ })
    .nodes.filter((n) => typesOf(n).some((t) => MAIN_TYPES.has(t)))
    .map((n) => usable(n.dateModified) ?? usable(n.datePublished))
    .filter((t) => t !== null);
  const found = main.length
    ? Math.max(...main)
    : (usable(metaContent({ $ }, 'article:modified_time')) ??
      usable(metaContent({ $ }, 'article:published_time')) ??
      usable($('article time[datetime], main time[datetime]').first().attr('datetime')));
  return found === null ? null : new Date(found).toISOString();
}

/** Addresses whose read could do something: unsubscribe, sign in, confirm. */
const SIDE_EFFECT_PATH =
  /(?:^|[/_.-])(?:unsubscribe|logout|log-out|signout|sign-out|confirm|verify|activate|magic-link|reset-password)(?:$|[/_.?-])/i;
const SIDE_EFFECT_PARAM = /^(?:token|access_token|auth|key|sig|signature|code|otp)$/i;

/** Whether a link is one the check reads: not a one-time or account link. */
export function readableLink(url) {
  const parsed = new URL(url);
  if (SIDE_EFFECT_PATH.test(parsed.pathname)) return false;
  return ![...parsed.searchParams.keys()].some((name) => SIDE_EFFECT_PARAM.test(name));
}

const hashOf = (url) => createHash('sha256').update(url).digest('hex');

/** Reads under way across the server: one link read once, MAX_READS at a time. */
const reading = new Map();
let active = 0;
const waiting = [];
async function inSlot(work) {
  while (active >= MAX_READS) await new Promise((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

async function readLink(url, fetcher, now) {
  try {
    const page = await fetcher(url, { timeoutMs: LINK_TIMEOUT_MS, maxBytes: LINK_MAX_BYTES });
    return { url, status: 'ok', httpStatus: page.status, date: pageDate(page.html, now) };
  } catch (err) {
    return {
      url,
      status: linkStatus(err),
      httpStatus: err instanceof PageFetchError ? (err.status ?? null) : null,
      date: null,
    };
  }
}

function readOnce(url, fetcher, now) {
  let read = reading.get(url);
  if (!read) {
    read = inSlot(() => readLink(url, fetcher, now)).finally(() => reading.delete(url));
    reading.set(url, read);
  }
  return read;
}

let prunedAt = 0;

/** Links one member may have read in an hour; past it, the rest wait for the next. */
export const HOURLY_READS = 200;
const spent = new Map();

/** How many links the member may still have read this hour. */
export function readBudget(userId, now = Date.now()) {
  const hour = spent.get(userId);
  return hour && now - hour.from < 60 * 60 * 1000 ? HOURLY_READS - hour.used : HOURLY_READS;
}

/** Counts reads against the member's hour. */
export function spendReads(userId, count, now = Date.now()) {
  if (!count) return;
  const hour = spent.get(userId);
  if (hour && now - hour.from < 60 * 60 * 1000) hour.used += count;
  else spent.set(userId, { from: now, used: count });
}

/**
 * Each link's status and date, keyed by the link as given. Links are kept
 * as the check keys them (no hash, no tracking parameters), http(s) only,
 * one-time and account links left out, MAX_LINKS at most. A read from the
 * last day (an 'unknown' one from the last few hours) comes from
 * content_link_checks; up to `budget` of the rest are read now and kept
 * there; a link over the budget isn't in the answer.
 *
 * @param {string[]} hrefs the draft's links, as written
 * @param {{ db?: typeof supabaseAdmin, fetcher?: typeof fetchPage, now?: number, budget?: number, log?: { error: Function } }} [deps]
 * @returns {Promise<{ reads: Map<string, { status: 'ok'|'broken'|'unknown', httpStatus: number|null, date: string|null }>, fetched: number }>}
 */
export async function checkLinks(hrefs, deps = {}) {
  const {
    db = supabaseAdmin,
    fetcher = fetchPage,
    now = Date.now(),
    budget = MAX_LINKS,
    log = console,
  } = deps;
  const byKey = new Map();
  for (const href of hrefs) {
    const key = linkHref(href);
    if (!key || !readableLink(key)) continue;
    if (!byKey.has(key) && byKey.size >= MAX_LINKS) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), href]);
  }
  const keys = [...byKey.keys()];
  const reads = new Map();
  if (!keys.length) return { reads, fetched: 0 };

  const known = new Map();
  const { data: kept, error } = await db
    .from('content_link_checks')
    .select('url, status, http_status, page_date, checked_at')
    .in('url_hash', keys.map(hashOf))
    .gte('checked_at', new Date(now - CHECK_TTL_MS).toISOString());
  // Without the kept reads, the links are read again.
  if (error) log.error({ err: error }, 'content link checks not read');
  for (const row of kept ?? []) {
    if (row.status === 'unknown' && Date.parse(row.checked_at) < now - UNKNOWN_TTL_MS) continue;
    known.set(row.url, { status: row.status, httpStatus: row.http_status, date: row.page_date });
  }

  const toRead = keys.filter((key) => !known.has(key)).slice(0, Math.max(0, budget));
  const read = [];
  for (let i = 0; i < toRead.length; i += PER_CALL) {
    read.push(
      ...(await Promise.all(toRead.slice(i, i + PER_CALL).map((u) => readOnce(u, fetcher, now)))),
    );
  }
  if (read.length) {
    const checkedAt = new Date(now).toISOString();
    const { error: keepError } = await db.from('content_link_checks').upsert(
      read.map((r) => ({
        url_hash: hashOf(r.url),
        url: r.url,
        status: r.status,
        http_status: r.httpStatus,
        page_date: r.date,
        checked_at: checkedAt,
      })),
      { onConflict: 'url_hash' },
    );
    // The reads stand without being kept: the next ask reads them again.
    if (keepError) log.error({ err: keepError }, 'content link checks not kept');
    for (const r of read)
      known.set(r.url, { status: r.status, httpStatus: r.httpStatus, date: r.date });
  }

  if (now - prunedAt > 60 * 60 * 1000) {
    prunedAt = now;
    const { error: pruneError } = await db
      .from('content_link_checks')
      .delete()
      .lt('checked_at', new Date(now - KEEP_MS).toISOString());
    if (pruneError) log.error({ err: pruneError }, 'old content link checks not dropped');
  }

  for (const [key, given] of byKey) {
    const result = known.get(key);
    if (result) for (const href of given) reads.set(href, result);
  }
  return { reads, fetched: read.length };
}
