'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
// Types only — the helpers that go with them live in a plain module.
import type { ImproveQuota, ImproveRangeInput, ImproveSet } from '@/lib/prompt-improve';

/**
 * Failures come back as a value, not a throw, so the panel can show the real
 * message (plan limit, missing AI key) instead of the masked production
 * digest (#427).
 */
type ImproveResult =
  | { improve: ImproveSet | null; quota: ImproveQuota | null }
  | { error: string; code?: 'plan_limit' | 'quota_exceeded' };

async function call(
  promptId: string,
  range: ImproveRangeInput,
  method: 'GET' | 'POST',
): Promise<ImproveResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const url = new URL(`${API_BASE_URL}/api/prompts/${promptId}/improve`);
  const body: Record<string, string> = {};
  for (const [k, v] of Object.entries(range)) if (typeof v === 'string' && v) body[k] = v;
  if (method === 'GET') for (const [k, v] of Object.entries(body)) url.searchParams.set(k, v);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      // Reading the cache is quick; generating is one model call (target p95 < 15 s).
      signal: AbortSignal.timeout(method === 'GET' ? 15_000 : 60_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: data.message || data.error || `Server error: ${res.status}`,
        code:
          data.error === 'plan_limit' || data.error === 'quota_exceeded' ? data.error : undefined,
      };
    }
    return {
      improve: (data.improve ?? null) as ImproveSet | null,
      quota: (data.quota ?? null) as ImproveQuota | null,
    };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.name === 'TimeoutError'
          ? 'Generating suggestions took too long. Please try again.'
          : 'Could not reach the server. Please try again.',
    };
  }
}

/** The cached set for this prompt and range, or null when none was built yet. */
export async function getImproveSuggestions(
  promptId: string,
  range: ImproveRangeInput,
): Promise<ImproveResult> {
  return call(promptId, range, 'GET');
}

/** Build (or rebuild) the set for this prompt and range. */
export async function generateImproveSuggestions(
  promptId: string,
  range: ImproveRangeInput,
): Promise<ImproveResult> {
  return call(promptId, range, 'POST');
}
