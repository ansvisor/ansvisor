'use server';

import { createClient } from '@/lib/supabase/server';
import type { PromptVolume } from '@/types';
import { API_BASE_URL } from '@/config/api';

export interface VolumeQuota {
  used: number;
  limit: number;
  remaining: number;
}

const AEO_SERVER_URL = API_BASE_URL;

/**
 * Analyze a single prompt's volume via the aeo-server API.
 * On first call: LLM extracts intent + keywords, then fetches volumes.
 * On subsequent calls: reuses saved keywords, only refreshes volumes.
 * Pass force=true to re-generate keywords via LLM.
 */
export async function analyzePromptVolume(
  promptId: string,
  promptText: string,
  locationCode?: number,
  languageCode?: string,
  force?: boolean,
): Promise<PromptVolume> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${AEO_SERVER_URL}/api/volumes/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ promptId, promptText, locationCode, languageCode, force }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

/**
 * Analyze multiple prompts in batch.
 * Uses saved keywords when available, calls LLM only for new prompts.
 * Pass force=true to re-generate all keywords via LLM.
 */
export async function analyzePromptVolumesBatch(
  prompts: { promptId: string; promptText: string }[],
  locationCode?: number,
  languageCode?: string,
  force?: boolean,
): Promise<{ results: (PromptVolume & { error?: string })[]; remaining?: number }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${AEO_SERVER_URL}/api/volumes/analyze-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ prompts, locationCode, languageCode, force }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

/**
 * Refresh Google volumes for all prompts that already have saved keywords.
 * Does NOT call LLM — only re-fetches DataForSEO volumes using existing keywords.
 */
export async function refreshVolumes(
  brandId: string,
  locationCode?: number,
  languageCode?: string,
): Promise<{ results: PromptVolume[]; refreshed: number; remaining?: number }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${AEO_SERVER_URL}/api/volumes/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, locationCode, languageCode }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}

/**
 * Get all prompt volumes for a brand via the aeo-server API.
 */
export async function getPromptVolumes(
  brandId: string,
): Promise<{ volumes: PromptVolume[]; quota: VolumeQuota }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${AEO_SERVER_URL}/api/volumes/brand/${brandId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    // A hung upstream must never pin this action — and with it the whole
    // Prompts page load — until the platform kills it (#427 lesson).
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { volumes: data.volumes, quota: data.quota };
}
