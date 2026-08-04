/**
 * Daily Search Console sync (#644).
 *
 * For every active brand mapped to a GSC property (whose org connection is
 * live), pulls the last SYNC_WINDOW_DAYS of per-query daily stats through
 * Composio and upserts them into gsc_query_stats. Parameters are fully
 * deterministic — no LLM anywhere in this path. Per-brand failures are
 * logged and skipped; one broken property never aborts the run.
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

async function syncBrand(brand) {
  const entityId = `org_${brand.organization_id}`;
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await queryGscSearchAnalytics(entityId, {
      site_url: brand.gsc_property,
      start_date: utcDateString(SYNC_WINDOW_DAYS),
      end_date: utcDateString(0),
      dimensions: ['query', 'date'],
      search_type: 'web',
      row_limit: ROW_LIMIT,
      start_row: page * ROW_LIMIT,
      aggregation_type: 'auto',
      data_state: 'final',
      dimension_filter_groups: [],
    });

    const mapped = mapAnalyticsRows(brand.id, rows);
    for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
      const chunk = mapped.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabaseAdmin
        .from('gsc_query_stats')
        .upsert(chunk, { onConflict: 'brand_id,query,date' });
      if (error) throw new Error(`Upsert failed: ${error.message}`);
    }
    total += mapped.length;

    // A short page means we've reached the end of the result set.
    if (rows.length < ROW_LIMIT) return total;
  }

  logger.warn(
    { brandId: brand.id, total, maxRows: MAX_PAGES * ROW_LIMIT },
    '[gsc-sync] page cap reached — result set truncated',
  );
  return total;
}

/**
 * Sync every eligible brand; optionally scoped to one organization (the
 * manual trigger). Returns per-brand counts.
 */
export async function runGscSync({ organizationId } = {}) {
  if (!isComposioConfigured()) return { synced: 0, skipped: 0, results: [] };

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
  const { data: brands, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id, gsc_property')
    .eq('is_active', true)
    .not('gsc_property', 'is', null)
    .in('organization_id', connectedOrgIds);
  if (brandError) throw new Error(brandError.message);

  const results = [];
  let synced = 0;
  let skipped = 0;
  for (const brand of brands || []) {
    try {
      const count = await syncBrand(brand);
      results.push({ brandId: brand.id, rows: count });
      synced++;
    } catch (err) {
      logger.error({ err, brandId: brand.id }, '[gsc-sync] brand sync failed');
      results.push({ brandId: brand.id, error: err.message });
      skipped++;
    }
  }

  logger.info({ synced, skipped, total: (brands || []).length }, '[gsc-sync] completed');
  return { synced, skipped, results };
}
