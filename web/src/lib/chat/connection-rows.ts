import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * The one read of what brands have connected (Chat Wave 4, W4-24), as the
 * app keeps it per brand (Brand-level access): the brand's Search Console
 * and Analytics properties, its CMS sites (brand_cms_connections), its
 * workflow webhooks (webhook_configs), its catalog sources
 * (catalog_sources) and its Slack workspace and channel (brand_integrations,
 * #2139). An agent's connection checks (agent-connections.ts
 * readBrandConnections), Chat's list_connections and the Connections page
 * (connections.ts) all build on it, so they never disagree. Server only.
 */

/** A brand's connection rows, with the details the Connections page shows. */
export interface ConnectionRows {
  brand: { gsc_property: string | null; ga_property_id: string | null } | null;
  cms: {
    provider: string;
    status: string;
    site_name?: string | null;
    connected_by?: string | null;
    created_at?: string | null;
  }[];
  webhooks: { events: string[] | null; name?: string | null; created_at?: string | null }[];
  catalog: {
    kind: string;
    last_status: string | null;
    label?: string | null;
    account?: string | null;
    url?: string | null;
    created_by?: string | null;
    created_at?: string | null;
  }[];
  /** Its Slack workspace (#2139): the sign-in's status and name, and the channel picked. */
  slack?: {
    status: string;
    label?: string | null;
    channel?: string | null;
    connected_by?: string | null;
    created_at?: string | null;
  } | null;
}

/** A brand with nothing connected. */
export const NO_CONNECTION_ROWS: ConnectionRows = Object.freeze({
  brand: null,
  cms: [],
  webhooks: [],
  catalog: [],
}) as ConnectionRows;

type WithBrand<T> = T & { brand_id: string };

/** Postgres' code for a missing table, PostgREST's for one (or a relationship) not in its cache. */
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST200']);

interface SlackAccountRow {
  status: string;
  label: string | null;
  connected_by: string | null;
  created_at: string | null;
}

/** A brand's use of its Slack sign-in, with the sign-in embedded (one, or a list of one). */
interface SlackUseRow {
  brand_id: string;
  settings: { channel?: { name?: unknown } | null } | null;
  account: SlackAccountRow | SlackAccountRow[] | null;
}

/** The connection rows of each brand given, by its id; a brand with none has empty lists. */
export async function readConnectionRows(
  brandIds: readonly string[],
): Promise<Map<string, ConnectionRows>> {
  const ids = [...new Set(brandIds)];
  const out = new Map<string, ConnectionRows>();
  if (ids.length === 0) return out;
  const [brands, cms, webhooks, catalog, slack] = await Promise.all([
    supabaseAdmin.from('brands').select('id, gsc_property, ga_property_id').in('id', ids),
    supabaseAdmin
      .from('brand_cms_connections')
      .select('brand_id, provider, status, site_name, connected_by, created_at')
      .in('brand_id', ids),
    supabaseAdmin
      .from('webhook_configs')
      .select('brand_id, name, events, created_at')
      .in('brand_id', ids)
      .eq('is_active', true),
    supabaseAdmin
      .from('catalog_sources')
      .select('brand_id, kind, last_status, label, account, url, created_by, created_at')
      .in('brand_id', ids),
    supabaseAdmin
      .from('brand_integrations')
      .select(
        'brand_id, settings, account:integration_accounts!brand_integrations_account_id_fkey(status, label, connected_by, created_at)',
      )
      .eq('provider', 'slack')
      .in('brand_id', ids),
  ]);
  for (const read of [brands, cms, webhooks, catalog]) {
    if (read.error) {
      throw new Error(`Could not read the brand's connections: ${read.error.message}`);
    }
  }
  // Before 00470 there is no pool, and no brand has Slack.
  if (slack.error && !NOT_MIGRATED.has(slack.error.code ?? '')) {
    throw new Error(`Could not read the brand's connections: ${slack.error.message}`);
  }
  for (const id of ids) out.set(id, { brand: null, cms: [], webhooks: [], catalog: [] });
  for (const row of (brands.data ?? []) as (ConnectionRows['brand'] & { id: string })[]) {
    const rows = out.get(row.id);
    if (rows) rows.brand = { gsc_property: row.gsc_property, ga_property_id: row.ga_property_id };
  }
  for (const row of (cms.data ?? []) as WithBrand<ConnectionRows['cms'][number]>[]) {
    out.get(row.brand_id)?.cms.push(row);
  }
  for (const row of (webhooks.data ?? []) as WithBrand<ConnectionRows['webhooks'][number]>[]) {
    out.get(row.brand_id)?.webhooks.push(row);
  }
  for (const row of (catalog.data ?? []) as WithBrand<ConnectionRows['catalog'][number]>[]) {
    out.get(row.brand_id)?.catalog.push(row);
  }
  for (const row of (slack.error ? [] : (slack.data ?? [])) as unknown as SlackUseRow[]) {
    const rows = out.get(row.brand_id);
    const account = Array.isArray(row.account) ? row.account[0] : row.account;
    if (!rows || !account) continue;
    const channel = row.settings?.channel?.name;
    rows.slack = {
      status: account.status,
      label: account.label,
      channel: typeof channel === 'string' && channel ? channel : null,
      connected_by: account.connected_by,
      created_at: account.created_at,
    };
  }
  return out;
}
