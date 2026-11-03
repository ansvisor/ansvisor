'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { readBrandIntegrations, type BrandIntegration } from '@/lib/brand-integrations';
import { assertWritable } from '@/lib/subscription-guard';

/** Providers that expose the shared connect / status / disconnect flow. */
export type IntegrationProvider =
  | 'google-search-console'
  | 'google-analytics'
  | 'google-merchant-center';

export type IntegrationStatus = 'not_configured' | 'not_connected' | 'connected';

/**
 * How long a call to the API waits. A provider's status, live connect and
 * property lists are read from the browser instead (lib/integrations-client.ts):
 * Next runs server actions one at a time, so they held each other up.
 */
const CONFIG_TIMEOUT_MS = 10_000;
const DISCONNECT_TIMEOUT_MS = 20_000;
/** The API answers a sync at once and runs it in the background. */
const SYNC_START_TIMEOUT_MS = 5_000;

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

/**
 * Whether this deployment can connect Google Merchant Center (the API has its
 * Composio auth config): where it can't, Product Visibility doesn't ask for
 * it. False when it can't be read: a claim of nothing.
 */
export async function getMerchantCenterOffered(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/integrations/config`, {
      headers: await authHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const config = (await res.json()) as { googleMerchantCenter?: boolean };
    return Boolean(config.googleMerchantCenter);
  } catch {
    return false;
  }
}

/**
 * Everything the suggestion-sources panel needs, in two round trips (#659).
 *
 * Deliberately does NOT read the provider's status. That resolves the live
 * state against Composio and re-syncs our row, which costs ~450ms per
 * provider — measured — and made the panel appear well after the suggestions
 * it sits above. This reads the sign-in the brand uses (00470,
 * lib/brand-integrations.ts), which follows the row Composio's own status
 * check maintains, plus the brand's property mapping.
 *
 * The trade-off is that a connection revoked on Google's side still reads as
 * connected here until Settings runs its authoritative check and rewrites the
 * row. For a panel that describes what feeds suggestions, a stale "connected"
 * for a few minutes is a better failure than a second of blank space on every
 * visit.
 */
export interface SourceState {
  configured: boolean;
  connected: boolean;
  mapped: boolean;
  /**
   * When this brand's first synced row landed, or null when nothing has been
   * synced yet. Suggestions generated before it could not draw on the source.
   */
  firstDataAt: string | null;
  /**
   * When the brand's newest day of data landed: the last sync that brought
   * anything. Read from the latest date's row, which the (brand, date) index
   * finds at once; a sync only inserts new days, so it's when that ran.
   */
  lastDataAt: string | null;
  /** The brand's property: a GSC property ("sc-domain:…" or a URL) or a GA4 property id. */
  property: string | null;
}

export interface SuggestionSourceStates {
  gsc: SourceState;
  ga: SourceState;
  dataForSeo: { configured: boolean };
}

export async function getSuggestionSourceStates(brandId: string): Promise<SuggestionSourceStates> {
  const supabase = await createClient();

  interface ConfigBody {
    googleSearchConsole?: boolean;
    googleAnalytics?: boolean;
    dataForSeo?: boolean;
  }

  const firstRow = (table: 'gsc_query_stats' | 'ga_page_stats') =>
    supabase
      .from(table)
      .select('created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

  const latestRow = (table: 'gsc_query_stats' | 'ga_page_stats') =>
    supabase
      .from(table)
      .select('created_at')
      .eq('brand_id', brandId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

  const [configRes, brandRes, integrations, gscFirst, gaFirst, gscLast, gaLast] = await Promise.all(
    [
      fetch(`${API_BASE_URL}/api/integrations/config`, {
        headers: await authHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
      })
        .then((r) => (r.ok ? (r.json() as Promise<ConfigBody>) : ({} as ConfigBody)))
        .catch(() => ({}) as ConfigBody),
      supabase
        .from('brands')
        .select('gsc_property, ga_property_id')
        .eq('id', brandId)
        .maybeSingle(),
      // A failed read is "not connected", as the Account's row read was.
      readBrandIntegrations(supabase, brandId).catch(() => new Map<string, BrandIntegration>()),
      firstRow('gsc_query_stats'),
      firstRow('ga_page_stats'),
      latestRow('gsc_query_stats'),
      latestRow('ga_page_stats'),
    ],
  );

  const connected = (provider: IntegrationProvider) =>
    Boolean(integrations.get(provider)?.connected);

  return {
    gsc: {
      configured: Boolean(configRes.googleSearchConsole),
      connected: connected('google-search-console'),
      mapped: Boolean(brandRes.data?.gsc_property),
      firstDataAt: gscFirst.data?.created_at ?? null,
      lastDataAt: gscLast.data?.created_at ?? null,
      property: brandRes.data?.gsc_property ?? null,
    },
    ga: {
      configured: Boolean(configRes.googleAnalytics),
      connected: connected('google-analytics'),
      mapped: Boolean(brandRes.data?.ga_property_id),
      firstDataAt: gaFirst.data?.created_at ?? null,
      lastDataAt: gaLast.data?.created_at ?? null,
      property: brandRes.data?.ga_property_id ?? null,
    },
    dataForSeo: { configured: Boolean(configRes.dataForSeo) },
  };
}

export async function disconnectIntegration(provider: IntegrationProvider): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/${provider}`, {
    method: 'DELETE',
    headers: await authHeaders(),
    signal: AbortSignal.timeout(DISCONNECT_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
}

// ─── Property mapping (#642) ─────────────────────────────────────────────────

/**
 * Start a freshly mapped brand's first sync. Without it the data only lands
 * with the nightly run, and suggestions generated in the meantime cannot draw
 * on it. The server answers at once and syncs in the background. Best effort:
 * the property pick is already saved, and the nightly run is the fallback.
 */
async function startBrandSync(provider: IntegrationProvider, brandId: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/integrations/${provider}/sync`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ brandId }),
      signal: AbortSignal.timeout(SYNC_START_TIMEOUT_MS),
    });
  } catch {
    // The nightly sync picks the brand up.
  }
}

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string | null;
}

export interface GscBrandMapping {
  brandId: string;
  brandName: string;
  gscProperty: string | null;
  domains: string[];
}

/** Org brands with their domains and current property picks (RLS-scoped). */
export async function getGscBrandMappings(): Promise<GscBrandMapping[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, gsc_property, brand_domains(domain)')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    brandId: b.id,
    brandName: b.name,
    gscProperty: b.gsc_property,
    domains: (b.brand_domains ?? []).map((d) => d.domain),
  }));
}

/** Persist a brand's property pick (null clears it). RLS: admin/manager. */
export async function setBrandGscProperty(brandId: string, property: string | null): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const { error } = await supabase
    .from('brands')
    .update({ gsc_property: property })
    .eq('id', brandId);
  if (error) throw new Error(error.message);
  if (property) await startBrandSync('google-search-console', brandId);
}

// ─── Google Analytics property mapping (#694) ────────────────────────────────

export interface GaProperty {
  /** Bare GA4 numeric id — the "properties/" prefix is added by the API layer. */
  propertyId: string;
  displayName: string;
  accountName: string | null;
  /** Site URLs from the property's web data streams; empty for app-only ones. */
  siteUrls: string[];
}

export interface GaBrandMapping {
  brandId: string;
  brandName: string;
  gaPropertyId: string | null;
  domains: string[];
}

/** Org brands with their domains and current GA property picks (RLS-scoped). */
export async function getGaBrandMappings(): Promise<GaBrandMapping[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, ga_property_id, brand_domains(domain)')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    brandId: b.id,
    brandName: b.name,
    gaPropertyId: b.ga_property_id,
    domains: (b.brand_domains ?? []).map((d) => d.domain),
  }));
}

/** Persist a brand's GA property pick (null clears it). RLS: admin/manager. */
export async function setBrandGaProperty(
  brandId: string,
  propertyId: string | null,
): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const { error } = await supabase
    .from('brands')
    .update({ ga_property_id: propertyId })
    .eq('id', brandId);
  if (error) throw new Error(error.message);
  if (propertyId) await startBrandSync('google-analytics', brandId);
}

// ─── Which brand uses which Google account (BRAND-ACCESS PR 15) ──────────────

/** How a brand reads one Google product: the workspace's account, its own, or none. */
export type BrandGoogleUse =
  | { kind: 'none' }
  | { kind: 'workspace'; connected: boolean }
  | { kind: 'own'; connected: boolean; label: string | null; sharedWith: number };

export interface BrandGoogleRow {
  brandId: string;
  brandName: string;
  gsc: BrandGoogleUse;
  ga: BrandGoogleUse;
}

interface UseRow {
  brand_id: string;
  provider: string;
  account_id: string;
  account: {
    label: string | null;
    status: string;
    integration_connection_id: string | null;
  } | null;
}

/**
 * Settings › Integrations' overview (§3.3): for each brand the person can
 * see (RLS), which Google account it reads Search Console and Analytics
 * from. The demo brand, sample data, isn't listed.
 */
export async function getGoogleAccountsOverview(): Promise<BrandGoogleRow[]> {
  const supabase = await createClient();
  const [brands, uses] = await Promise.all([
    supabase
      .from('brands')
      .select('id, name')
      .eq('is_demo', false)
      .order('created_at', { ascending: true }),
    supabase
      .from('brand_integrations')
      .select(
        'brand_id, provider, account_id, account:integration_accounts!brand_integrations_account_id_fkey(label, status, integration_connection_id)',
      )
      .in('provider', ['google-search-console', 'google-analytics']),
  ]);
  if (brands.error) throw new Error(brands.error.message);
  if (uses.error) throw new Error(uses.error.message);
  const rows = (uses.data ?? []) as unknown as UseRow[];
  const usersOf = new Map<string, number>();
  for (const row of rows) usersOf.set(row.account_id, (usersOf.get(row.account_id) ?? 0) + 1);
  const useOf = (brandId: string, provider: string): BrandGoogleUse => {
    const row = rows.find((r) => r.brand_id === brandId && r.provider === provider);
    if (!row?.account) return { kind: 'none' };
    const connected = row.account.status === 'connected';
    if (row.account.integration_connection_id) return { kind: 'workspace', connected };
    return {
      kind: 'own',
      connected,
      label: row.account.label,
      sharedWith: (usersOf.get(row.account_id) ?? 1) - 1,
    };
  };
  return (brands.data ?? []).map((b) => ({
    brandId: b.id,
    brandName: b.name,
    gsc: useOf(b.id, 'google-search-console'),
    ga: useOf(b.id, 'google-analytics'),
  }));
}
