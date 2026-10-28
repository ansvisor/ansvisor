import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { readAllRpcRows } from '@/lib/supabase/rpc-pages';
import { readCatalogProducts, readCatalogSources } from '@/lib/shopping/catalog-read';
import { readiness, type ReadinessCheck } from '@/lib/shopping/products';
import { MERCHANT_CENTER_KIND } from '@/lib/catalog';
import { brandInOrg } from './data';

/**
 * A brand's product catalog (#1263) for the MCP tools get_catalog_sources and
 * list_catalog_products and their REST mirrors (MCP plan B6a): where it is
 * read from and how its last sync went, and its products as Product
 * Visibility reads them (readCatalogProducts), each with its readiness for
 * AI shopping, its Google Merchant Center issues (00296) and the AI visits
 * and orders its page brought (00361). Read through the service role once
 * the brand is the key's.
 */

/** A catalog source and its last sync, as Settings › Integrations › Catalog shows it. */
export interface McpCatalogSource {
  id: string;
  /** feed_url, upload, or a store's connector (shopify, merchant_center…). */
  kind: string;
  format: string;
  url: string | null;
  /** A store's account (a shop's domain); null for feeds and uploads. */
  account: string | null;
  label: string | null;
  last_synced_at: string | null;
  /** ok, failed, format_error or auth_failed (the store refused the saved sign-in). */
  last_status: string | null;
  last_error: string | null;
  /** What the last sync read: items, skipped, added/changed/removed, Merchant Center issues, past the plan's cap. */
  last_counts: Record<string, unknown> | null;
  /** Its products in the catalog now. */
  products: number;
}

export async function getCatalogSourcesFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<McpCatalogSource[] | null> {
  if (!(await brandInOrg(auth, brandId))) return null;
  const sources = await readCatalogSources(supabaseAdmin, brandId);
  return sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    format: s.format,
    url: s.url,
    account: s.account,
    label: s.label,
    last_synced_at: s.lastSyncedAt,
    last_status: s.lastStatus,
    last_error: s.lastError,
    last_counts: s.lastCounts as Record<string, unknown> | null,
    products: s.products,
  }));
}

/** A catalog product as list_catalog_products gives it. */
export interface McpCatalogProduct {
  id: string;
  title: string;
  url: string | null;
  brand: string | null;
  product_type: string | null;
  category: string | null;
  image: string | null;
  /** Its lowest price in stock (else of any variant), sale price first. */
  price: number | null;
  currency: string | null;
  in_stock: boolean;
  has_gtin: boolean;
  /** How ready it is for AI shopping, 0–100, and the checks it misses or that can't be made. */
  readiness: { score: number; missing: ReadinessCheck[]; unknown: ReadinessCheck[] };
  /** Google Merchant Center's issues on its offers, by severity; null without Merchant Center. */
  merchant_center_issues: { disapproved: number; demoted: number; not_impacted: number } | null;
  /** AI-referred visits to its page and the orders they led to, over the last 30 days. */
  ai_visits_30d: number;
  orders_30d: number;
  revenue_30d: number | null;
  revenue_currency: string | null;
}

export interface McpCatalogPage {
  /** The brand's live products that match. */
  total: number;
  products: McpCatalogProduct[];
  /** The offset of the next page; null on the last. */
  next_offset: number | null;
}

/** A product's AI visits and orders (catalog_product_ai_stats, 00361). */
interface ProductAiStatsRow {
  product_id: string;
  ai_visits: number;
  orders: number;
  revenue: number | null;
  currency: string | null;
}

const PRODUCTS_DEFAULT = 50;
const PRODUCTS_MAX = 200;
const STATS_DAYS = 30;
/** Variant ids an issues read filters by: each request's address stays short. */
const IDS_PER_READ = 100;

/** `%`, `_` and `\` as themselves in an ilike pattern. */
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * A page of the brand's live catalog products, by title, each read as
 * Product Visibility reads it; `search` narrows to titles containing it.
 * Null for a brand outside the key's organization.
 */
export async function listCatalogProductsFor(
  auth: McpAuthContext,
  params: { brandId: string; search?: string; limit?: number; offset?: number },
): Promise<McpCatalogPage | null> {
  if (!(await brandInOrg(auth, params.brandId))) return null;
  const limit = Math.min(Math.max(params.limit ?? PRODUCTS_DEFAULT, 1), PRODUCTS_MAX);
  const offset = Math.max(params.offset ?? 0, 0);

  let query = supabaseAdmin
    .from('catalog_products')
    .select('id', { count: 'exact' })
    .eq('brand_id', params.brandId)
    .is('removed_at', null);
  const search = params.search?.trim();
  if (search) query = query.ilike('title', `%${literal(search)}%`);
  const { data, count, error } = await query
    .order('title')
    .order('id')
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id as string);
  const total = count ?? 0;
  if (!ids.length) return { total, products: [], next_offset: null };

  const since = new Date(Date.now() - STATS_DAYS * 86_400_000).toISOString();
  const [catalog, issues, stats] = await Promise.all([
    readCatalogProducts(supabaseAdmin, params.brandId, ids),
    issuesOf(params.brandId, ids),
    readAllRpcRows<ProductAiStatsRow>(
      (start, end) =>
        supabaseAdmin
          .rpc('catalog_product_ai_stats', { p_brand_id: params.brandId, p_from: since })
          .order('product_id')
          .range(start, end) as unknown as PromiseLike<{
          data: ProductAiStatsRow[] | null;
          error: { message: string } | null;
        }>,
    ),
  ]);
  const statsOf = new Map(stats.map((row) => [row.product_id, row]));
  const byId = new Map(catalog.map((product) => [product.id, product]));

  const products = ids.flatMap((id) => {
    const product = byId.get(id);
    if (!product) return [];
    const stat = statsOf.get(id);
    return [
      {
        id,
        title: product.title,
        url: product.url,
        brand: product.brand,
        product_type: product.productType,
        category: product.category,
        image: product.image,
        price: product.price,
        currency: product.currency,
        in_stock: product.inStock,
        has_gtin: product.hasGtin,
        readiness: readiness(product),
        merchant_center_issues: issues.read ? (issues.byProduct.get(id) ?? NO_ISSUES) : null,
        ai_visits_30d: Number(stat?.ai_visits ?? 0),
        orders_30d: Number(stat?.orders ?? 0),
        revenue_30d: stat?.revenue == null ? null : Number(stat.revenue),
        revenue_currency: stat?.currency ?? null,
      },
    ];
  });
  return {
    total,
    products,
    next_offset: offset + ids.length < total ? offset + ids.length : null,
  };
}

const NO_ISSUES = { disapproved: 0, demoted: 0, not_impacted: 0 };

/**
 * Merchant Center's issues on the products' offers (00296: one row per issue
 * per offer, an offer being a variant's external id), counted by severity
 * per product. `read` is false for a brand that doesn't read a Merchant
 * Center account into its catalog: it has no issues to say.
 */
async function issuesOf(brandId: string, productIds: string[]) {
  const { count, error: countError } = await supabaseAdmin
    .from('catalog_sources')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('kind', MERCHANT_CENTER_KIND);
  if (countError) throw new Error(countError.message);
  const byProduct = new Map<
    string,
    { disapproved: number; demoted: number; not_impacted: number }
  >();
  if (!count) return { read: false, byProduct };

  const { data: variants, error } = await supabaseAdmin
    .from('catalog_variants')
    .select('product_id, external_id')
    .eq('brand_id', brandId)
    .is('removed_at', null)
    .in('product_id', productIds);
  if (error) throw new Error(error.message);
  const productOf = new Map(
    (variants ?? []).map((v) => [v.external_id as string, v.product_id as string]),
  );
  const offers = [...productOf.keys()];
  for (let i = 0; i < offers.length; i += IDS_PER_READ) {
    const { data: rows, error: issuesError } = await supabaseAdmin
      .from('catalog_item_issues')
      .select('external_id, severity')
      .eq('brand_id', brandId)
      .in('external_id', offers.slice(i, i + IDS_PER_READ));
    if (issuesError) throw new Error(issuesError.message);
    for (const row of rows ?? []) {
      const product = productOf.get(row.external_id as string);
      const severity = row.severity as keyof typeof NO_ISSUES;
      if (!product || !(severity in NO_ISSUES)) continue;
      const counts = byProduct.get(product) ?? { ...NO_ISSUES };
      counts[severity] += 1;
      byProduct.set(product, counts);
    }
  }
  return { read: true, byProduct };
}
