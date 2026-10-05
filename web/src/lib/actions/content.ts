'use server';

import { createClient } from '@/lib/supabase/server';
import type { ContentBrief, ContentOpportunity, OpportunityBasket, WebhookConfig } from '@/types';
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
    q?: string;
    type?: string;
    promptId?: string;
    topicId?: string;
    limit?: number;
    offset?: number;
    sort?: string;
  },
): Promise<{
  opportunities: ContentOpportunity[];
  total: number;
  aggregates: {
    avgScore: number;
    highImpactCount: number;
    sentCount: number;
    signalCount: number;
  };
}> {
  const session = await getSession();

  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.impact) params.set('impact', filters.impact);
  if (filters?.q) params.set('q', filters.q);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.promptId) params.set('prompt_id', filters.promptId);
  if (filters?.topicId) params.set('topic_id', filters.topicId);
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

export interface OpportunityPrompt {
  promptId: string;
  text: string;
  /** Opportunities generated for this prompt, across every status. */
  count: number;
}

/** The prompts a brand's opportunities belong to, most opportunities first (#836). */
export async function getOpportunityPrompts(brandId: string): Promise<OpportunityPrompt[]> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/brand/${brandId}/prompts`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  const body = (await res.json()) as { prompts: OpportunityPrompt[] };
  return body.prompts;
}

export async function sendOpportunityToActionCenter(
  id: string,
  assetKey?: string,
): Promise<{ actionId: string; created: boolean } | { error: string }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ assetKey: assetKey ?? null }),
  });

  // Returned, not thrown: a thrown error's message is masked in production.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { error: body.details || body.error || `Server error: ${res.status}` };
  }
  return res.json();
}

export interface OpportunityTopic {
  topicId: string;
  name: string;
  count: number;
}

export async function getOpportunityTopics(brandId: string): Promise<OpportunityTopic[]> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/brand/${brandId}/topics`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  const body = (await res.json()) as { topics: OpportunityTopic[] };
  return body.topics;
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

export async function getOpportunityBasket(id: string): Promise<OpportunityBasket> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/${id}/basket`, {
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

export type SendToWebhookResult =
  | { success: true; webhookStatus: number; opportunityStatus: string }
  | { success: false; error: string };

export async function sendToWebhook(id: string): Promise<SendToWebhookResult> {
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
    let error = body.error || `Server error: ${res.status}`;
    if (error.includes('No active webhook')) {
      error = 'No workflow connected';
    }
    return { success: false, error };
  }

  const data = await res.json();
  return {
    success: true,
    webhookStatus: data.webhookStatus,
    opportunityStatus: data.opportunityStatus,
  };
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

/**
 * Permanently delete opportunities (#731).
 *
 * Distinct from `bulkUpdateStatus(ids, 'dismissed')`, which only moves a row
 * behind a status filter. Anything deleted here is gone, including any brief
 * generated for it.
 */
export async function bulkDeleteOpportunities(ids: string[]): Promise<{ deleted: number }> {
  const session = await getSession();

  const res = await fetch(`${AEO_SERVER_URL}/api/content/bulk/delete`, {
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

export type BulkSendResult =
  | {
      success: true;
      sent: number;
      failed: number;
    }
  | {
      success: false;
      error: string;
    };

export async function bulkSendToWebhook(ids: string[]): Promise<BulkSendResult> {
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
    let error = body.error || `Server error: ${res.status}`;
    if (error.includes('No active webhook')) {
      error = 'No workflow connected';
    }
    return { success: false, error };
  }

  const data = await res.json();
  return {
    success: true,
    sent: data.sent,
    failed: data.failed,
  };
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
