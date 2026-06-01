'use server';

import { createClient } from '@/lib/supabase/server';
import { expandDateToEndOfDay } from '@/lib/dates';

/**
 * Server actions for the Shopping dashboard page. Reads from the
 * normalized `prompt_result_shopping_cards` table introduced in #103.
 *
 * Org-scoping is enforced via the calling user's auth session — every
 * query joins or filters on `brand_id`, and RLS on
 * `prompt_result_shopping_cards` already restricts to the caller's
 * organization. The action just adds the matching brand filter to keep
 * results scoped to a single brand at a time.
 */

export type ShoppingDatePreset = '7d' | '30d' | '90d' | 'all';

export interface ShoppingFilters {
  datePreset: ShoppingDatePreset;
  /** ISO date strings; only used when datePreset === 'all' wants override. */
  dateFrom?: string;
  dateTo?: string;
  /** Scraper / platform ids, e.g. `['perplexity-web', 'google-aimode']`. */
  platforms?: string[];
  /** Region codes. */
  regions?: string[];
}

export interface ShoppingKpis {
  shoppingCardRate: number;
  shoppingCardRateSampleSize: number;
  productsSurfaced: number;
  shoppingSov: number;
  topMerchant: { domain: string; cardCount: number } | null;
}

export interface PlatformCardRatePoint {
  platform: string;
  cardRate: number;
  totalResults: number;
}

export interface OwnPresenceTrendPoint {
  date: string;
  ownCards: number;
  totalCards: number;
}

export interface ShoppingChartData {
  platformCardRate: PlatformCardRatePoint[];
  ownPresenceTrend: OwnPresenceTrendPoint[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function resolveDateRange(filters: ShoppingFilters): {
  from: string | undefined;
  to: string | undefined;
} {
  const now = new Date();
  if (filters.datePreset === 'all') {
    return { from: filters.dateFrom, to: filters.dateTo };
  }
  const days = filters.datePreset === '7d' ? 7 : filters.datePreset === '30d' ? 30 : 90;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: undefined };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ── KPI query ─────────────────────────────────────────────────────────────────

/**
 * Build the four overview KPIs in a single round-trip per metric.
 *
 * `shoppingCardRate` is the only KPI that needs to know about prompts
 * that returned *zero* cards, so it queries `prompt_results` directly to
 * get the denominator. Everything else aggregates over the normalized
 * `prompt_result_shopping_cards` table.
 */
export async function getShoppingKpis(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingKpis> {
  const supabase = await createClient();
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);

  // ── 1. Shopping card rate ──
  //   numerator   = prompt_results with at least one card
  //   denominator = prompt_results in the window
  // Both queries hit only `prompt_results.id` so they stay cheap.
  let totalQuery = supabase
    .from('prompt_results')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);
  if (from) totalQuery = totalQuery.gte('created_at', from);
  if (expandedTo) totalQuery = totalQuery.lte('created_at', expandedTo);
  if (filters.platforms?.length) totalQuery = totalQuery.in('platform', filters.platforms);
  if (filters.regions?.length) totalQuery = totalQuery.in('region', filters.regions);

  let cardBearingQuery = supabase
    .from('prompt_results')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .not('shopping_cards', 'is', null)
    .filter('shopping_cards', 'neq', '[]');
  if (from) cardBearingQuery = cardBearingQuery.gte('created_at', from);
  if (expandedTo) cardBearingQuery = cardBearingQuery.lte('created_at', expandedTo);
  if (filters.platforms?.length)
    cardBearingQuery = cardBearingQuery.in('platform', filters.platforms);
  if (filters.regions?.length) cardBearingQuery = cardBearingQuery.in('region', filters.regions);

  // ── 2-3. Cards by role for products surfaced + SoV ──
  let cardsQuery = supabase
    .from('prompt_result_shopping_cards')
    .select('matched_brand_role, merchant_domain', { count: 'exact' })
    .eq('brand_id', brandId);
  if (from) cardsQuery = cardsQuery.gte('created_at', from);
  if (expandedTo) cardsQuery = cardsQuery.lte('created_at', expandedTo);
  if (filters.platforms?.length) cardsQuery = cardsQuery.in('platform', filters.platforms);
  if (filters.regions?.length) cardsQuery = cardsQuery.in('region', filters.regions);

  const [
    { count: totalResults },
    { count: cardBearingResults },
    { data: cards, error: cardsError },
  ] = await Promise.all([totalQuery, cardBearingQuery, cardsQuery]);

  if (cardsError) throw new Error(cardsError.message);

  const shoppingCardRate =
    totalResults && totalResults > 0 ? (cardBearingResults ?? 0) / totalResults : 0;

  const rows = (cards ?? []) as Array<{
    matched_brand_role: 'own' | 'competitor' | 'other';
    merchant_domain: string | null;
  }>;

  let ownCount = 0;
  const merchantTotals = new Map<string, number>();
  for (const row of rows) {
    if (row.matched_brand_role === 'own') {
      ownCount += 1;
      if (row.merchant_domain) {
        merchantTotals.set(row.merchant_domain, (merchantTotals.get(row.merchant_domain) ?? 0) + 1);
      }
    }
  }

  const totalCards = rows.length;
  const shoppingSov = totalCards > 0 ? ownCount / totalCards : 0;

  let topMerchant: { domain: string; cardCount: number } | null = null;
  for (const [domain, count] of merchantTotals.entries()) {
    if (!topMerchant || count > topMerchant.cardCount) {
      topMerchant = { domain, cardCount: count };
    }
  }

  return {
    shoppingCardRate,
    shoppingCardRateSampleSize: totalResults ?? 0,
    productsSurfaced: ownCount,
    shoppingSov,
    topMerchant,
  };
}

// ── Chart query ───────────────────────────────────────────────────────────────

/**
 * Two compact chart payloads for the Overview tab:
 *
 *  - `platformCardRate` — bar chart, one row per platform, `cardRate` is
 *    `cards-bearing prompts / total prompts on that platform`.
 *  - `ownPresenceTrend` — line chart, one bucket per UTC day for the
 *    last 30 days, with own + total card counts.
 */
export async function getShoppingChartData(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingChartData> {
  const supabase = await createClient();
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);

  // ── Platform card rate ──
  // Pulls platform + a boolean "has cards" off prompt_results. Aggregating
  // in JS is cheap at this row count and avoids defining another RPC.
  let pageQuery = supabase
    .from('prompt_results')
    .select('platform, shopping_cards')
    .eq('brand_id', brandId);
  if (from) pageQuery = pageQuery.gte('created_at', from);
  if (expandedTo) pageQuery = pageQuery.lte('created_at', expandedTo);
  if (filters.platforms?.length) pageQuery = pageQuery.in('platform', filters.platforms);
  if (filters.regions?.length) pageQuery = pageQuery.in('region', filters.regions);

  const { data: platformRows, error: platformError } = await pageQuery;
  if (platformError) throw new Error(platformError.message);

  const perPlatform = new Map<string, { total: number; withCards: number }>();
  for (const row of (platformRows ?? []) as Array<{
    platform: string;
    shopping_cards: unknown;
  }>) {
    const slot = perPlatform.get(row.platform) ?? { total: 0, withCards: 0 };
    slot.total += 1;
    if (Array.isArray(row.shopping_cards) && row.shopping_cards.length > 0) {
      slot.withCards += 1;
    }
    perPlatform.set(row.platform, slot);
  }
  const platformCardRate: PlatformCardRatePoint[] = [...perPlatform.entries()]
    .filter(([, slot]) => slot.total > 0)
    .map(([platform, slot]) => ({
      platform,
      cardRate: slot.withCards / slot.total,
      totalResults: slot.total,
    }))
    .sort((a, b) => b.cardRate - a.cardRate);

  // ── 30-day own-presence trend ──
  // Always 30d regardless of filter so the trend chart shows a stable
  // window. Same brand + platform + region filters apply.
  const trendFrom = daysAgoIso(30);
  let trendQuery = supabase
    .from('prompt_result_shopping_cards')
    .select('matched_brand_role, created_at')
    .eq('brand_id', brandId)
    .gte('created_at', trendFrom);
  if (filters.platforms?.length) trendQuery = trendQuery.in('platform', filters.platforms);
  if (filters.regions?.length) trendQuery = trendQuery.in('region', filters.regions);

  const { data: trendRows, error: trendError } = await trendQuery;
  if (trendError) throw new Error(trendError.message);

  // Bucket by UTC day.
  const buckets = new Map<string, { ownCards: number; totalCards: number }>();
  for (const row of (trendRows ?? []) as Array<{
    matched_brand_role: 'own' | 'competitor' | 'other';
    created_at: string;
  }>) {
    const day = row.created_at.slice(0, 10);
    const slot = buckets.get(day) ?? { ownCards: 0, totalCards: 0 };
    slot.totalCards += 1;
    if (row.matched_brand_role === 'own') slot.ownCards += 1;
    buckets.set(day, slot);
  }

  // Fill in zero buckets so the line chart doesn't skip empty days.
  const ownPresenceTrend: OwnPresenceTrendPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slot = buckets.get(date) ?? { ownCards: 0, totalCards: 0 };
    ownPresenceTrend.push({
      date,
      ownCards: slot.ownCards,
      totalCards: slot.totalCards,
    });
  }

  return { platformCardRate, ownPresenceTrend };
}

/**
 * Collected once at page load so the filter bar shows only platform / region
 * values that actually appear in this brand's data.
 */
export async function getShoppingFilterOptions(brandId: string): Promise<{
  platforms: string[];
  regions: string[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prompt_results')
    .select('platform, region')
    .eq('brand_id', brandId)
    .not('shopping_cards', 'is', null)
    .limit(2000);
  if (error) throw new Error(error.message);

  const platforms = new Set<string>();
  const regions = new Set<string>();
  for (const row of (data ?? []) as Array<{ platform: string | null; region: string | null }>) {
    if (row.platform) platforms.add(row.platform);
    if (row.region) regions.add(row.region);
  }
  return {
    platforms: [...platforms].sort(),
    regions: [...regions].sort(),
  };
}
