'use server';

import { createClient } from '@/lib/supabase/server';
import type { ContentBrief, ContentOpportunity, WebhookConfig } from '@/types';
import { API_BASE_URL } from '@/config/api';

const AEO_SERVER_URL = API_BASE_URL;

async function getSession() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return session;
}

export async function generateOpportunities(brandId: string): Promise<{ jobId: string }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { jobId: data.jobId };
}

export interface GenerationJobStatus {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'not_found';
  progress: { phase: string; message: string } | null;
  result: { generated: number } | null;
  failedReason: string | null;
}

export async function getGenerationJobStatus(jobId: string): Promise<GenerationJobStatus> {
  const session = await getSession();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${AEO_SERVER_URL}/api/content/job/${jobId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      return { status: 'not_found', progress: null, result: null, failedReason: null };
    }

    const data = await res.json();
    return {
      status: data.status ?? 'not_found',
      progress:
        data.progress && typeof data.progress === 'object' && data.progress.phase
          ? data.progress
          : null,
      result: data.result ?? null,
      failedReason: data.failedReason ?? null,
    };
  } catch {
    return { status: 'not_found', progress: null, result: null, failedReason: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOpportunities(
  brandId: string,
  filters?: {
    status?: string;
    impact?: string;
    type?: string;
    limit?: number;
    offset?: number;
    sort?: string;
  },
): Promise<{ opportunities: ContentOpportunity[]; total: number }> {
  const session = await getSession();

  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.impact) params.set('impact', filters.impact);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  if (filters?.sort) params.set('sort', filters.sort);

  const qs = params.toString();
  const url = `${AEO_SERVER_URL}/api/content/brand/${brandId}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function getOpportunity(id: string): Promise<ContentOpportunity> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export interface BriefQuota {
  used: number;
  limit: number;
  remaining: number;
}

export async function getBriefQuota(): Promise<BriefQuota> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/briefs/quota`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function generateBrief(
  opportunityId: string,
): Promise<{ brief: ContentBrief; quota: BriefQuota | null }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${opportunityId}/brief`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { brief: data.brief, quota: data.quota ?? null };
}

export async function updateOpportunityStatus(
  id: string,
  status: string,
): Promise<ContentOpportunity> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function sendToWebhook(id: string): Promise<{
  success: boolean;
  webhookStatus?: number;
  opportunityStatus?: string;
  error?: string;
}> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/send-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      success: false,
      error: body.error || `Server error: ${res.status}`,
    };
  }

  return await res.json();
}

export async function testWebhook(
  webhookUrl: string,
  webhookSecret?: string,
): Promise<{ success: boolean; status: number; error?: string }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/webhook-test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ webhookUrl, webhookSecret }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function bulkUpdateStatus(
  ids: string[],
  status: string,
): Promise<{ updated: number }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/bulk/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ids, status }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function bulkSendToWebhook(ids: string[]): Promise<{ sent: number; failed: number }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/bulk/send-webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ ids }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

export async function getWebhookConfig(brandId: string): Promise<WebhookConfig | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('webhook_configs')
    .select('*')
    .eq('brand_id', brandId)
    .limit(1)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    brandId: data.brand_id,
    name: data.name,
    webhookUrl: data.webhook_url,
    webhookSecret: data.webhook_secret || undefined,
    events: data.events || [],
    isActive: data.is_active ?? false,
    createdAt: data.created_at ?? new Date().toISOString(),
    updatedAt: data.updated_at ?? new Date().toISOString(),
  };
}

export async function saveWebhookConfig(
  brandId: string,
  config: { webhookUrl: string; webhookSecret?: string; isActive?: boolean },
): Promise<WebhookConfig> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('webhook_configs')
    .upsert(
      {
        brand_id: brandId,
        name: 'Default',
        webhook_url: config.webhookUrl,
        webhook_secret: config.webhookSecret || null,
        is_active: config.isActive ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,name' },
    )
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    brandId: data.brand_id,
    name: data.name,
    webhookUrl: data.webhook_url,
    webhookSecret: data.webhook_secret || undefined,
    events: data.events || [],
    isActive: data.is_active ?? false,
    createdAt: data.created_at ?? new Date().toISOString(),
    updatedAt: data.updated_at ?? new Date().toISOString(),
  };
}
