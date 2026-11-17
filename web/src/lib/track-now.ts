/**
 * Track now (moved from the brand's Manage prompts page, where it was
 * Analyze Prompts): the brand's active prompts with no answers yet, and a
 * tracking run for some of them now, through the same API calls that page
 * made. The run is the API's "new prompts only" one: it leaves out any prompt
 * that has answers by then, and it is for admins and managers, on an active
 * plan, within the plan's on-demand runs.
 *
 * Plain async functions run in the browser, not server actions: they reach
 * the API through BROWSER_API_BASE_URL with the person's session.
 */

import { createClient } from '@/lib/supabase/client';
import { BROWSER_API_BASE_URL } from '@/config/api';

async function authHeaders(): Promise<Record<string, string> | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return {
    Authorization: `Bearer ${session.access_token}`,
    'ngrok-skip-browser-warning': '1',
  };
}

/**
 * The ids of the brand's active prompts that have no answers yet (GET
 * /api/tracking/unanalyzed), or null when they couldn't be read.
 */
export async function readPromptsWithoutAnswers(brandId: string): Promise<string[] | null> {
  try {
    const headers = await authHeaders();
    if (!headers) return null;
    const res = await fetch(
      `${BROWSER_API_BASE_URL}/api/tracking/unanalyzed/${encodeURIComponent(brandId)}`,
      { headers },
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { prompts?: { id?: unknown }[] } | null;
    if (!Array.isArray(body?.prompts)) return null;
    return body.prompts.map((p) => p?.id).filter((id): id is string => typeof id === 'string');
  } catch {
    return null;
  }
}

export type TrackNowResult =
  /** Started: `count` prompts are being tracked now, in job `jobId`. */
  | { ok: true; jobId: string; count: number }
  /** Nothing to start: every prompt asked for has answers by now. */
  | { ok: true; jobId: null; count: 0 }
  /**
   * Refused or failed: the API's own words when it gave some (the plan's
   * daily runs, a wait between runs, a paused brand, a role), and its code.
   */
  | { ok: false; status: number; message: string | null; code: string | null };

/** Start tracking these prompts now (POST /api/tracking/analyze-new). Never throws. */
export async function trackPromptsNow(
  brandId: string,
  promptIds: string[],
): Promise<TrackNowResult> {
  try {
    const headers = await authHeaders();
    if (!headers) return { ok: false, status: 401, message: null, code: 'session' };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/tracking/analyze-new`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId, promptIds }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      jobId?: unknown;
      newCount?: unknown;
      message?: unknown;
      code?: unknown;
    };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: typeof body.message === 'string' && body.message ? body.message : null,
        code: typeof body.code === 'string' ? body.code : null,
      };
    }
    const count = Number(body.newCount) || 0;
    if (count === 0 || typeof body.jobId !== 'string') return { ok: true, jobId: null, count: 0 };
    return { ok: true, jobId: body.jobId, count };
  } catch {
    return { ok: false, status: 0, message: null, code: null };
  }
}
