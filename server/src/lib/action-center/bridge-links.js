/**
 * Bridge links (AC plan P-10, spec §8): from the pages AI sends readers to
 * that rarely convert, to the pages that convert and AI sends few readers.
 * The link puts the selling page one click away, and lets AI find it
 * through the page it already cites. Three shapes come out of the same
 * rules: a guide to a product or a category (a shop), a guide to pricing, a
 * demo or a feature (B2B), and a cited post to a new one next to it.
 *
 * Pure: the nightly detector (signals/library/detect.js, bridgeLinks) reads
 * the pages and hands them here.
 *
 *  - Sources: AI visits or citations over the floor, no sales, and key
 *    events per session well under the site's.
 *  - Targets: a page that sells, converts well above the site's rate, is a
 *    sales page by its address, or is new (the sitemap dates it) with no AI
 *    visits or citations yet; with less AI reach (visits and citations)
 *    than its source.
 *  - Pairing: the words of their titles and first headings in common, the
 *    words most of the site's titles share (its name) left out.
 *  - Anchor: the target's heading, else its title without the site's name.
 *
 * Whether a source already links to its target isn't known here (the
 * pages' links aren't stored): the task's check reads the live page, and a
 * pair already in place passes on its first check.
 */

import { tokens } from '../signals/library/classify.js';

/** Pairs one action carries. */
export const MAX_BRIDGE_PAIRS = 5;
/** Sources one target is linked from, so one page doesn't take every pair. */
const MAX_PER_TARGET = 2;
/** A word in more than this share of the pages' titles is the site's, not a topic. */
const COMMON_WORD_SHARE = 0.3;
const ANCHOR_MAX = 70;
const DAY_MS = 86_400_000;

/** Why a page is a target, strongest first. */
export const BRIDGE_TARGET_REASONS = ['sells', 'converts', 'sales_page', 'new_page'];

/** Address segments of pages that sell, by their kind (spec §8 Targets). */
const SALES_SEGMENTS = {
  pricing: ['pricing', 'plans', 'price', 'prices'],
  demo: ['demo', 'book-a-demo', 'request-demo', 'contact-sales', 'trial', 'free-trial'],
  product: ['product', 'products', 'item', 'items'],
  category: ['category', 'categories', 'collection', 'collections', 'shop'],
  feature: ['feature', 'features', 'solution', 'solutions', 'integrations'],
};

/**
 * A page's key as the AI Traffic pages list keys it (normalize_page_path,
 * lowercased): its path, no query, fragment or trailing slash.
 */
export function pathKey(address) {
  let path = String(address ?? '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
    .split('?')[0]
    .split('#')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // Kept as written.
  }
  return (path.replace(/\/+$/, '') || '/').toLowerCase();
}

/** The kind of sales page an address is, by its segments; null for none. */
export function salesPageType(address) {
  const segments = pathKey(address).split('/').filter(Boolean);
  for (const [type, words] of Object.entries(SALES_SEGMENTS)) {
    if (segments.some((segment) => words.includes(segment))) return type;
  }
  return null;
}

/** A heading or title as link text: the site's name after a separator left out, at most ANCHOR_MAX. */
export function anchorFor({ title, h1 }) {
  const heading = String(h1 ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const named = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+[|–—·-]\s+/)[0]
    .trim();
  const text = heading.length >= 3 && heading.length <= ANCHOR_MAX ? heading : named || heading;
  if (text.length <= ANCHOR_MAX) return text;
  const cut = text.slice(0, ANCHOR_MAX);
  return cut.slice(0, cut.lastIndexOf(' ') > 20 ? cut.lastIndexOf(' ') : ANCHOR_MAX).trim();
}

const number = (value) => Number(value) || 0;

/** An AI Traffic pages row in the chooser's terms. */
function figures(row) {
  return {
    key: pathKey(row.page),
    aiVisits: number(row.ai_visits),
    citations: number(row.citations),
    sessions: number(row.sessions),
    keyEvents: number(row.key_events),
    transactions: number(row.transactions),
    revenue: number(row.revenue),
  };
}

const keyRate = (page) => (page.sessions > 0 ? page.keyEvents / page.sessions : 0);
/** What AI gives a page: the visits it sends, and the answers that cite it. */
const reach = (page) => page.aiVisits + page.citations;

/**
 * The link pairs for a brand, strongest source first, MAX_BRIDGE_PAIRS at
 * most, each source once.
 *
 * @param {{ pages: object[], sitePages: { url: string, title?: string|null,
 *   h1?: string|null, lastmod?: string|null }[], now?: Date }} input - `pages`:
 *   the AI Traffic pages list's rows (ai_traffic_pages, 'all'), every page
 *   it has; `sitePages`: the brand's site_pages, for their titles
 * @param {object} t - the library thresholds (config/action-engine.js)
 * @returns {{ pairs: object[], siteKeyRate: number }}
 */
export function chooseBridgeLinks({ pages = [], sitePages = [], now = new Date() }, t) {
  const all = pages.map(figures);
  const sessions = all.reduce((sum, p) => sum + p.sessions, 0);
  const siteKeyRate = sessions > 0 ? all.reduce((sum, p) => sum + p.keyEvents, 0) / sessions : 0;

  // Only pages read from the site: their titles pair them, their addresses are whole.
  const site = new Map();
  for (const page of sitePages) {
    const key = pathKey(page.url);
    if (/^https?:\/\//i.test(page.url ?? '') && !site.has(key)) site.set(key, page);
  }
  const known = new Map();
  for (const page of all) {
    const read = site.get(page.key);
    if (read && !known.has(page.key)) {
      known.set(page.key, { ...page, read, words: tokens(`${read.title ?? ''} ${read.h1 ?? ''}`) });
    }
  }
  const rows = [...known.values()];

  const counts = new Map();
  for (const row of rows)
    for (const word of row.words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const common = new Set(
    [...counts].filter(([, n]) => n > Math.max(2, rows.length * COMMON_WORD_SHARE)).map(([w]) => w),
  );

  const isSource = (p) =>
    (p.aiVisits >= t.bridgeSourceMinAiVisits || p.citations >= t.bridgeSourceMinCitations) &&
    p.transactions === 0 &&
    p.revenue <= 0 &&
    !salesPageType(p.key) &&
    (siteKeyRate > 0 ? keyRate(p) < siteKeyRate * t.bridgeSourceMaxKeyRate : p.keyEvents === 0);

  const newSince = now.getTime() - t.bridgeNewPageDays * DAY_MS;
  const reasonOf = (p) => {
    if (p.transactions > 0 || p.revenue > 0) return 'sells';
    if (
      siteKeyRate > 0 &&
      p.sessions >= t.bridgeTargetMinSessions &&
      p.keyEvents >= 1 &&
      keyRate(p) >= siteKeyRate * t.landingWinnerMultiple
    ) {
      return 'converts';
    }
    if (salesPageType(p.key)) return 'sales_page';
    const lastmod = Date.parse(p.read.lastmod ?? '');
    if (p.aiVisits === 0 && p.citations === 0 && lastmod >= newSince) return 'new_page';
    return null;
  };

  const sources = rows
    .filter(isSource)
    .sort((a, b) => reach(b) - reach(a) || (a.key < b.key ? -1 : 1));
  const targets = rows
    .map((row) => ({ ...row, reason: reasonOf(row) }))
    .filter((row) => row.reason);

  const pairs = [];
  const linked = new Map();
  for (const source of sources) {
    if (pairs.length >= MAX_BRIDGE_PAIRS) break;
    let best = null;
    for (const target of targets) {
      if (target.key === source.key || (linked.get(target.key) ?? 0) >= MAX_PER_TARGET) continue;
      // AI already gives the target as much as the source: the link adds little.
      if (reach(target) >= reach(source)) continue;
      const shared = [...source.words].filter((w) => target.words.has(w) && !common.has(w));
      if (shared.length === 0) continue;
      const score =
        shared.length * 10 +
        (BRIDGE_TARGET_REASONS.length - BRIDGE_TARGET_REASONS.indexOf(target.reason));
      if (!best || score > best.score) best = { target, shared, score };
    }
    if (!best) continue;
    const { target, shared } = best;
    linked.set(target.key, (linked.get(target.key) ?? 0) + 1);
    pairs.push({
      from: source.read.url,
      to: target.read.url,
      anchor: anchorFor(target.read),
      reason: target.reason,
      salesPage: salesPageType(target.key),
      shared: shared.slice(0, 5),
      aiVisits: source.aiVisits,
      citations: source.citations,
      toSessions: target.sessions,
      toKeyEvents: target.keyEvents,
      toTransactions: target.transactions,
    });
  }
  return { pairs, siteKeyRate };
}
