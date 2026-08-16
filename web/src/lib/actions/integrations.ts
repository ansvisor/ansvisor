'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';

/** Providers that expose the shared connect / status / disconnect flow. */
export type IntegrationProvider = 'google-search-console' | 'google-analytics';

export type IntegrationStatus = 'not_configured' | 'not_connected' | 'connected';

export interface IntegrationStatusResult {
  configured: boolean;
  status: IntegrationStatus;
  accountId?: string;
}

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

export async function getIntegrationStatus(
  provider: IntegrationProvider,
): Promise<IntegrationStatusResult> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/${provider}/status`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
  return body as IntegrationStatusResult;
}

/**
 * Everything the suggestion-sources panel needs, in two round trips (#659).
 *
 * Deliberately does NOT call `getIntegrationStatus`. That resolves the live
 * state against Composio and re-syncs our row, which costs ~450ms per
 * provider — measured — and made the panel appear well after the suggestions
 * it sits above. This reads the row Composio's own status check maintains,
 * plus the brand's property mapping, in a single query.
 *
 * The trade-off is that a connection revoked on Google's side still reads as
 * connected here until Settings runs its authoritative check and rewrites the
 * row. For a panel that describes what feeds suggestions, a stale "connected"
 * for a few minutes is a better failure than a second of blank space on every
 * visit.
 */
export interface SuggestionSourceStates {
  gsc: { configured: boolean; connected: boolean; mapped: boolean };
  ga: { configured: boolean; connected: boolean; mapped: boolean };
  dataForSeo: { configured: boolean };
}

export async function getSuggestionSourceStates(brandId: string): Promise<SuggestionSourceStates> {
  const supabase = await createClient();

  interface ConfigBody {
    googleSearchConsole?: boolean;
    googleAnalytics?: boolean;
    dataForSeo?: boolean;
  }

  const [configRes, brandRes, connRes] = await Promise.all([
    fetch(`${API_BASE_URL}/api/integrations/config`, {
      headers: await authHeaders(),
      cache: 'no-store',
    })
      .then((r) => (r.ok ? (r.json() as Promise<ConfigBody>) : ({} as ConfigBody)))
      .catch(() => ({}) as ConfigBody),
    supabase.from('brands').select('gsc_property, ga_property_id').eq('id', brandId).maybeSingle(),
    supabase.from('integration_connections').select('provider, status'),
  ]);

  const connected = new Set(
    (connRes.data ?? []).filter((r) => r.status === 'connected').map((r) => r.provider),
  );

  return {
    gsc: {
      configured: Boolean(configRes.googleSearchConsole),
      connected: connected.has('google-search-console'),
      mapped: Boolean(brandRes.data?.gsc_property),
    },
    ga: {
      configured: Boolean(configRes.googleAnalytics),
      connected: connected.has('google-analytics'),
      mapped: Boolean(brandRes.data?.ga_property_id),
    },
    dataForSeo: { configured: Boolean(configRes.dataForSeo) },
  };
}

export async function connectIntegration(
  provider: IntegrationProvider,
  callbackUrl: string,
): Promise<{ redirectUrl: string }> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/${provider}/connect`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ callbackUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
  return body as { redirectUrl: string };
}

export async function disconnectIntegration(provider: IntegrationProvider): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/${provider}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
}

// ─── Property mapping (#642) ─────────────────────────────────────────────────

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string | null;
}

export async function getGscProperties(): Promise<GscProperty[]> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/google-search-console/properties`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
  return (body.properties ?? []) as GscProperty[];
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
  const supabase = await createClient();
  const { error } = await supabase
    .from('brands')
    .update({ gsc_property: property })
    .eq('id', brandId);
  if (error) throw new Error(error.message);
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

export async function getGaProperties(): Promise<GaProperty[]> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/google-analytics/properties`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
  return (body.properties ?? []) as GaProperty[];
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
  const supabase = await createClient();
  const { error } = await supabase
    .from('brands')
    .update({ ga_property_id: propertyId })
    .eq('id', brandId);
  if (error) throw new Error(error.message);
}
