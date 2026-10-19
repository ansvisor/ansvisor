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

// ── Overview (KPIs + charts) ──────────────────────────────────────────────────

interface ShoppingOverviewRow {
  total_results: number;
  results_with_cards: number;
  total_cards: number;
  own_cards: number;
  top_merchant: { domain: string; card_count: number } | null;
  by_platform: Array<{ platform: string; total_results: number; results_with_cards: number }>;
  trend: Array<{ day: string; own_cards: number; total_cards: number }>;
}

/**
 * One `shopping_overview` call (#922). The KPIs and charts are aggregated in
 * Postgres: fetched as rows they were cut off at PostgREST's 1,000-row cap.
 * `trendFrom` is omitted when the caller doesn't need the trend.
 */
async function loadShoppingOverview(
  brandId: string,
  filters: ShoppingFilters,
  trendFrom?: string,
): Promise<ShoppingOverviewRow> {
  const supabase = await createClient();
  const { from, to } = resolveDateRange(filters);
  const { data, error } = await supabase.rpc('shopping_overview', {
    p_brand_id: brandId,
    p_from: from,
    p_to: expandDateToEndOfDay(to),
    p_platforms: filters.platforms?.length ? filters.platforms : undefined,
    p_regions: filters.regions?.length ? filters.regions : undefined,
    p_trend_from: trendFrom,
  });
  if (error) throw new Error(error.message);
  return data as unknown as ShoppingOverviewRow;
}

function toKpis(row: ShoppingOverviewRow): ShoppingKpis {
  const totalResults = Number(row.total_results);
  const totalCards = Number(row.total_cards);
  return {
    shoppingCardRate: totalResults > 0 ? Number(row.results_with_cards) / totalResults : 0,
    shoppingCardRateSampleSize: totalResults,
    productsSurfaced: Number(row.own_cards),
    shoppingSov: totalCards > 0 ? Number(row.own_cards) / totalCards : 0,
    topMerchant: row.top_merchant
      ? { domain: row.top_merchant.domain, cardCount: Number(row.top_merchant.card_count) }
      : null,
  };
}

/**
 * Two compact chart payloads for the Overview tab:
 *
 *  - `platformCardRate` — bar chart, one row per platform, `cardRate` is
 *    `cards-bearing prompts / total prompts on that platform`.
 *  - `ownPresenceTrend` — line chart, one bucket per UTC day for the
 *    last 30 days, with own + total card counts.
 */
function toChartData(row: ShoppingOverviewRow): ShoppingChartData {
  const platformCardRate: PlatformCardRatePoint[] = row.by_platform
    .filter((p) => Number(p.total_results) > 0)
    .map((p) => ({
      platform: p.platform,
      cardRate: Number(p.results_with_cards) / Number(p.total_results),
      totalResults: Number(p.total_results),
    }))
    .sort((a, b) => b.cardRate - a.cardRate);

  const buckets = new Map(row.trend.map((d) => [d.day, d]));
  // Fill in zero buckets so the line chart doesn't skip empty days.
  const ownPresenceTrend: OwnPresenceTrendPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const slot = buckets.get(date);
    ownPresenceTrend.push({
      date,
      ownCards: Number(slot?.own_cards ?? 0),
      totalCards: Number(slot?.total_cards ?? 0),
    });
  }

  return { platformCardRate, ownPresenceTrend };
}

/** The four overview KPIs for a window (also used by reports). */
export async function getShoppingKpis(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingKpis> {
  return toKpis(await loadShoppingOverview(brandId, filters));
}

/**
 * The Overview tab in one round trip: KPIs plus charts. The trend is always
 * the last 30 days regardless of the date filter, so the chart shows a stable
 * window; the platform and region filters still apply.
 */
export async function getShoppingOverview(
  brandId: string,
  filters: ShoppingFilters,
): Promise<{ kpis: ShoppingKpis; charts: ShoppingChartData }> {
  const row = await loadShoppingOverview(brandId, filters, daysAgoIso(30));
  return { kpis: toKpis(row), charts: toChartData(row) };
}

/**
 * Collected once at page load so the filter bar shows only platform / region
 * values that actually appear in this brand's data — all of it, not the first
 * 1,000 results.
 */
export async function getShoppingFilterOptions(brandId: string): Promise<{
  platforms: string[];
  regions: string[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('shopping_filter_options', { p_brand_id: brandId });
  if (error) return { platforms: [], regions: [] };
  const row = (data as { platforms: string[] | null; regions: string[] | null }[] | null)?.[0];
  return { platforms: row?.platforms ?? [], regions: row?.regions ?? [] };
}

// ── Paged card reads ──────────────────────────────────────────────────────────

const CARD_PAGE_SIZE = 1000;
const CARD_MAX_ROWS = 50_000;

/**
 * Every row a card query matches, read in `.range()` pages: an unpaged select
 * stops at PostgREST's 1,000-row cap (#922). `build` returns a fresh, filtered
 * query per page; the order makes the pages deterministic. Bounded by
 * CARD_MAX_ROWS so a pathological brand can't pin the server action.
 */
async function fetchAllCards<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder generics
  build: () => any,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < CARD_MAX_ROWS; start += CARD_PAGE_SIZE) {
    const { data, error } = await build()
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(start, start + CARD_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < CARD_PAGE_SIZE) break;
  }
  return rows;
}

/** A card query over the filter window: brand, dates, platforms and regions. */
function cardsInWindow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  filters: ShoppingFilters,
  columns: string,
) {
  const { from, to } = resolveDateRange(filters);
  const expandedTo = expandDateToEndOfDay(to);
  let query = supabase.from('prompt_result_shopping_cards').select(columns).eq('brand_id', brandId);
  if (from) query = query.gte('created_at', from);
  if (expandedTo) query = query.lte('created_at', expandedTo);
  if (filters.platforms?.length) query = query.in('platform', filters.platforms);
  if (filters.regions?.length) query = query.in('region', filters.regions);
  return query;
}

const PRODUCT_CARD_COLUMNS = `
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
    `;

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

  const data = await fetchAllCards<CardRow>(() =>
    cardsInWindow(supabase, brandId, filters, PRODUCT_CARD_COLUMNS).eq('matched_brand_role', 'own'),
  );

  return aggregateProducts(data);
}

export async function getCompetitorProducts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingProduct[]> {
  const supabase = await createClient();

  const { data: competitorsData, error: compError } = await supabase
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);

  if (compError) throw new Error(compError.message);
  const competitorMap = new Map((competitorsData ?? []).map((c) => [c.id, c]));

  const data = await fetchAllCards<CardRow>(() =>
    cardsInWindow(supabase, brandId, filters, PRODUCT_CARD_COLUMNS).eq(
      'matched_brand_role',
      'competitor',
    ),
  );

  return aggregateProducts(data, competitorMap);
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

  const competitorCardsQuery = fetchAllCards<{
    matched_brand_id: string | null;
    product_title: string | null;
    product_brand: string | null;
  }>(() =>
    cardsInWindow(supabase, brandId, filters, 'matched_brand_id, product_title, product_brand').eq(
      'matched_brand_role',
      'competitor',
    ),
  );

  const competitorsQuery = supabase
    .from('competitors')
    .select('id, name, domain')
    .eq('brand_id', brandId);

  const [{ count: totalCount }, competitorCards, { data: competitors, error: compError }] =
    await Promise.all([totalCardsQuery, competitorCardsQuery, competitorsQuery]);

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

const ELIGIBLE_CARD_COLUMNS = `
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
    `;

export async function getCardEligiblePrompts(
  brandId: string,
  filters: ShoppingFilters,
): Promise<CardEligiblePromptsResponse> {
  const supabase = await createClient();

  // 1. Get total number of tracked prompts for the brand
  const { count: totalTrackedPrompts, error: countError } = await supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)', { count: 'exact', head: true })
    .eq('prompt_sets.brand_id', brandId);

  if (countError) throw new Error(countError.message);

  // 2. Fetch all normalized shopping cards matching the brand and filters
  const cards = await fetchAllCards<unknown>(() =>
    cardsInWindow(supabase, brandId, filters, ELIGIBLE_CARD_COLUMNS),
  );

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
