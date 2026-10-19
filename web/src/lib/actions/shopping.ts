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
    .limit(2000);

  if (error || !data) {
    return { platforms: [], regions: [] };
  }

  const platforms = Array.from(new Set(data.map((d) => d.platform).filter(Boolean))) as string[];
  const regions = Array.from(new Set(data.map((d) => d.region).filter(Boolean))) as string[];

  return { platforms, regions };
}

// ── My Products / Competitors tab actions ──────────────────────────────────────

export interface ShoppingProductAppearance {
  id: string;
  prompt_id: string;
  prompt_text: string;
  created_at: string;
  region: string | null;
  platform: string;
  raw: unknown;
  merchant_url: string | null;
  merchant_domain: string | null;
}

export interface ShoppingProduct {
  product_title: string;
  product_brand: string | null;
  impressions: number;
  platforms: string[];
  regions: string[];
  last_seen: string;
  last_price: number | null;
  price_currency: string | null;
  top_merchant: string | null;
  image_url: string | null;
  appearances: ShoppingProductAppearance[];
  competitor_name?: string;
}

export interface CompetitorShoppingSummary {
  competitor_id: string;
  name: string;
  domain: string;
  distinct_products_count: number;
  card_count: number;
  sov: number;
}

interface CardRow {
  id: string;
  created_at: string;
  platform: string;
  region: string | null;
  product_title: string | null;
  product_brand: string | null;
  price_amount: number | string | null;
  price_currency: string | null;
  image_url: string | null;
  merchant_url: string | null;
  merchant_domain: string | null;
  raw: unknown;
  matched_brand_id: string | null;
  prompt_results: {
    prompt: {
      id: string;
      text: string;
    } | null;
  } | null;
}

function getProductKey(brand: string | null, title: string | null): string {
  const cleanBrand = (brand ?? '').trim().toLowerCase();
  const cleanTitle = (title ?? '').trim().toLowerCase();
  return `${cleanBrand}::${cleanTitle}`;
}

function aggregateProducts(
  cards: CardRow[],
  competitorMap?: Map<string, { id: string; name: string; domain: string }>,
): ShoppingProduct[] {
  const groups = new Map<
    string,
    {
      product_title: string;
      product_brand: string | null;
      matched_brand_id: string | null;
      appearances: CardRow[];
      merchantDomains: Map<string, number>;
    }
  >();

  for (const card of cards) {
    const title = card.product_title || 'Unknown Product';
    const brandName = card.product_brand || null;
    const key = getProductKey(brandName, title);

    let group = groups.get(key);
    if (!group) {
      group = {
        product_title: title,
        product_brand: brandName,
        matched_brand_id: card.matched_brand_id,
        appearances: [],
        merchantDomains: new Map(),
      };
      groups.set(key, group);
    }

    group.appearances.push(card);
    if (card.merchant_domain) {
      group.merchantDomains.set(
        card.merchant_domain,
        (group.merchantDomains.get(card.merchant_domain) ?? 0) + 1,
      );
    }
  }

  const result: ShoppingProduct[] = [];

  for (const group of groups.values()) {
    const sortedApps = [...group.appearances].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const latest = sortedApps[0];

    let top_merchant: string | null = null;
    let maxCount = 0;
    for (const [domain, count] of group.merchantDomains.entries()) {
      if (count > maxCount) {
        maxCount = count;
        top_merchant = domain;
      }
    }

    const platforms = [...new Set(group.appearances.map((a) => a.platform).filter(Boolean))];
    const regions = [
      ...new Set(group.appearances.map((a) => a.region).filter((r): r is string => !!r)),
    ];
    const heroImage = group.appearances.find((a) => a.image_url)?.image_url || null;

    const competitor_name =
      group.matched_brand_id && competitorMap
        ? competitorMap.get(group.matched_brand_id)?.name
        : undefined;

    const mappedApps: ShoppingProductAppearance[] = sortedApps.map((a) => {
      let promptText = 'Unknown Prompt';
      let promptId = '';
      if (a.prompt_results?.prompt) {
        promptText = a.prompt_results.prompt.text;
        promptId = a.prompt_results.prompt.id;
      }
      return {
        id: a.id,
        prompt_id: promptId,
        prompt_text: promptText,
        created_at: a.created_at,
        region: a.region,
        platform: a.platform,
        raw: a.raw,
        merchant_url: a.merchant_url,
        merchant_domain: a.merchant_domain,
      };
    });

    result.push({
      product_title: group.product_title,
      product_brand: group.product_brand,
      impressions: group.appearances.length,
      platforms,
      regions,
      last_seen: latest.created_at,
      last_price: latest.price_amount ? Number(latest.price_amount) : null,
      price_currency: latest.price_currency || null,
      top_merchant,
      image_url: heroImage,
      appearances: mappedApps,
      competitor_name,
    });
  }

  return result;
}

export async function getOwnProducts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingProduct[]> {
  const supabase = await createClient();
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);

  let query = supabase
    .from('prompt_result_shopping_cards')
    .select(
      `
      id,
      created_at,
      platform,
      region,
      product_title,
      product_brand,
      price_amount,
      price_currency,
      image_url,
      merchant_url,
      merchant_domain,
      raw,
      matched_brand_id,
      prompt_results:prompt_result_id (
        prompt:prompt_id (
          id,
          text
        )
      )
    `,
    )
    .eq('brand_id', brandId)
    .eq('matched_brand_role', 'own');

  if (from) query = query.gte('created_at', from);
  if (expandedTo) query = query.lte('created_at', expandedTo);
  if (filters.platforms?.length) query = query.in('platform', filters.platforms);
  if (filters.regions?.length) query = query.in('region', filters.regions);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return aggregateProducts(data || []);
}

export async function getCompetitorProducts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingProduct[]> {
  const supabase = await createClient();
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);

  const { data: competitorsData, error: compError } = await supabase
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);

  if (compError) throw new Error(compError.message);
  const competitorMap = new Map((competitorsData ?? []).map((c) => [c.id, c]));

  let query = supabase
    .from('prompt_result_shopping_cards')
    .select(
      `
      id,
      created_at,
      platform,
      region,
      product_title,
      product_brand,
      price_amount,
      price_currency,
      image_url,
      merchant_url,
      merchant_domain,
      raw,
      matched_brand_id,
      prompt_results:prompt_result_id (
        prompt:prompt_id (
          id,
          text
        )
      )
    `,
    )
    .eq('brand_id', brandId)
    .eq('matched_brand_role', 'competitor');

  if (from) query = query.gte('created_at', from);
  if (expandedTo) query = query.lte('created_at', expandedTo);
  if (filters.platforms?.length) query = query.in('platform', filters.platforms);
  if (filters.regions?.length) query = query.in('region', filters.regions);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return aggregateProducts(data || [], competitorMap);
}

export async function getCompetitorSummary(
  brandId: string,
  filters: ShoppingFilters,
): Promise<CompetitorShoppingSummary[]> {
  const supabase = await createClient();
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);

  let totalCardsQuery = supabase
    .from('prompt_result_shopping_cards')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);

  if (from) totalCardsQuery = totalCardsQuery.gte('created_at', from);
  if (expandedTo) totalCardsQuery = totalCardsQuery.lte('created_at', expandedTo);
  if (filters.platforms?.length)
    totalCardsQuery = totalCardsQuery.in('platform', filters.platforms);
  if (filters.regions?.length) totalCardsQuery = totalCardsQuery.in('region', filters.regions);

  let competitorCardsQuery = supabase
    .from('prompt_result_shopping_cards')
    .select('matched_brand_id, product_title, product_brand')
    .eq('brand_id', brandId)
    .eq('matched_brand_role', 'competitor');

  if (from) competitorCardsQuery = competitorCardsQuery.gte('created_at', from);
  if (expandedTo) competitorCardsQuery = competitorCardsQuery.lte('created_at', expandedTo);
  if (filters.platforms?.length)
    competitorCardsQuery = competitorCardsQuery.in('platform', filters.platforms);
  if (filters.regions?.length)
    competitorCardsQuery = competitorCardsQuery.in('region', filters.regions);

  const competitorsQuery = supabase
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);

  const [
    { count: totalCount },
    { data: competitorCards, error: cardsError },
    { data: competitors, error: compError },
  ] = await Promise.all([totalCardsQuery, competitorCardsQuery, competitorsQuery]);

  if (cardsError) throw new Error(cardsError.message);
  if (compError) throw new Error(compError.message);

  const total = totalCount || 0;
  const compCards = competitorCards || [];
  const compList = competitors || [];

  const competitorStats = new Map<
    string,
    {
      card_count: number;
      distinctProducts: Set<string>;
    }
  >();

  for (const c of compList) {
    competitorStats.set(c.id, { card_count: 0, distinctProducts: new Set() });
  }

  for (const card of compCards) {
    if (!card.matched_brand_id) continue;
    let stats = competitorStats.get(card.matched_brand_id);
    if (!stats) {
      stats = { card_count: 0, distinctProducts: new Set() };
      competitorStats.set(card.matched_brand_id, stats);
    }
    stats.card_count += 1;
    const title = card.product_title || 'Unknown Product';
    const brandName = card.product_brand || '';
    stats.distinctProducts.add(getProductKey(brandName, title));
  }

  return compList
    .map((c) => {
      const stats = competitorStats.get(c.id) || { card_count: 0, distinctProducts: new Set() };
      return {
        competitor_id: c.id,
        name: c.name,
        domain: c.domain,
        distinct_products_count: stats.distinctProducts.size,
        card_count: stats.card_count,
        sov: total > 0 ? stats.card_count / total : 0,
      };
    })
    .sort((a, b) => b.card_count - a.card_count);
}

export interface ShoppingCardAppearance {
  id: string;
  title: string;
  price: string;
  imageUrl: string;
  merchantUrl: string;
}

export interface ShoppingPromptAppearance {
  promptResultId: string;
  timestamp: string;
  platform: string;
  region: string;
  cards: ShoppingCardAppearance[];
}

export interface CardEligiblePromptRow {
  promptId: string;
  promptText: string;
  topic: string;
  platforms: string[];
  totalCards: number;
  ownCardsCount: number;
  competitorCardsCount: number;
  otherCardsCount: number;
  lastTriggered: string; // ISO string
  appearances: ShoppingPromptAppearance[];
}

export interface CardEligiblePromptsResponse {
  prompts: CardEligiblePromptRow[];
  triggerRate: number;
  totalTrackedPrompts: number;
}

function formatPrice(amount: number | null, currency: string | null): string {
  if (amount == null) return '—';
  const formattedAmount = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency || '';
  const isSymbolWord = symbol.length > 1;
  return isSymbolWord ? `${formattedAmount} ${symbol}` : `${symbol}${formattedAmount}`;
}

export async function getCardEligiblePrompts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<CardEligiblePromptsResponse> {
  const supabase = await createClient();
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);

  // 1. Get total number of tracked prompts for the brand
  const { count: totalTrackedPrompts, error: countError } = await supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)', { count: 'exact', head: true })
    .eq('prompt_sets.brand_id', brandId);

  if (countError) throw new Error(countError.message);

  // 2. Fetch all normalized shopping cards matching the brand and filters
  let query = supabase
    .from('prompt_result_shopping_cards')
    .select(
      `
      id,
      matched_brand_role,
      platform,
      region,
      created_at,
      product_title,
      price_amount,
      price_currency,
      image_url,
      merchant_url,
      prompt_result_id,
      prompt_results!inner (
        id,
        prompt_id,
        prompts!inner (
          id,
          text,
          category,
          topic_id,
          topics (
            name
          )
        )
      )
    `,
    )
    .eq('brand_id', brandId);

  if (from) query = query.gte('created_at', from);
  if (expandedTo) query = query.lte('created_at', expandedTo);
  if (filters.platforms?.length) query = query.in('platform', filters.platforms);
  if (filters.regions?.length) query = query.in('region', filters.regions);

  const { data: cards, error: cardsError } = await query;
  if (cardsError) throw new Error(cardsError.message);

  const promptMap = new Map<
    string,
    {
      promptId: string;
      promptText: string;
      topic: string;
      platforms: Set<string>;
      totalCards: number;
      ownCardsCount: number;
      competitorCardsCount: number;
      otherCardsCount: number;
      lastTriggered: Date;
      appearancesMap: Map<
        string,
        {
          promptResultId: string;
          timestamp: string;
          platform: string;
          region: string;
          cards: ShoppingCardAppearance[];
        }
      >;
    }
  >();

  const rows = (cards ?? []) as unknown as Array<{
    id: string;
    matched_brand_role: string;
    platform: string;
    region: string | null;
    created_at: string;
    product_title: string | null;
    price_amount: number | null;
    price_currency: string | null;
    image_url: string | null;
    merchant_url: string | null;
    prompt_result_id: string;
    prompt_results: {
      id: string;
      prompt_id: string;
      prompts: {
        id: string;
        text: string;
        category: string | null;
        topic_id: string | null;
        topics: {
          name: string;
        } | null;
      };
    };
  }>;

  for (const row of rows) {
    const promptResult = row.prompt_results;
    if (!promptResult) continue;
    const prompt = promptResult.prompts;
    if (!prompt) continue;

    const promptId = prompt.id;
    if (!promptMap.has(promptId)) {
      promptMap.set(promptId, {
        promptId,
        promptText: prompt.text,
        topic: prompt.topics?.name || prompt.category || 'General',
        platforms: new Set<string>(),
        totalCards: 0,
        ownCardsCount: 0,
        competitorCardsCount: 0,
        otherCardsCount: 0,
        lastTriggered: new Date(0),
        appearancesMap: new Map(),
      });
    }

    const entry = promptMap.get(promptId)!;
    entry.platforms.add(row.platform);
    entry.totalCards += 1;
    if (row.matched_brand_role === 'own') {
      entry.ownCardsCount += 1;
    } else if (row.matched_brand_role === 'competitor') {
      entry.competitorCardsCount += 1;
    } else {
      entry.otherCardsCount += 1;
    }

    const cardDate = new Date(row.created_at);
    if (cardDate > entry.lastTriggered) {
      entry.lastTriggered = cardDate;
    }

    const prId = row.prompt_result_id;
    if (!entry.appearancesMap.has(prId)) {
      entry.appearancesMap.set(prId, {
        promptResultId: prId,
        timestamp: row.created_at,
        platform: row.platform,
        region: row.region || '',
        cards: [],
      });
    }
    const appEntry = entry.appearancesMap.get(prId)!;
    appEntry.cards.push({
      id: row.id,
      title: row.product_title || 'Unknown Product',
      price: formatPrice(row.price_amount, row.price_currency),
      imageUrl: row.image_url || '',
      merchantUrl: row.merchant_url || '',
    });
  }

  // Convert map to list and format timestamps
  const promptsList: CardEligiblePromptRow[] = Array.from(promptMap.values()).map((p) => {
    const appearances = Array.from(p.appearancesMap.values())
      .map((app) => ({
        ...app,
        // Sort cards in appearance: own first, or just keep original order
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return {
      promptId: p.promptId,
      promptText: p.promptText,
      topic: p.topic,
      platforms: Array.from(p.platforms),
      totalCards: p.totalCards,
      ownCardsCount: p.ownCardsCount,
      competitorCardsCount: p.competitorCardsCount,
      otherCardsCount: p.otherCardsCount,
      lastTriggered: p.lastTriggered.getTime() > 0 ? p.lastTriggered.toISOString() : '',
      appearances,
    };
  });

  // Sort by total cards desc
  promptsList.sort((a, b) => b.totalCards - a.totalCards);

  const trackedWithCards = promptMap.size;
  const totalTracked = totalTrackedPrompts ?? 0;
  const triggerRate = totalTracked > 0 ? trackedWithCards / totalTracked : 0;

  return {
    prompts: promptsList,
    triggerRate,
    totalTrackedPrompts: totalTracked,
  };
}
