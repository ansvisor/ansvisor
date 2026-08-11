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
