/**
 * Shapes and guards for the evidence behind a prompt suggestion.
 *
 * A plain module rather than part of `lib/actions/prompt-suggestions.ts`,
 * because that file is `'use server'` and every runtime export of a server
 * module has to be an async server action — a synchronous helper there fails
 * the production build, not the type check.
 */

import { z } from 'zod';

export type GscSuggestionBadge = 'protect_traffic' | 'capture_demand' | 'low_competition';

export interface GscSuggestionSourceData {
  query: string;
  impressions: number;
  clicks: number;
  avgPosition: number | null;
  badge: GscSuggestionBadge | null;
  competitionIndex: number | null;
}

/**
 * Evidence behind an Analytics-derived suggestion (#705): either a page that
 * earns and has no prompt coverage, or one an AI engine already refers to.
 */
export interface GaSuggestionSourceData {
  landingPage: string;
  kind: 'revenue_blind_spot' | 'ai_momentum';
  rank: number;
  sessions: number;
  keyEvents: number;
  transactions: number;
  revenue: number;
  aiSessions: number;
  aiPlatforms: string[];
  pageTitle: string | null;
}

/**
 * The catalog category behind a shopping suggestion (ECOM-003): its live
 * products and, when they share a currency, their price band.
 */
export interface CatalogSuggestionSourceData {
  category: string;
  /** The category's id (AC plan P-8); absent on suggestions made before it. */
  categoryId?: string | null;
  products: number;
  priceLow: number | null;
  priceHigh: number | null;
  /** The round price most of its products sell under. */
  priceUnder: number | null;
  currency: string | null;
}

/**
 * The catalog product behind a buyer question (AC plan P-8): one of the
 * brand's best-selling products, or one AI shopping answers show most.
 */
export interface CatalogProductSuggestionSourceData {
  product: string;
  productId: string;
  productType: string | null;
  /** Its most specific category, when it has one. */
  category: string | null;
  categoryId: string | null;
  /** Tracked prompts whose AI shopping cards showed it, in the last 30 days. */
  cardPrompts: number;
  orders: number;
}

/**
 * The ChatGPT Business Hub discovery topic behind a suggestion (Business Hub
 * plan, PR 6; 00527): what a person copied from Business Hub's Insights,
 * the last day of the period it was shown for when they gave it, and when
 * they entered it.
 */
export interface BusinessHubSuggestionSourceData {
  topic: string;
  periodEnd: string | null;
  enteredAt: string;
}

export type SuggestionSourceData =
  | GscSuggestionSourceData
  | GaSuggestionSourceData
  | CatalogSuggestionSourceData
  | CatalogProductSuggestionSourceData
  | BusinessHubSuggestionSourceData;

export type PromptSuggestionSource =
  | 'llm'
  | 'heuristic'
  | 'gsc'
  | 'ga'
  | 'catalog'
  | 'business_hub';

interface SourceCarrier {
  source: PromptSuggestionSource;
  sourceData: SuggestionSourceData | null;
}

/**
 * Narrow `sourceData` to the shape its source promises.
 *
 * The `source` column and the payload are written together but read apart, so
 * these check both. A row whose source says one thing and whose payload says
 * another renders as a plain suggestion instead of reading fields that are not
 * there.
 */
export function gscSourceData(s: SourceCarrier): GscSuggestionSourceData | null {
  return s.source === 'gsc' && s.sourceData && 'query' in s.sourceData ? s.sourceData : null;
}

export function gaSourceData(s: SourceCarrier): GaSuggestionSourceData | null {
  return s.source === 'ga' && s.sourceData && 'landingPage' in s.sourceData ? s.sourceData : null;
}

/** A shopping question drawn from one of the catalog's categories. */
export function catalogSourceData(s: SourceCarrier): CatalogSuggestionSourceData | null {
  return s.source === 'catalog' &&
    s.sourceData &&
    'category' in s.sourceData &&
    !('productId' in s.sourceData)
    ? (s.sourceData as CatalogSuggestionSourceData)
    : null;
}

/** A buyer question about one of the catalog's top products (AC plan P-8). */
export function catalogProductSourceData(
  s: SourceCarrier,
): CatalogProductSuggestionSourceData | null {
  return s.source === 'catalog' &&
    s.sourceData &&
    'productId' in s.sourceData &&
    typeof s.sourceData.productId === 'string'
    ? s.sourceData
    : null;
}

/** A prompt written from one of ChatGPT Business Hub's discovery topics. */
export function businessHubSourceData(s: SourceCarrier): BusinessHubSuggestionSourceData | null {
  return s.source === 'business_hub' &&
    s.sourceData &&
    'topic' in s.sourceData &&
    typeof s.sourceData.topic === 'string' &&
    'enteredAt' in s.sourceData
    ? s.sourceData
    : null;
}

/**
 * From ChatGPT Business Hub: Prompt Suggestions' "ChatGPT Business Hub"
 * filter. By its source alone, so a row whose topic can't be read is still
 * kept out of "Ansvisor Agents only".
 */
export function fromBusinessHub(s: SourceCarrier): boolean {
  return s.source === 'business_hub';
}

/** Drawn from the brand's catalog, a category or a product: Prompt Suggestions' "Shopping" filter. */
export function fromCatalog(s: SourceCarrier): boolean {
  return catalogSourceData(s) !== null || catalogProductSourceData(s) !== null;
}

/**
 * Where a tracked prompt came from (prompts.source_data, 00525): the catalog
 * category or the products of the suggestion it was accepted from, so
 * online-store plays and measurement know what it is about.
 */
export type PromptSourceData =
  | {
      kind: 'catalog_category';
      category_id: string | null;
      category: string;
      suggested_at: string;
    }
  | {
      kind: 'catalog_product';
      product_ids: string[];
      category_id: string | null;
      category: string | null;
      suggested_at: string;
    };

/** A category's name kept with a prompt at most: the column stays a few kilobytes (00525). */
const CATEGORY_CHARS = 300;
const suggestedAt = z.iso.datetime({ offset: true });

/** prompts.source_data as it may be written: the two kinds, ids and nothing else. */
const promptSourceDataSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('catalog_category'),
    category_id: z.guid().nullable(),
    category: z.string().min(1).max(CATEGORY_CHARS),
    suggested_at: suggestedAt,
  }),
  z.strictObject({
    kind: z.literal('catalog_product'),
    product_ids: z.array(z.guid()).min(1).max(10),
    category_id: z.guid().nullable(),
    category: z.string().min(1).max(CATEGORY_CHARS).nullable(),
    suggested_at: suggestedAt,
  }),
]);

/** The value when it is a prompt's source as it may be written, else null. */
export function validPromptSourceData(value: unknown): PromptSourceData | null {
  const parsed = promptSourceDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * What a prompt accepted from this suggestion keeps of where it came from:
 * the catalog's category or product, with when it was suggested. Null for
 * any other suggestion, whose prompt keeps nothing.
 */
export function promptSourceData(
  s: SourceCarrier & { generatedAt: string },
): PromptSourceData | null {
  const product = catalogProductSourceData(s);
  if (product) {
    return {
      kind: 'catalog_product',
      product_ids: [product.productId],
      category_id: product.categoryId ?? null,
      category: product.category ? product.category.slice(0, CATEGORY_CHARS) : null,
      suggested_at: s.generatedAt,
    };
  }
  const category = catalogSourceData(s);
  if (category) {
    return {
      kind: 'catalog_category',
      category_id: category.categoryId ?? null,
      category: category.category.slice(0, CATEGORY_CHARS),
      suggested_at: s.generatedAt,
    };
  }
  return null;
}

/**
 * A prompt's source the database turned down: one without 00525 has no
 * prompts.source_data (PGRST204 on a write, the web deployed ahead of its
 * migration), or its check refused it (23514). The prompt is then added
 * without it: where it came from never stops it being tracked.
 */
export function sourceDataRefused(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    ['42703', 'PGRST204', '23514'].includes(error?.code ?? '') &&
    (error?.message ?? '').includes('source_data')
  );
}

/**
 * Built from the brand's own Search Console or Analytics data: Prompt
 * Suggestions' "From your data" filter, which Getting started links to.
 */
export function fromYourData(s: SourceCarrier): boolean {
  return gscSourceData(s) !== null || gaSourceData(s) !== null;
}
