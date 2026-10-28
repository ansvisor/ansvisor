import { supabaseAdmin } from '@/lib/supabase/admin';
import { lastSend } from '@/lib/content/cms-status';
import { draftShopping } from '@/lib/content/shopping-check';
import { shoppingPathSchema } from '@/lib/content/shopping-path';

/**
 * Where a draft went and whether its shopping links still sell, for the MCP's
 * draft tools (B5), as the Content Library shows them: its last Send to CMS
 * (00262, 00284) and its shopping path's check after each catalog sync
 * (00351, 00352). Ansvisor's MCP never sends a page itself.
 */

/** A draft's last Send to CMS. */
export interface McpLastSend {
  /** queued, sent, failed (a send left queued reads as failed: interrupted) or published. */
  status: string;
  /** The brand's webhook or its Webflow collection. */
  target: string;
  /** When it was published, sent or queued. */
  at: string;
  /** What the webhook answered, when it did. */
  http_status: number | null;
  error: string | null;
  /** Where the CMS says it went live. */
  published_url: string | null;
}

/** Whether a draft's shopping links still sell, as the Library's Shopping path column reads it. */
export type McpShoppingLinks =
  /** No shopping path: not a shop's page, or not one of the types that take one. */
  | { state: 'none' }
  /** A path, not checked since it was built. */
  | { state: 'unchecked' }
  | {
      /** attention: it links products that no longer sell. */
      state: 'ok' | 'attention';
      /** Read from the live page, or the draft when it isn't live. */
      read_from: 'page' | 'draft';
      checked_at: string;
      categories: number;
      categories_linked: number;
      products: number;
      products_linked: number;
      /** The linked products that no longer sell: sold out, refused by Merchant Center, or gone. */
      bad: { id: string; title: string; state: string }[];
    };

/** The columns a draft read adds for mcpShoppingLinks, as the Library's read embeds them. */
export const SHOPPING_COLUMNS =
  'shopping_built:shopping_path->>builtAt, content_shopping_checks(read_from, checked_at, categories, categories_linked, products, products_linked, bad)';

export function mcpShoppingLinks(builtAt: string | null, check: unknown): McpShoppingLinks {
  const read = draftShopping(builtAt, check);
  if (read.state === 'none' || read.state === 'unchecked') return read;
  return {
    state: read.state,
    read_from: read.readFrom,
    checked_at: read.checkedAt,
    categories: read.categories,
    categories_linked: read.categoriesLinked,
    products: read.products,
    products_linked: read.productsLinked,
    bad: read.bad,
  };
}

/** Ids a read takes: content_draft_last_deliveries (00262) reads up to 500. */
const IDS_PER_READ = 500;

/** Each draft's last send, by draft id; a draft never sent has none. */
export async function lastSendsOf(draftIds: string[]): Promise<Map<string, McpLastSend>> {
  const chunks: string[][] = [];
  for (let i = 0; i < draftIds.length; i += IDS_PER_READ) {
    chunks.push(draftIds.slice(i, i + IDS_PER_READ));
  }
  const reads = await Promise.all(
    chunks.map((ids) => supabaseAdmin.rpc('content_draft_last_deliveries', { p_draft_ids: ids })),
  );
  const sends = new Map<string, McpLastSend>();
  for (const { data, error } of reads) {
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (!row.draft_id) continue;
      const send = lastSend(row);
      sends.set(row.draft_id, {
        status: send.status,
        target: send.target,
        at: send.at,
        http_status: row.http_status,
        error: send.error,
        published_url: row.published_url,
      });
    }
  }
  return sends;
}

/** A draft's shopping path, as its Brief tab shows it: what the page should link. */
export interface McpShoppingPath {
  built_at: string;
  page_type: string | null;
  /** The category pages it should link. */
  categories: { name: string; url: string | null }[];
  /** The catalog products it should link, the best first. */
  products: {
    id: string;
    title: string;
    url: string | null;
    price: number | null;
    sale_price: number | null;
    currency: string | null;
    availability: string;
  }[];
  /** Products the path left out, and why (sold_out, refused, no_link, gone…). */
  left_out: { id: string; title: string | null; reason: string }[];
}

/** The stored shopping path in the MCP's shape; null for none, or one that can't be read. */
export function mcpShoppingPath(stored: unknown): McpShoppingPath | null {
  const parsed = shoppingPathSchema.safeParse(stored);
  if (!parsed.success) return null;
  const path = parsed.data;
  return {
    built_at: path.builtAt,
    page_type: path.pageType,
    categories: path.categories.map((c) => ({ name: c.name, url: c.url })),
    products: path.products.map((p) => ({
      id: p.id,
      title: p.title,
      url: p.url,
      price: p.price,
      sale_price: p.salePrice,
      currency: p.currency,
      availability: p.availability,
    })),
    left_out: path.leftOut.map((p) => ({ id: p.id, title: p.title, reason: p.reason })),
  };
}
