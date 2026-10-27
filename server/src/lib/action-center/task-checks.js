/**
 * Automatic checks (AC-010): a task whose How we check is `auto` is checked
 * on its page, fetched again with the free reader (safe-fetch, never the
 * paid scraper), by what the task changes:
 *
 *  - a broken page answers again (fix_broken_target);
 *  - a page is published: it answers where it didn't, or changed since the
 *    first look (publish_content: the page may be live already);
 *  - it has valid structured data (fix_structured_data);
 *  - robots.txt lets the AI crawlers in, and the page isn't noindex
 *    (fix_crawler_access);
 *  - it changed since the first look (optimize, refresh, strengthen, the
 *    call to action): the first look keeps the page's words' fingerprint;
 *  - a written task's new text is on it (its change's `after`).
 *
 * A task that passes is completed, with the check kept on it and a line in
 * the action's History; one that doesn't keeps what is missing, for its
 * card. A page that can't be read keeps only when it was tried. Site Audit
 * fixes aren't checked here: a new audit is a paid run.
 */

import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { fetchPage } from '../safe-fetch.js';
import { extractPageContent } from '../page-content.js';
import { normStoredDomain } from '../audit/host.js';
import { aiBotAccess } from '../audit/signals/trust.js';
import { jsonLd } from '../audit/signals/helpers.js';

/** What each library task's check reads. */
export const CHECKS = Object.freeze({
  publish_content: 'published',
  fix_broken_target: 'answers',
  fix_structured_data: 'structuredData',
  fix_crawler_access: 'crawlers',
  optimize_content: 'changed',
  refresh_content: 'changed',
  strengthen_reference_asset: 'changed',
  strengthen_entity_content: 'changed',
  improve_cta_path: 'changed',
});

/** The most open tasks one nightly sweep checks: pages are fetched one at a time. */
export const SWEEP_LIMIT = 200;
/** A task tried this recently isn't tried again by the sweep. */
const RECHECK_AFTER_MS = 20 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const OPEN = ['todo', 'in_progress'];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** What a task's check reads, or null when it has none here. */
export function checkKind(task) {
  const d = task.details ?? {};
  if (d.check !== 'auto' || !text(d.url)) return null;
  if (task.task_key) return CHECKS[task.task_key] ?? null;
  return text(d.change?.after) ? 'text' : null;
}

/** The task's page as an address: a path is on the brand's first domain. */
export function pageAddress(url, host) {
  const value = text(url);
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/') && host) return `https://${host}${value}`;
  return null;
}

/** Words as compared: lower case, letters and digits only, a space around each. */
const words = (value) =>
  ` ${String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

/**
 * A page's visible words: its content (never its menus or ads), with its
 * title and meta description, entities read as their characters, and no
 * script's or style's (a JSON-LD date or price changes with no one's work).
 */
function visibleText(html, url) {
  const page = cheerio.load(html);
  const head = [page('title').first().text(), page('meta[name="description"]').attr('content')];
  const content = cheerio.load(extractPageContent(html, url).html);
  content('script, style, noscript').remove();
  // A block's words end with it: "Pricing" and "Plans" never run together.
  content(BLOCKS).after(' ');
  return [...head, content.root().text()].filter(Boolean).join(' ');
}

const BLOCKS =
  'p, div, li, dd, dt, td, th, tr, h1, h2, h3, h4, h5, h6, br, hr, section, article, ' +
  'blockquote, figcaption, header, footer, ul, ol, table';

const fingerprint = (visible) => createHash('sha256').update(words(visible)).digest('hex');

/** Whether a page asks not to be indexed (its robots meta tags). */
function noindex($) {
  return $('meta[name="robots"], meta[name="googlebot"]')
    .map((_, el) => String($(el).attr('content') ?? '').toLowerCase())
    .get()
    .some((content) => /\bnoindex\b/.test(content));
}

/**
 * What the page's words say against the first look: the first look (or one
 * of another page) keeps them; a change passes.
 */
function changedSince(previous, url, visible) {
  const now = fingerprint(visible);
  if (!previous?.fingerprint || previous.url !== url) {
    return { passed: false, missing: ['first_look'], fingerprint: now };
  }
  return now !== previous.fingerprint
    ? { passed: true, missing: [], fingerprint: now }
    : { passed: false, missing: ['not_changed'], fingerprint: previous.fingerprint };
}

/**
 * A task's check on its page: `{ passed, missing, fingerprint?, wasMissing? }`,
 * or null when the page couldn't be read (no answer, a timeout, a server
 * error): nothing but the try is kept then. `missing` names what stands
 * between the task and done, as the card words it (en.json
 * actionCenter.taskCheckMissing).
 *
 * @param {string} kind  checkKind's
 * @param {string} url   the page's address
 * @param {{ previous?: object|null, after?: string, fetch?: Function }} [options]
 *   `previous`: the last check kept on the task; `after`: a written task's new text
 */
export async function checkPage(
  kind,
  url,
  { previous = null, after = '', fetch = fetchPage } = {},
) {
  let page;
  try {
    page = await fetch(url, { timeoutMs: FETCH_TIMEOUT_MS });
  } catch (err) {
    // The page answered "not here" (4xx): that's an answer. A server error
    // (5xx) or none at all says nothing.
    if (err?.code === 'http_error' && err.status < 500) {
      return { passed: false, missing: ['page_error'], wasMissing: true };
    }
    return null;
  }
  if (kind === 'answers') return { passed: true, missing: [] };

  const $ = cheerio.load(page.html);
  if (kind === 'structuredData') {
    return jsonLd({ $ }).valid > 0
      ? { passed: true, missing: [] }
      : { passed: false, missing: ['no_structured_data'] };
  }

  if (kind === 'crawlers') {
    let robotsTxt = '';
    try {
      const robots = await fetch(new URL('/robots.txt', page.url).href, {
        timeoutMs: FETCH_TIMEOUT_MS,
        types: /^\s*text\/plain/i,
        accept: 'text/plain',
      });
      robotsTxt = robots.html;
    } catch (err) {
      // None (4xx), or a page instead (an app answering every address): no
      // rules, every crawler in. A server error or no answer says nothing.
      const none = (err?.code === 'http_error' && err.status < 500) || err?.code === 'not_html';
      if (!none) return null;
    }
    const missing = [];
    if (aiBotAccess.evaluate({ robotsTxt }).evidence?.blocked) missing.push('crawlers_blocked');
    if (noindex($)) missing.push('noindex');
    return { passed: missing.length === 0, missing };
  }

  const visible = visibleText(page.html, page.url);
  if (kind === 'text') {
    return words(visible).includes(words(after))
      ? { passed: true, missing: [] }
      : { passed: false, missing: ['change_not_found'] };
  }
  if (kind === 'published') {
    // It didn't answer before and does now: published.
    if (previous?.wasMissing && previous.url === url) return { passed: true, missing: [] };
    return changedSince(previous, url, visible);
  }
  if (kind === 'changed') return changedSince(previous, url, visible);
  return null;
}

/** The brand's first domain's host, for a task whose page is a path. */
async function brandHost(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return normStoredDomain(data?.[0]?.domain) ?? null;
}

/**
 * Checks one task and keeps what it found on it (`details.autoCheck`, with
 * the page it read): passed, it is completed and the action's History says
 * so. Written only if the task is as it was read (its status and its last
 * change), so neither a move nor an edit meanwhile is lost. Returns
 * `{ autoCheck }`, or `{ reason }` when nothing was checked: 'not_checkable'
 * (no check here), 'not_open' (done or skipped), 'no_answer' (the page
 * couldn't be read), 'changed' (someone changed the task meanwhile).
 *
 * @param {{ id: string, action_id: string, task_key: string|null, title?: string|null,
 *   status: string, details: object|null, updated_at?: string }} task
 * @param {{ brand_id: string }} action
 */
export async function runTaskCheck(task, action, { fetch = fetchPage, now = new Date() } = {}) {
  const kind = checkKind(task);
  if (!kind) return { reason: 'not_checkable' };
  if (!OPEN.includes(task.status)) return { reason: 'not_open' };
  const d = task.details ?? {};
  const raw = text(d.url);
  const url = pageAddress(raw, /^https?:\/\//i.test(raw) ? null : await brandHost(action.brand_id));
  if (!url) return { reason: 'not_checkable' };

  const previous = d.autoCheck ?? null;
  const found = await checkPage(kind, url, { previous, after: d.change?.after, fetch });
  // The try's time is kept either way, so the sweep goes on to the next
  // ones; the last check as it was when the page couldn't be read.
  const kept = found?.fingerprint ?? previous?.fingerprint;
  const autoCheck = found
    ? {
        at: now.toISOString(),
        triedAt: now.toISOString(),
        url,
        passed: found.passed,
        missing: found.missing,
        // A page that didn't answer keeps the first look it had.
        ...(kept ? { fingerprint: kept } : {}),
        ...(found.wasMissing ? { wasMissing: true } : {}),
      }
    : { ...(previous ?? {}), triedAt: now.toISOString() };

  let write = supabaseAdmin
    .from('action_tasks')
    .update({
      details: { ...d, autoCheck },
      ...(found?.passed ? { status: 'completed', skip_reason: null } : {}),
      updated_at: now.toISOString(),
    })
    .eq('id', task.id)
    .eq('status', task.status);
  if (task.updated_at) write = write.eq('updated_at', task.updated_at);
  const { data: updated, error } = await write.select('id');
  if (error) throw new Error(error.message);
  if (!updated?.length) return { reason: 'changed' };
  if (!found) return { reason: 'no_answer' };

  if (found.passed) {
    const { error: eventError } = await supabaseAdmin.from('action_events').insert({
      action_id: task.action_id,
      event: 'task_checked',
      data: { taskId: task.id, task: task.task_key ?? null, title: task.title ?? null },
      actor_id: null,
    });
    if (eventError) logger.warn({ err: eventError }, '[task-checks] History line not written');
    await supabaseAdmin
      .from('actions')
      .update({ updated_at: now.toISOString() })
      .eq('id', task.action_id);
  }
  return { autoCheck };
}

/**
 * The nightly sweep: open tasks checked `auto` that can be checked here (a
 * library task with a check, or a written one with its new text) and have a
 * page, of open actions, the least recently tried first, none tried in the
 * last day, one page at a time, at most SWEEP_LIMIT. A failure on one task
 * is logged and the rest go on.
 *
 * @returns {Promise<{ checked: number, passed: number }>}
 */
export async function sweepTaskChecks({
  limit = SWEEP_LIMIT,
  fetch = fetchPage,
  now = new Date(),
} = {}) {
  const { data: rows, error } = await supabaseAdmin
    .from('action_tasks')
    .select(
      'id, action_id, task_key, title, status, details, updated_at, actions!inner(brand_id, status, deleted_at)',
    )
    .in('status', OPEN)
    .eq('details->>check', 'auto')
    .not('details->>url', 'is', null)
    .or(
      `task_key.in.(${Object.keys(CHECKS).join(',')}),and(task_key.is.null,details->change->>after.not.is.null)`,
    )
    .is('actions.deleted_at', null)
    .not('actions.status', 'in', '(completed,dismissed)')
    .order('details->autoCheck->>triedAt', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const since = now.getTime() - RECHECK_AFTER_MS;
  const due = (rows ?? []).filter(
    (row) => checkKind(row) && !(Date.parse(row.details?.autoCheck?.triedAt ?? '') >= since),
  );
  let checked = 0;
  let passed = 0;
  for (const row of due) {
    const action = Array.isArray(row.actions) ? row.actions[0] : row.actions;
    try {
      const result = await runTaskCheck(row, action, { fetch, now });
      if (result.autoCheck) {
        checked += 1;
        if (result.autoCheck.passed) passed += 1;
      }
    } catch (err) {
      logger.warn({ err, taskId: row.id }, '[task-checks] check failed');
    }
  }
  logger.info({ checked, passed }, '[task-checks] sweep done');
  return { checked, passed };
}
