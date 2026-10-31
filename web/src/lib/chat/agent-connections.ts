import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AgentConnection } from './agent-rules';
import { CATALOG_CONNECTION, CMS_CONNECTION } from './agent-skills';

/**
 * Whether a brand has the connections an agent asks for (CHAT-21 §D item
 * 21, §H item 42), read before each of its runs (agent-driver.ts). A
 * missing Required one keeps the run from starting and pauses a triggered
 * agent (`connection`); a missing Optional one is said in the run, which
 * does everything else.
 *
 * Read from what the app already keeps per brand, as Chat's
 * list_connections reads it: any CMS is a connected Webflow, WordPress,
 * Framer or Wix site (brand_cms_connections) or an active workflow webhook
 * that takes sent pages (webhook_configs, content_draft.sent); any catalog
 * source is a feed, upload, store or Merchant Center source whose sign-in
 * still works (catalog_sources); Search Console and Analytics are the
 * brand's picked property. Agents saved before connections were kinds name
 * a product (`webflow`, `shopify`): it counts as its kind. A connection
 * this can't read (one no integration offers yet) isn't held against a run.
 */

/** The kinds this reads, and the products saved agents may name for them. */
const KIND_OF: Record<string, string> = {
  [CMS_CONNECTION]: CMS_CONNECTION,
  webflow: CMS_CONNECTION,
  wordpress: CMS_CONNECTION,
  framer: CMS_CONNECTION,
  wix: CMS_CONNECTION,
  webhook: CMS_CONNECTION,
  [CATALOG_CONNECTION]: CATALOG_CONNECTION,
  shopify: CATALOG_CONNECTION,
  merchant_center: CATALOG_CONNECTION,
  google_search_console: 'google_search_console',
  gsc: 'google_search_console',
  google_analytics: 'google_analytics',
  ga4: 'google_analytics',
};

/** A connection key as the kind it is read as, or null for one this doesn't read. */
export const connectionKindOf = (key: string): string | null => KIND_OF[key] ?? null;

/** The webhook event a CMS workflow takes pages by (server content-delivery's DELIVERY_EVENT). */
const PAGE_SENT_EVENT = 'content_draft.sent';

/** What a brand has connected, as its rows hold it. */
export interface BrandConnectionRows {
  brand: { gsc_property: string | null; ga_property_id: string | null } | null;
  cms: { provider: string; status: string }[];
  webhooks: { events: string[] | null }[];
  catalog: { kind: string; last_status: string | null }[];
}

/** The kinds a brand has connected. */
export function connectedKinds(rows: BrandConnectionRows): Set<string> {
  const kinds = new Set<string>();
  if (
    rows.cms.some((c) => c.status === 'connected') ||
    rows.webhooks.some((w) => w.events?.includes(PAGE_SENT_EVENT))
  ) {
    kinds.add(CMS_CONNECTION);
  }
  if (rows.catalog.some((source) => source.last_status !== 'auth_failed')) {
    kinds.add(CATALOG_CONNECTION);
  }
  if (rows.brand?.gsc_property) kinds.add('google_search_console');
  if (rows.brand?.ga_property_id) kinds.add('google_analytics');
  return kinds;
}

/** The agent's connections the brand lacks: Required ones keep a run from starting. */
export function connectionGaps(
  connections: readonly AgentConnection[],
  connected: ReadonlySet<string>,
): { required: string[]; optional: string[] } {
  const gaps = { required: [] as string[], optional: [] as string[] };
  for (const c of connections) {
    const kind = connectionKindOf(c.key);
    if (!kind || connected.has(kind)) continue;
    (c.required ? gaps.required : gaps.optional).push(c.key);
  }
  return gaps;
}

/** The kinds a brand has connected now. Server only. */
export async function readBrandConnections(brandId: string): Promise<Set<string>> {
  const [brand, cms, webhooks, catalog] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('gsc_property, ga_property_id')
      .eq('id', brandId)
      .maybeSingle(),
    supabaseAdmin.from('brand_cms_connections').select('provider, status').eq('brand_id', brandId),
    supabaseAdmin
      .from('webhook_configs')
      .select('events')
      .eq('brand_id', brandId)
      .eq('is_active', true),
    supabaseAdmin.from('catalog_sources').select('kind, last_status').eq('brand_id', brandId),
  ]);
  for (const read of [brand, cms, webhooks, catalog]) {
    if (read.error)
      throw new Error(`Could not read the brand's connections: ${read.error.message}`);
  }
  return connectedKinds({
    brand: (brand.data as BrandConnectionRows['brand']) ?? null,
    cms: (cms.data ?? []) as BrandConnectionRows['cms'],
    webhooks: (webhooks.data ?? []) as BrandConnectionRows['webhooks'],
    catalog: (catalog.data ?? []) as BrandConnectionRows['catalog'],
  });
}
