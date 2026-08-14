/**
 * Page opportunity detection (#719, Phase 5).
 *
 * Answers one question per brand: which pages carry commercial weight, and
 * get nothing from AI engines. Both halves come from tables the GA sync
 * (#704) already aggregates, so detection is arithmetic over a few hundred
 * rows — no model, no page fetching, and nothing that scans result citations.
 *
 * The ranking signal is chosen from what the property actually reports rather
 * than assumed. A shop with ecommerce ranks on money; a site with no
 * conversion events at all ranks on engagement. The signal used is stored on
 * every finding, because a surface that calls an engagement rank "your most
 * valuable page" is making a true statement about the wrong thing.
 *
 * Deliberately not here: LLM enrichment, clustering, and the full opportunity
 * lifecycle. Those need more volume than this produces today, and a finding
 * nobody can verify is worse than one that is merely narrow.
 */

import supabaseAdmin from '../config/supabase.js';
import { isExcludedPath } from './page-paths.js';
import { logger } from './logger.js';

const WINDOW_DAYS = 28;

/**
 * A page below this has too little behind it for a finding, whatever its
 * percentile. This is what stops the engine from producing a constant
 * fraction of every site: a percentile alone always qualifies the same share
 * of pages, so a brand with genuinely little to fix would still be handed a
 * full list.
 */
const MIN_SESSIONS = 10;

/** How far up its own site a page must rank before it is worth raising. */
const MIN_PERCENTILE = 70;

/**
 * Ranking signals in order of how directly they express commercial value.
 * The first one the property actually reports wins.
 */
const VALUE_SIGNALS = [
  { name: 'revenue', of: (p) => p.revenue },
  { name: 'transactions', of: (p) => p.transactions },
  { name: 'key_events', of: (p) => p.keyEvents },
  { name: 'engagement', of: (p) => p.engagementSeconds },
];

/**
 * The strongest signal this brand's property reports.
 *
 * Falls back to engagement, which every property has: without it a site with
 * no ecommerce and no configured key events would produce no findings at all,
 * and "nobody has set up conversion tracking" is not a reason to tell a
 * customer there is nothing to look at.
 */
export function pickValueSignal(pages) {
  for (const signal of VALUE_SIGNALS) {
    if ((pages ?? []).some((page) => (signal.of(page) ?? 0) > 0)) return signal.name;
  }
  return 'engagement';
}

function signalValue(page, signalName) {
  const signal = VALUE_SIGNALS.find((s) => s.name === signalName);
  return signal ? (signal.of(page) ?? 0) : 0;
}

/**
 * Rank pages within their own site, so a small B2B site and a large shop are
 * judged on the same scale.
 *
 * Percentile is the share of the brand's own pages this one beats, which
 * makes 100 the top page rather than an unreachable ceiling. Ties share a
 * percentile — two pages with identical revenue should not be separated by
 * whichever happened to sort first.
 */
export function scorePages(pages, signalName) {
  const values = (pages ?? []).map((page) => signalValue(page, signalName));
  const total = values.length;

  const ranked = (pages ?? [])
    .map((page, i) => ({ page, value: values[i] }))
    .sort((a, b) => b.value - a.value || b.page.sessions - a.page.sessions);

  return ranked.map((entry, index) => ({
    ...entry.page,
    valueSignal: signalName,
    value: entry.value,
    valueRank: index + 1,
    valuePercentile:
      total <= 1
        ? 100
        : Math.round((values.filter((v) => v < entry.value).length / total) * 1000) / 10,
  }));
}

/**
 * Findings for one brand's pages.
 *
 * A page qualifies when it ranks high on its site AND clears the absolute
 * floors — both conditions, because either alone misreports. The percentile
 * without a floor hands every site the same number of findings; the floor
 * without a percentile buries a small site's best page under a large one's
 * long tail.
 */
export function detectPageOpportunities({ pages, aiByPage, windowDays = WINDOW_DAYS }) {
  const signal = pickValueSignal(pages);
  const scored = scorePages(pages, signal);

  return scored
    .filter((page) => page.sessions >= MIN_SESSIONS)
    .filter((page) => page.value > 0)
    .filter((page) => page.valuePercentile >= MIN_PERCENTILE)
    .filter((page) => !(aiByPage?.get(page.landingPage)?.sessions > 0))
    .map((page) => ({
      landing_page: page.landingPage,
      kind: 'no_ai_traffic',
      value_signal: page.valueSignal,
      value_percentile: page.valuePercentile,
      value_rank: page.valueRank,
      sessions: page.sessions,
      engaged_sessions: page.engagedSessions,
      key_events: page.keyEvents,
      transactions: page.transactions,
      revenue: page.revenue,
      engagement_seconds: page.engagementSeconds,
      ai_sessions: 0,
      ai_platforms: [],
      window_days: windowDays,
    }));
}

/** Sum the per-day GA rows into one row per landing page. */
export function aggregatePages(rows) {
  const byPage = new Map();
  for (const row of rows ?? []) {
    const page = row.landing_page ?? '';
    if (isExcludedPath(page)) continue;
    const acc = byPage.get(page) ?? {
      landingPage: page,
      sessions: 0,
      engagedSessions: 0,
      keyEvents: 0,
      transactions: 0,
      revenue: 0,
      engagementSeconds: 0,
    };
    acc.sessions += Number(row.sessions) || 0;
    acc.engagedSessions += Number(row.engaged_sessions) || 0;
    acc.keyEvents += Number(row.key_events) || 0;
    acc.transactions += Number(row.transactions) || 0;
    acc.revenue += Number(row.purchase_revenue) || 0;
    acc.engagementSeconds += Number(row.engagement_duration_seconds) || 0;
    byPage.set(page, acc);
  }
  return [...byPage.values()];
}

/**
 * AI-referred sessions and platforms per landing page.
 *
 * A plain lookup, with no scope filtering: the candidate set is decided when
 * pages are aggregated, and filtering here as well would only hide the answer
 * to "does this page already get AI traffic".
 */
export function aggregateAiTraffic(rows) {
  const byPage = new Map();
  for (const row of rows ?? []) {
    const page = row.landing_page ?? '';
    if (!page) continue;
    const acc = byPage.get(page) ?? { sessions: 0, platforms: new Set() };
    acc.sessions += Number(row.sessions) || 0;
    if (row.platform) acc.platforms.add(row.platform);
    byPage.set(page, acc);
  }
  return new Map(
    [...byPage].map(([page, acc]) => [
      page,
      { sessions: acc.sessions, platforms: [...acc.platforms] },
    ]),
  );
}

async function detectForBrand(brandId) {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [{ data: pageRows, error: pageErr }, { data: aiRows, error: aiErr }] = await Promise.all([
    supabaseAdmin
      .from('ga_page_stats')
      .select(
        'landing_page, sessions, engaged_sessions, key_events, transactions, purchase_revenue, engagement_duration_seconds',
      )
      .eq('brand_id', brandId)
      .gte('date', since),
    supabaseAdmin
      .from('ga_ai_traffic_stats')
      .select('landing_page, platform, sessions')
      .eq('brand_id', brandId)
      .gte('date', since),
  ]);
  if (pageErr) throw new Error(pageErr.message);
  if (aiErr) throw new Error(aiErr.message);
  if (!pageRows?.length) return { found: 0, resolved: 0 };

  const findings = detectPageOpportunities({
    pages: aggregatePages(pageRows),
    aiByPage: aggregateAiTraffic(aiRows),
  });

  const now = new Date().toISOString();
  if (findings.length > 0) {
    // first_detected_at is left to the column default so it survives the
    // upsert: a finding that has been open for a week should say so, not
    // reset its age every night.
    const { error } = await supabaseAdmin.from('page_opportunities').upsert(
      findings.map((f) => ({ ...f, brand_id: brandId, last_detected_at: now, resolved_at: null })),
      { onConflict: 'brand_id,landing_page,kind' },
    );
    if (error) throw new Error(error.message);
  }

  // Anything still open that this run did not touch no longer qualifies — the
  // page picked up AI traffic, lost its standing, or fell below the floors.
  // Stamped rather than deleted so a surface can show that something improved
  // instead of the row quietly disappearing.
  //
  // Selected by the timestamp the upsert above just wrote, not by excluding a
  // list of paths: a `not.in.(...)` filter has to be built as a string, and a
  // landing page containing a comma or a quote would silently change which
  // rows it matched.
  const { error: resolveErr } = await supabaseAdmin
    .from('page_opportunities')
    .update({ resolved_at: now })
    .eq('brand_id', brandId)
    .is('resolved_at', null)
    .lt('last_detected_at', now);
  if (resolveErr) throw new Error(resolveErr.message);

  return { found: findings.length, signal: findings[0]?.value_signal ?? null };
}

/**
 * Detect for every brand with synced GA data; optionally scoped to one
 * organization. Per-brand failures are logged and skipped.
 */
export async function runPageOpportunityDetection({ organizationId } = {}) {
  let brandQuery = supabaseAdmin
    .from('brands')
    .select('id, organization_id')
    .eq('is_active', true)
    .not('ga_property_id', 'is', null);
  if (organizationId) brandQuery = brandQuery.eq('organization_id', organizationId);
  const { data: brands, error } = await brandQuery;
  if (error) throw new Error(error.message);
  if (!brands?.length) return { scanned: 0, results: [] };

  const results = [];
  for (const brand of brands) {
    try {
      const outcome = await detectForBrand(brand.id);
      results.push({ brandId: brand.id, ...outcome });
    } catch (err) {
      logger.error({ err, brandId: brand.id }, '[page-opportunities] detection failed');
      results.push({ brandId: brand.id, error: err.message });
    }
  }

  logger.info({ scanned: brands.length }, '[page-opportunities] detection completed');
  return { scanned: brands.length, results };
}
