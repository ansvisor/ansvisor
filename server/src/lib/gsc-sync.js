/**
 * Daily Search Console sync (#644).
 *
 * For every active brand mapped to a GSC property (whose org connection is
 * live), pulls the last SYNC_WINDOW_DAYS of per-query daily stats through
 * Composio and upserts them into gsc_query_stats, and the same per page into
 * gsc_page_stats (AT-008: which pages lose clicks while impressions rise). A
 * brand's page sync reads PAGE_BACKFILL_DAYS until one gets through them all
 * for its property, so a 90-day range has a period before it (pagesSyncPlan).
 * Parameters are fully deterministic — no LLM anywhere in
 * this path. Per-brand failures are logged and skipped; one broken property
 * never aborts the run.
 */

import supabaseAdmin from '../config/supabase.js';
import { isComposioConfigured, queryGscSearchAnalytics } from './composio.js';
import { logger } from './logger.js';

const SYNC_WINDOW_DAYS = 28;
const ROW_LIMIT = 5000;
// GSC returns rows sorted by clicks desc, so pagination walks the long tail
// of low-volume queries. The page cap is a defensive ceiling (25k rows/brand)
// — hitting it is logged, never silent.
const MAX_PAGES = 5;
const UPSERT_CHUNK = 500;
// Page stats (AT-008): the first sync reads 190 days — a 90-day range and
// the 90 days before it, plus Google's delay — in SYNC_WINDOW_DAYS steps so
// each step keeps the row cap; the daily prune keeps as many.
export const PAGE_BACKFILL_DAYS = 190;

/** YYYY-MM-DD in UTC, `daysAgo` days before now. */
function utcDateString(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Map raw GSC rows ({keys:[query,date],...}) to gsc_query_stats rows. */
export function mapAnalyticsRows(brandId, rows) {
  const mapped = [];
  for (const r of rows || []) {
    const [query, date] = r.keys || [];
    if (!query || !date) continue;
    mapped.push({
      brand_id: brandId,
      query,
      date,
      clicks: Math.round(r.clicks || 0),
      impressions: Math.round(r.impressions || 0),
      ctr: r.ctr || 0,
      position: r.position || 0,
    });
  }
  return mapped;
}

/** Map raw GSC rows ({keys:[page,date],...}) to gsc_page_stats rows (AT-008). */
export function mapPageRows(brandId, rows) {
  return mapAnalyticsRows(brandId, rows).map(({ query, ...row }) => ({ ...row, page: query }));
}

/**
 * The windows a brand's page sync reads, as days ago: the last
 * SYNC_WINDOW_DAYS once its PAGE_BACKFILL_DAYS have been read, else those in
 * SYNC_WINDOW_DAYS steps.
 */
export function pageSyncWindows(backfilled) {
  if (backfilled) return [{ from: SYNC_WINDOW_DAYS, to: 0 }];
  const windows = [];
  for (let to = 0; to < PAGE_BACKFILL_DAYS; to += SYNC_WINDOW_DAYS + 1) {
    windows.push({ from: Math.min(to + SYNC_WINDOW_DAYS, PAGE_BACKFILL_DAYS), to });
  }
  return windows;
}

/**
 * Pull one window of daily rows by `dimension` and upsert them, paging
 * through the result set up to the row cap. Returns the rows written.
 */
async function pullWindow(brand, { dimension, table, onConflict, map }, { from, to }) {
  const entityId = `org_${brand.organization_id}`;
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await queryGscSearchAnalytics(entityId, {
      site_url: brand.gsc_property,
      start_date: utcDateString(from),
      end_date: utcDateString(to),
      dimensions: [dimension, 'date'],
      search_type: 'web',
      row_limit: ROW_LIMIT,
      start_row: page * ROW_LIMIT,
      aggregation_type: 'auto',
      data_state: 'final',
      dimension_filter_groups: [],
    });

    const mapped = map(brand.id, rows);
    for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
      const chunk = mapped.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabaseAdmin.from(table).upsert(chunk, { onConflict });
      if (error) throw new Error(`Upsert failed: ${error.message}`);
    }
    total += mapped.length;

    // A short page means we've reached the end of the result set.
    if (rows.length < ROW_LIMIT) return total;
  }

  logger.warn(
    { brandId: brand.id, dimension, total, maxRows: MAX_PAGES * ROW_LIMIT },
    '[gsc-sync] page cap reached — result set truncated',
  );
  return total;
}

const QUERIES = {
  dimension: 'query',
  table: 'gsc_query_stats',
  onConflict: 'brand_id,query,date',
  map: mapAnalyticsRows,
};
const PAGES = {
  dimension: 'page',
  table: 'gsc_page_stats',
  onConflict: 'brand_id,page,date',
  map: mapPageRows,
};

async function syncBrand(brand) {
  return pullWindow(brand, QUERIES, { from: SYNC_WINDOW_DAYS, to: 0 });
}

/**
 * What a brand's page sync does (AT-008). Its PAGE_BACKFILL_DAYS are read
 * once per Search Console property: until a sync gets through them all
 * (gsc_pages_backfilled_property names the property), every sync reads them
 * again, so one cut short resumes the next day rather than leaving the brand
 * 28 days of history, and its 90-day range `incomplete`, for months. A brand
 * mapped to another property drops the old one's pages first. Then the last
 * SYNC_WINDOW_DAYS.
 */
export function pagesSyncPlan(brand) {
  const backfilled = brand.gsc_pages_backfilled_property === brand.gsc_property;
  return {
    windows: pageSyncWindows(backfilled),
    dropOldPages: !backfilled && brand.gsc_pages_backfilled_property != null,
    markBackfilled: !backfilled,
  };
}

/** The brand's page stats (AT-008), as pagesSyncPlan says. */
async function syncBrandPages(brand) {
  const plan = pagesSyncPlan(brand);
  if (plan.dropOldPages) {
    const { error } = await supabaseAdmin.from('gsc_page_stats').delete().eq('brand_id', brand.id);
    if (error) throw new Error(error.message);
  }
  let total = 0;
  for (const window of plan.windows) {
    total += await pullWindow(brand, PAGES, window);
  }
  if (plan.markBackfilled) {
    const { error } = await supabaseAdmin
      .from('brands')
      .update({ gsc_pages_backfilled_property: brand.gsc_property })
      .eq('id', brand.id);
    if (error) throw new Error(error.message);
  }
  return total;
}

/**
 * Sync every eligible brand; optionally scoped to one organization (the
 * manual trigger) or to one brand (right after its property is mapped).
 * Returns per-brand counts.
 */
export async function runGscSync({ organizationId, brandId } = {}) {
  if (!isComposioConfigured('google-search-console')) return { synced: 0, skipped: 0, results: [] };

  // Orgs with a live connection…
  let connQuery = supabaseAdmin
    .from('integration_connections')
    .select('organization_id')
    .eq('provider', 'google-search-console')
    .eq('status', 'connected');
  if (organizationId) connQuery = connQuery.eq('organization_id', organizationId);
  const { data: connections, error: connError } = await connQuery;
  if (connError) throw new Error(connError.message);
  const connectedOrgIds = [...new Set((connections || []).map((c) => c.organization_id))];
  if (connectedOrgIds.length === 0) return { synced: 0, skipped: 0, results: [] };

  // …and their active brands with a mapped property.
  let brandQuery = supabaseAdmin
    .from('brands')
    .select('id, organization_id, gsc_property, gsc_pages_backfilled_property')
    .eq('is_active', true)
    .not('gsc_property', 'is', null)
    .in('organization_id', connectedOrgIds);
  if (brandId) brandQuery = brandQuery.eq('id', brandId);
  const { data: brands, error: brandError } = await brandQuery;
  if (brandError) throw new Error(brandError.message);

  const results = [];
  let synced = 0;
  let skipped = 0;
  for (const brand of brands || []) {
    try {
      const count = await syncBrand(brand);
      // The page stats are a step of their own: failing there leaves the
      // query rows synced.
      let pages = null;
      try {
        pages = await syncBrandPages(brand);
      } catch (err) {
        logger.error({ err, brandId: brand.id }, '[gsc-sync] page sync failed');
      }
      results.push({ brandId: brand.id, rows: count, pages });
      synced++;
    } catch (err) {
      logger.error({ err, brandId: brand.id }, '[gsc-sync] brand sync failed');
      results.push({ brandId: brand.id, error: err.message });
      skipped++;
    }
  }

  // Retention (#648): the suggestion pipeline reads a 28-day window; 90 days
  // keeps room for trend features without unbounded growth. Table-wide, so a
  // single-brand sync leaves it to the daily run.
  if (!brandId) {
    const { error: pruneError } = await supabaseAdmin
      .from('gsc_query_stats')
      .delete()
      .lt('date', utcDateString(90));
    if (pruneError) {
      logger.warn({ err: pruneError }, '[gsc-sync] retention prune failed');
    }
    const { error: pagePruneError } = await supabaseAdmin
      .from('gsc_page_stats')
      .delete()
      .lt('date', utcDateString(PAGE_BACKFILL_DAYS));
    if (pagePruneError) {
      logger.warn({ err: pagePruneError }, '[gsc-sync] page retention prune failed');
    }
  }

  logger.info({ synced, skipped, total: (brands || []).length }, '[gsc-sync] completed');
  return { synced, skipped, results };
}
