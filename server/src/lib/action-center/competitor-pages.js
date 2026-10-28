/**
 * What the pages AI answers cite have (learning C1).
 *
 * "Analyze competitor content" was a step for a person: nothing looked at the
 * pages AI engines cite where the brand isn't named. This reads them: the
 * pages cited in the brand's own tracked answers for the action's prompts
 * lately, a competitor's first, and the brand's own page cited there. Each is
 * fetched free (safe-fetch: public addresses only, never a paid scraper) and
 * run through Site Audit's own rule checks that read the page alone —
 * structure, FAQ, schema, statistics, dates, length. What the checks found is
 * kept (cited_page_features, 00369), never the page's text, and nothing is
 * summarised by AI. The result is the checks most of the competitor pages
 * pass that the brand's page doesn't.
 *
 * Only addresses the brand's own answers cited are read — never one a request
 * names — at most `perBrandPerDay` new reads a day for a brand, and a page
 * read in the last `freshDays` isn't read again.
 */

import * as cheerio from 'cheerio';
import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/action-engine.js';
import { fetchPage } from '../safe-fetch.js';
import { extractHostname } from '../response-parser.js';
import { signalRegistry } from '../audit/signals/index.js';
import { describeSignal } from '../audit/rubric.js';
import { opportunityKey } from '../audit/opportunities.js';
import { promptIdsOf } from './priority.js';

const { competitorPages: C } = resolve();

const DAY_MS = 86_400_000;
const READ_TIMEOUT_MS = 8_000;
/** Answers read for the action's prompts, newest first. */
const ANSWERS_READ = 300;

/**
 * The checks compared: Site Audit's that read the page alone, never its
 * site's robots.txt or llms.txt, and that the page's author can act on.
 */
export const FEATURE_CHECKS = Object.freeze([
  'length',
  'structural-depth',
  'h2-coverage',
  'lists',
  'tables',
  'faq-schema',
  'json-ld-presence',
  'statistic-density',
  'quotations',
  'citation-density',
  'outbound-authority-links',
  'author-byline',
  'date-markup',
  'freshness',
  'readability',
]);

/**
 * A run that read no competitor page because the brand's reads for the day
 * are spent: its task waits for the next night, as one waiting on approval.
 */
export class ReadLaterError extends Error {
  constructor(message) {
    super(message);
    this.retryLater = true;
  }
}

/** What Site Audit's checks read, built from a page fetched here. */
export function pageContext(url, html, now = Date.now()) {
  const $ = cheerio.load(html);
  // Text from a second parse, so the first keeps its JSON-LD blocks (audit/context.js).
  const $text = cheerio.load(html);
  $text('script, style, noscript, template, svg').remove();
  const text = $text('body').text().replace(/\s+/g, ' ').trim();
  const u = new URL(url);
  return {
    url,
    origin: `${u.protocol}//${u.host}`,
    protocol: u.protocol.replace(':', ''),
    statusCode: 200,
    html,
    htmlBytes: Buffer.byteLength(html, 'utf8'),
    $,
    text,
    wordCount: text ? text.split(/\s+/).length : 0,
    robotsTxt: null,
    llmsTxt: null,
    query: null,
    now,
  };
}

/** A page's features: its words and each compared check's status. */
export async function pageFeatures(url, html, now = Date.now()) {
  const ctx = pageContext(url, html, now);
  const checks = {};
  for (const signal of signalRegistry) {
    if (!FEATURE_CHECKS.includes(signal.key)) continue;
    try {
      checks[signal.key] = (await signal.evaluate(ctx)).status;
    } catch {
      checks[signal.key] = 'na';
    }
  }
  return { words: ctx.wordCount, checks };
}

const hostOf = (value) => extractHostname(/^https?:\/\//i.test(value) ? value : `https://${value}`);
const onDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/**
 * The pages to read from the answers: the competitors' most cited first, then
 * the most cited in answers that don't name the brand, at most `perAction`;
 * and the brand's own page most cited there.
 *
 * @param {Array<{ mention_count?: number, citations?: Array<{ url?: string }> }>} answers
 * @param {{ ownDomains: string[], competitorDomains: string[], perAction?: number }} options
 */
export function citedPages(answers, { ownDomains, competitorDomains, perAction = C.perAction }) {
  const own = ownDomains.map(hostOf).filter(Boolean);
  const rivals = competitorDomains.map(hostOf).filter(Boolean);
  const tally = { own: new Map(), rival: new Map(), other: new Map() };
  for (const answer of answers) {
    const seen = new Set();
    for (const cite of answer.citations ?? []) {
      const url = typeof cite?.url === 'string' ? cite.url : null;
      const host = url ? hostOf(url) : null;
      const key = url ? opportunityKey(url) : null;
      if (!host || !key || seen.has(key) || !/^https?:\/\//i.test(url)) continue;
      seen.add(key);
      const group = own.some((d) => onDomain(host, d))
        ? tally.own
        : rivals.some((d) => onDomain(host, d))
          ? tally.rival
          : (answer.mention_count ?? 0) === 0
            ? tally.other
            : null;
      if (!group) continue;
      const known = group.get(key) ?? { key, url, domain: host, count: 0 };
      known.count += 1;
      group.set(key, known);
    }
  }
  const ranked = (map) =>
    [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const competitors = [...ranked(tally.rival), ...ranked(tally.other)].slice(0, perAction);
  return { competitors, yours: ranked(tally.own)[0] ?? null };
}

/**
 * The checks at least half of the competitor pages pass (one at least) that
 * the brand's page doesn't, the most passed first; every such check when no
 * page of the brand's was cited.
 */
export function featureGaps(competitorPages, yourPage) {
  const read = competitorPages.filter((page) => page.checks);
  if (read.length === 0) return [];
  const needed = Math.max(1, Math.ceil(read.length / 2));
  return FEATURE_CHECKS.map((key) => ({
    key,
    label: describeSignal(key)?.label ?? key,
    competitors: read.filter((page) => page.checks[key] === 'pass').length,
    of: read.length,
  }))
    .filter((gap) => gap.competitors >= needed && yourPage?.checks?.[gap.key] !== 'pass')
    .sort((a, b) => b.competitors - a.competitors);
}

const passing = (checks) => FEATURE_CHECKS.filter((key) => checks?.[key] === 'pass');

/**
 * The "Analyze competitor content" task's result: the competitor pages read,
 * the brand's, and the checks the first pass that the second doesn't.
 *
 * @param {{ brandId: string, payload: object, now?: Date, read?: typeof fetchPage }} input
 *   read: the page reader, for tests
 */
export async function analyzeCompetitorPages({
  brandId,
  payload,
  now = new Date(),
  read = fetchPage,
}) {
  const promptIds = promptIdsOf([payload]);
  const empty = (reason) => ({ competitorPages: [], yourPage: null, gaps: [], reason });
  if (promptIds.length === 0) return empty('no_prompts');

  const since = new Date(now.getTime() - C.answersDays * DAY_MS).toISOString();
  const [answersRes, domainsRes, competitorsRes] = await Promise.all([
    supabaseAdmin
      .from('prompt_results')
      .select('mention_count, citations')
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .in('prompt_id', promptIds.slice(0, 50))
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(ANSWERS_READ),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabaseAdmin.from('competitors').select('domain').eq('brand_id', brandId),
  ]);
  for (const res of [answersRes, domainsRes, competitorsRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const picked = citedPages(answersRes.data ?? [], {
    ownDomains: (domainsRes.data ?? []).map((row) => row.domain).filter(Boolean),
    competitorDomains: (competitorsRes.data ?? []).map((row) => row.domain).filter(Boolean),
  });
  if (picked.competitors.length === 0) return empty('none_cited');

  // What was read lately is reused; a day's new reads stop at the cap.
  const pages = [...picked.competitors, ...(picked.yours ? [{ ...picked.yours, own: true }] : [])];
  const [knownRes, todayRes] = await Promise.all([
    supabaseAdmin
      .from('cited_page_features')
      .select('page_key, features, read_at')
      .eq('brand_id', brandId)
      .in(
        'page_key',
        pages.map((page) => page.key),
      ),
    supabaseAdmin
      .from('cited_page_features')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('read_at', `${now.toISOString().slice(0, 10)}T00:00:00.000Z`),
  ]);
  if (knownRes.error) throw new Error(knownRes.error.message);
  if (todayRes.error) throw new Error(todayRes.error.message);
  const freshSince = now.getTime() - C.freshDays * DAY_MS;
  const fresh = new Map(
    (knownRes.data ?? [])
      .filter((row) => Date.parse(row.read_at) >= freshSince)
      .map((row) => [row.page_key, row.features]),
  );
  let left = C.perBrandPerDay - (todayRes.count ?? 0);
  let capped = 0;
  let unreadable = 0;

  for (const page of pages) {
    if (fresh.has(page.key)) {
      page.features = fresh.get(page.key);
      continue;
    }
    if (left <= 0) {
      capped += 1;
      continue;
    }
    left -= 1;
    try {
      const fetched = await read(page.url, { timeoutMs: READ_TIMEOUT_MS });
      page.features = await pageFeatures(fetched.url, fetched.html, now.getTime());
      const { error } = await supabaseAdmin.from('cited_page_features').upsert(
        {
          brand_id: brandId,
          page_key: page.key,
          url: page.url,
          domain: page.domain,
          own: Boolean(page.own),
          features: page.features,
          read_at: now.toISOString(),
        },
        { onConflict: 'brand_id,page_key' },
      );
      if (error) throw new Error(error.message);
    } catch {
      // A page that blocks the reader, or isn't one: counted, not a failure.
      unreadable += 1;
    }
  }

  const competitorPages = pages
    .filter((page) => !page.own && page.features)
    .map((page) => ({
      url: page.url,
      domain: page.domain,
      cited: page.count,
      words: page.features.words ?? null,
      checks: page.features.checks ?? {},
    }));
  if (competitorPages.length === 0 && capped > 0) {
    throw new ReadLaterError("the brand's page reads for today are spent");
  }
  const own = pages.find((page) => page.own && page.features);
  const yourPage = own
    ? {
        url: own.url,
        cited: own.count,
        words: own.features.words ?? null,
        checks: own.features.checks ?? {},
      }
    : null;
  // The checks each passes, by key: what the task shows.
  const shown = ({ checks, ...page }) => ({ ...page, passes: passing(checks) });
  return {
    competitorPages: competitorPages.map(shown),
    yourPage: yourPage ? shown(yourPage) : null,
    gaps: featureGaps(competitorPages, yourPage),
    capped,
    unreadable,
    ...(competitorPages.length === 0 ? { reason: 'unreadable' } : {}),
  };
}

/**
 * What the checks found on pages already read (learning C2), by page key,
 * for the brand: read in the last two `freshDays`, never read here. Improve
 * gives them to its model as seen evidence, not a guess.
 *
 * @returns {Promise<Map<string, { own: boolean, checks: Record<string, string> }>>}
 */
export async function storedFeatures(brandId, urls, now = new Date()) {
  const keys = [...new Set(urls.map((url) => opportunityKey(url)).filter(Boolean))];
  if (keys.length === 0) return new Map();
  const since = new Date(now.getTime() - 2 * C.freshDays * DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('cited_page_features')
    .select('page_key, own, features')
    .eq('brand_id', brandId)
    .in('page_key', keys)
    .gte('read_at', since);
  if (error) throw new Error(error.message);
  return new Map(
    (data ?? [])
      // A page that couldn't be read leaves a row with nothing to tell.
      .filter((row) => !row.features?.unreadable && row.features?.checks)
      .map((row) => [row.page_key, { own: row.own === true, checks: row.features.checks }]),
  );
}
