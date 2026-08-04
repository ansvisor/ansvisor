'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';

export type GscStatus = 'not_configured' | 'not_connected' | 'connected';

export interface GscStatusResult {
  configured: boolean;
  status: GscStatus;
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

export async function getGscStatus(): Promise<GscStatusResult> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/google-search-console/status`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
  return body as GscStatusResult;
}

export async function connectGsc(callbackUrl: string): Promise<{ redirectUrl: string }> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/google-search-console/connect`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ callbackUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
  return body as { redirectUrl: string };
}

export async function disconnectGsc(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/google-search-console`, {
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
