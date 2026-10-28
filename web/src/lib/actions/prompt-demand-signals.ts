'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import type { PromptDemand } from '@/lib/prompt-demand';

/**
 * A prompt's real demand (PROMPT-014) for its Demand card: what the
 * server's nightly sweep read. A failure comes back as a value, so the card
 * can say it couldn't load instead of the page failing.
 */
export async function getPromptDemandSignals(
  promptId: string,
): Promise<{ demand: PromptDemand } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  try {
    const res = await fetch(`${API_BASE_URL}/api/prompts/${encodeURIComponent(promptId)}/demand`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.demand) {
      return { error: data.message || data.error || `Server error: ${res.status}` };
    }
    return { demand: data.demand as PromptDemand };
  } catch {
    return { error: 'Could not reach the server. Please try again.' };
  }
}
