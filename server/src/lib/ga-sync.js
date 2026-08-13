/**
 * Daily Google Analytics sync (#704).
 *
 * For every active brand mapped to a GA4 property (#694) whose org connection
 * is live, pulls three reports through Composio and upserts them:
 *
 *   ga_ai_traffic_stats  AI-sourced sessions per landing page
 *   ga_page_stats        landing-page totals across every source
 *   ga_item_stats        product rows, when the property has ecommerce
 *
 * Parameters are fully deterministic — no LLM anywhere in this path. Per-brand
 * failures are logged and skipped; one broken property never aborts the run.
 *
 * Unlike Search Console, GA4 has no multi-day reporting lag, so there is no
 * fixed offset to wait out. It does revise recent figures, which is why every
 * run rewrites the last few days rather than only appending yesterday.
 */

import supabaseAdmin from '../config/supabase.js';
import { isComposioConfigured, runGaReport } from './composio.js';
import { GA_AI_SOURCE_VALUES, classifyGaSource } from './ga-sources.js';
import { logger } from './logger.js';

/** First sync pulls this much history; later runs only refresh the tail. */
const BACKFILL_DAYS = 90;
/** GA4 revises recent data, so each run rewrites this many days. */
const REFRESH_DAYS = 3;
const UPSERT_CHUNK = 500;
/**
 * Long enough for year-over-year comparisons once a surface wants them, while
 * still bounding growth.
 */
const RETENTION_DAYS = 400;

/**
 * Pages kept per day. A large shop can have tens of thousands of pages taking
 * traffic daily; storing all of them would mean millions of rows per brand,
 * almost all of it single-session noise that no ranking of commercial value
 * would surface. The ordering below makes the cut safe rather than arbitrary.
 */
const PAGE_DAILY_LIMIT = 5000;
/** Same reasoning for a catalogue with tens of thousands of SKUs. */
const ITEM_DAILY_LIMIT = 5000;
/** Days fetched at once during a backfill. GA4 allows 10 concurrent requests. */
const DAY_CONCURRENCY = 4;

/**
 * Order pages so the daily ceiling can never drop a page that earns money.
 *
 * Sorting by sessions alone would cut a page with three sessions and two
 * purchases the moment five thousand busier pages exist — and that page is
 * precisely the one worth finding. Transactions rank first, then other key
 * events, and only then volume.
 */
const PAGE_ORDER = [
  { desc: true, metric: { metricName: 'transactions' } },
  { desc: true, metric: { metricName: 'keyEvents' } },
  { desc: true, metric: { metricName: 'sessions' } },
];

/** Same guarantee for products: whatever sold outranks whatever was browsed. */
const ITEM_ORDER = [
  { desc: true, metric: { metricName: 'itemsPurchased' } },
  { desc: true, metric: { metricName: 'itemsViewed' } },
];

const TRAFFIC_METRICS = [
  'sessions',
  'engagedSessions',
  'keyEvents',
  'totalUsers',
  'transactions',
  'purchaseRevenue',
  'userEngagementDuration',
];

const ITEM_METRICS = ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'];

/** YYYY-MM-DD in UTC, `daysAgo` days before now. */
export function utcDateString(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** GA4 returns dates as "20260721"; storage wants "2026-07-21". */
export function gaDateToIso(raw) {
  const value = String(raw ?? '');
  if (!/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function toFloat(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Rows as `{ dimensionName: value, metricName: value }` objects.
 *
 * Reading by header name rather than by position: GA4 is documented to echo
 * the requested order, but a silently reordered response would otherwise
 * write sessions into the revenue column, and nothing downstream could tell.
 */
export function readReportRows(report) {
  const dimNames = (report?.dimensionHeaders ?? []).map((h) => h.name);
  const metricNames = (report?.metricHeaders ?? []).map((h) => h.name);

  return (report?.rows ?? []).map((row) => {
    const out = {};
    (row.dimensionValues ?? []).forEach((v, i) => {
      if (dimNames[i]) out[dimNames[i]] = v?.value ?? '';
    });
    (row.metricValues ?? []).forEach((v, i) => {
      if (metricNames[i]) out[metricNames[i]] = v?.value ?? '0';
    });
    return out;
  });
}

function trafficMetricColumns(row) {
  return {
    sessions: toInt(row.sessions),
    engaged_sessions: toInt(row.engagedSessions),
    key_events: toInt(row.keyEvents),
    total_users: toInt(row.totalUsers),
    transactions: toInt(row.transactions),
    purchase_revenue: toFloat(row.purchaseRevenue),
    engagement_duration_seconds: toInt(row.userEngagementDuration),
  };
}

/** AI-sourced rows → ga_ai_traffic_stats. Rows without a date are dropped. */
export function mapAiTrafficRows(brandId, report) {
  const mapped = [];
  for (const row of readReportRows(report)) {
    const date = gaDateToIso(row.date);
    if (!date) continue;
    const source = row.sessionSource ?? '';
    mapped.push({
      brand_id: brandId,
      date,
      source,
      platform: classifyGaSource(source),
      // Path for joining the page totals, full URL for attribution.
      landing_page: row.landingPage ?? '',
      landing_page_query: row.landingPagePlusQueryString ?? '',
      ...trafficMetricColumns(row),
    });
  }
  return mapped;
}

/** Landing-page totals → ga_page_stats. */
export function mapPageRows(brandId, report) {
  const mapped = [];
  for (const row of readReportRows(report)) {
    const date = gaDateToIso(row.date);
    if (!date) continue;
    mapped.push({
      brand_id: brandId,
      date,
      landing_page: row.landingPage ?? '',
      ...trafficMetricColumns(row),
    });
  }
  return mapped;
}

/** Product rows → ga_item_stats. */
export function mapItemRows(brandId, report) {
  const mapped = [];
  for (const row of readReportRows(report)) {
    const date = gaDateToIso(row.date);
    if (!date) continue;
    mapped.push({
      brand_id: brandId,
      date,
      item_id: row.itemId ?? '',
      item_name: row.itemName ?? '',
      item_category: row.itemCategory ?? '',
      items_viewed: toInt(row.itemsViewed),
      items_added_to_cart: toInt(row.itemsAddedToCart),
      items_purchased: toInt(row.itemsPurchased),
      item_revenue: toFloat(row.itemRevenue),
    });
  }
  return mapped;
}

/**
 * Sources GA4 reported that the classification list does not know, ordered by
 * sessions. Logged rather than stored: the point is to notice a new assistant
 * showing up in real traffic and extend ga-sources.js deliberately, not to
 * accumulate every referrer a site ever sees.
 */
export function unclassifiedSources(report, { minSessions = 1, limit = 10 } = {}) {
  return readReportRows(report)
    .filter((row) => !classifyGaSource(row.sessionSource) && toInt(row.sessions) >= minSessions)
    .map((row) => ({ source: row.sessionSource ?? '', sessions: toInt(row.sessions) }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

async function upsertAll(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict });
    if (error) throw new Error(`Upsert into ${table} failed: ${error.message}`);
  }
}

/** The days a run covers, newest first, as YYYY-MM-DD. */
export function dayRange(days) {
  return Array.from({ length: days + 1 }, (_, i) => utcDateString(i));
}

/**
 * Run `task` over `items` with a small concurrency window. Backfilling 90 days
 * one request at a time would take minutes per brand for no reason; GA4 allows
 * ten concurrent requests per property and this stays well under it.
 */
async function mapWithConcurrency(items, limit, task) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.all(items.slice(i, i + limit).map(task))));
  }
  return results;
}

/**
 * Fetch one day of a report and upsert it. Returns the row count, and whether
 * the day filled its ceiling — a day that did was truncated, and the caller
 * says so rather than letting it pass as complete data.
 */
async function syncDay({
  brand,
  entityId,
  date,
  dimensions,
  metrics,
  orderBys,
  limit,
  map,
  table,
  onConflict,
}) {
  const report = await runGaReport(entityId, brand.ga_property_id, {
    dateRanges: [{ startDate: date, endDate: date }],
    dimensions,
    metrics,
    orderBys,
    limit,
  });

  const rows = map(brand.id, report);
  if (rows.length) await upsertAll(table, rows, onConflict);
  return { stored: rows.length, truncated: (report?.rowCount ?? 0) > limit };
}

/** True when this brand has never been synced, so the first run backfills. */
async function isFirstSync(brandId) {
  const { data, error } = await supabaseAdmin
    .from('ga_page_stats')
    .select('id')
    .eq('brand_id', brandId)
    .limit(1);
  // On a failed read, refresh the short window rather than re-pulling 90 days.
  if (error) return false;
  return (data ?? []).length === 0;
}

/**
 * Run a per-day report across `days`, reporting how many rows were stored and
 * on how many days the ceiling was reached.
 *
 * Per day rather than one call for the whole window, because the ceiling has
 * to mean "the top pages of that day". Applied to a 90-day range it would mean
 * "the top pages of the whole quarter", which on a large property is less than
 * a single day's worth and silently biases everything computed from it.
 */
async function syncDays({ brand, entityId, days, label, ...report }) {
  const outcomes = await mapWithConcurrency(days, DAY_CONCURRENCY, (date) =>
    syncDay({ brand, entityId, date, ...report }),
  );

  const stored = outcomes.reduce((sum, o) => sum + o.stored, 0);
  const truncatedDays = outcomes.filter((o) => o.truncated).length;
  if (truncatedDays > 0) {
    logger.warn(
      { brandId: brand.id, label, truncatedDays, limit: report.limit, stored },
      '[ga-sync] daily ceiling reached — long tail not stored for these days',
    );
  }
  return stored;
}

async function syncBrand(brand) {
  const entityId = `org_${brand.organization_id}`;
  const first = await isFirstSync(brand.id);
  const days = dayRange(first ? BACKFILL_DAYS : REFRESH_DAYS);
  const dateRanges = [{ startDate: days[days.length - 1], endDate: days[0] }];
  const metrics = TRAFFIC_METRICS.map((name) => ({ name }));

  // The AI slice is small enough to take in one call — a live property
  // produced 96 rows over 90 days — so it keeps the full entry URL and needs
  // no ceiling.
  const aiReport = await runGaReport(entityId, brand.ga_property_id, {
    dateRanges,
    dimensions: [
      { name: 'date' },
      { name: 'sessionSource' },
      { name: 'landingPage' },
      { name: 'landingPagePlusQueryString' },
    ],
    metrics,
    // An explicit value list, not a pattern — see ga-sources.js for why.
    dimensionFilter: {
      filter: {
        fieldName: 'sessionSource',
        inListFilter: { values: GA_AI_SOURCE_VALUES, caseSensitive: false },
      },
    },
    orderBys: PAGE_ORDER,
    limit: 100_000,
  });
  const aiMapped = mapAiTrafficRows(brand.id, aiReport);
  if (aiMapped.length) {
    await upsertAll('ga_ai_traffic_stats', aiMapped, 'brand_id,date,source,landing_page_query');
  }
  const aiRows = aiMapped.length;

  const pageRows = await syncDays({
    brand,
    entityId,
    days,
    label: 'pages',
    table: 'ga_page_stats',
    onConflict: 'brand_id,date,landing_page',
    map: mapPageRows,
    dimensions: [{ name: 'date' }, { name: 'landingPage' }],
    metrics,
    orderBys: PAGE_ORDER,
    limit: PAGE_DAILY_LIMIT,
  });

  // Ecommerce is optional. A property without it returns no rows, and a
  // property that rejects the item dimensions must not fail the whole brand —
  // the traffic tables above are already written by this point.
  let itemRows = 0;
  try {
    itemRows = await syncDays({
      brand,
      entityId,
      days,
      label: 'items',
      table: 'ga_item_stats',
      onConflict: 'brand_id,date,item_id,item_name',
      map: mapItemRows,
      dimensions: [
        { name: 'date' },
        { name: 'itemName' },
        { name: 'itemId' },
        { name: 'itemCategory' },
      ],
      metrics: ITEM_METRICS.map((name) => ({ name })),
      orderBys: ITEM_ORDER,
      limit: ITEM_DAILY_LIMIT,
    });
  } catch (err) {
    logger.info(
      { brandId: brand.id, err: err.message },
      '[ga-sync] item report unavailable — property has no ecommerce data',
    );
  }

  // Source discovery: one cheap call (no page dimension) over the same window
  // so a newly popular assistant shows up in the logs instead of silently
  // failing the inList filter above forever.
  try {
    const report = await runGaReport(entityId, brand.ga_property_id, {
      dateRanges,
      dimensions: [{ name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ desc: true, metric: { metricName: 'sessions' } }],
      limit: 500,
    });
    const unknown = unclassifiedSources(report);
    if (unknown.length) {
      logger.debug({ brandId: brand.id, unknown }, '[ga-sync] unclassified sources observed');
    }
  } catch (err) {
    logger.debug({ brandId: brand.id, err: err.message }, '[ga-sync] source discovery failed');
  }

  return { first, aiRows, pageRows, itemRows };
}

async function prune(table) {
  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .lt('date', utcDateString(RETENTION_DAYS));
  if (error) logger.warn({ err: error, table }, '[ga-sync] retention prune failed');
}

/**
 * Sync every eligible brand; optionally scoped to one organization (the
 * manual trigger). Returns per-brand counts.
 */
export async function runGaSync({ organizationId } = {}) {
  if (!isComposioConfigured('google-analytics')) return { synced: 0, skipped: 0, results: [] };

  // Orgs with a live connection…
  let connQuery = supabaseAdmin
    .from('integration_connections')
    .select('organization_id')
    .eq('provider', 'google-analytics')
    .eq('status', 'connected');
  if (organizationId) connQuery = connQuery.eq('organization_id', organizationId);
  const { data: connections, error: connError } = await connQuery;
  if (connError) throw new Error(connError.message);
  const connectedOrgIds = [...new Set((connections || []).map((c) => c.organization_id))];
  if (connectedOrgIds.length === 0) return { synced: 0, skipped: 0, results: [] };

  // …and their active brands with a mapped property.
  const { data: brands, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id, ga_property_id')
    .eq('is_active', true)
    .not('ga_property_id', 'is', null)
    .in('organization_id', connectedOrgIds);
  if (brandError) throw new Error(brandError.message);

  const results = [];
  let synced = 0;
  let skipped = 0;
  for (const brand of brands || []) {
    try {
      const counts = await syncBrand(brand);
      results.push({ brandId: brand.id, ...counts });
      synced++;
    } catch (err) {
      logger.error({ err, brandId: brand.id }, '[ga-sync] brand sync failed');
      results.push({ brandId: brand.id, error: err.message });
      skipped++;
    }
  }

  for (const table of ['ga_ai_traffic_stats', 'ga_page_stats', 'ga_item_stats']) {
    await prune(table);
  }

  logger.info({ synced, skipped, total: (brands || []).length }, '[ga-sync] completed');
  return { synced, skipped, results };
}
