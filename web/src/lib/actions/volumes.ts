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
 * Failure codes the page can phrase for itself.
 *
 * The server's own text is diagnostic — DataForSEO status lines, Postgres
 * messages, argument validation — and none of it belongs in front of a
 * customer. Next.js also redacts thrown server-action messages in production,
 * so a caller reading `err.message` gets whatever the platform substituted
 * rather than the reason. A small closed set of codes survives both, and the
 * wording stays in the UI where it can be written for a person.
 */
export type VolumeErrorCode = 'quota_exceeded' | 'plan_limit' | 'failed';

export type StartVolumeAnalysisResult =
  | { ok: true; started: number; running: boolean; remaining?: number }
  | { ok: false; code: VolumeErrorCode };

export interface VolumeAnalysisStatus {
  running: boolean;
  total: number;
  /** Rows on disk. During a run these are all written at the very end. */
  analyzed: number;
  /** Prompts the run has finished with — what a progress readout counts. */
  done: number;
}

async function toErrorCode(res: Response): Promise<VolumeErrorCode> {
  const body: { error?: string } = await res.json().catch(() => ({}));
  if (body.error === 'quota_exceeded') return 'quota_exceeded';
  if (body.error === 'plan_limit') return 'plan_limit';
  console.error('Volume analysis request failed', res.status, body.error);
  return 'failed';
}

/**
 * Start volume analysis for a brand.
 *
 * The run outlives this request — a 100-prompt brand takes about eleven
 * minutes, since every prompt costs an LLM call plus a DataForSEO call and
 * they run in order. The server answers as soon as the work is queued;
 * `getVolumeAnalysisStatus` reports how far it has got.
 *
 * force=true re-generates keywords for every active prompt; the default fills
 * in only the prompts that have no volumes yet.
 */
export async function startPromptVolumeAnalysis(
  brandId: string,
  force?: boolean,
): Promise<StartVolumeAnalysisResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, code: 'failed' };

  const res = await fetch(`${AEO_SERVER_URL}/api/volumes/analyze-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, force }),
  });

  if (!res.ok) return { ok: false, code: await toErrorCode(res) };

  const body = await res.json();
  return {
    ok: true,
    started: body.started ?? 0,
    running: Boolean(body.running),
    remaining: body.remaining,
  };
}

/**
 * How far the brand's analysis has got. Returns null when the status cannot be
 * read, which the caller treats as "stop polling" rather than as a failure of
 * the run itself — the run is on the server and keeps going either way.
 */
export async function getVolumeAnalysisStatus(
  brandId: string,
): Promise<VolumeAnalysisStatus | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const res = await fetch(`${AEO_SERVER_URL}/api/volumes/status/${brandId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) return null;

  const body = await res.json();
  return {
    running: Boolean(body.running),
    total: body.total ?? 0,
    analyzed: body.analyzed ?? 0,
    done: body.done ?? body.analyzed ?? 0,
  };
}

/**
 * Refresh Google volumes for all prompts that already have saved keywords.
 * Does NOT call LLM — only re-fetches DataForSEO volumes using existing keywords.
 */
export async function refreshVolumes(
  brandId: string,
  locationCode?: number,
  languageCode?: string,
): Promise<
  { ok: true; refreshed: number; remaining?: number } | { ok: false; code: VolumeErrorCode }
> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, code: 'failed' };

  const res = await fetch(`${AEO_SERVER_URL}/api/volumes/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, locationCode, languageCode }),
  });

  if (!res.ok) return { ok: false, code: await toErrorCode(res) };

  const body = await res.json();
  return { ok: true, refreshed: body.refreshed ?? 0, remaining: body.remaining };
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
