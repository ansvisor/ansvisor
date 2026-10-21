'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import type { CancelChoice, CancelReason } from '@/lib/billing/cancel-feedback';

export type CancelFeedbackResult =
  | { ok: true }
  | { error: 'too_many' | 'server' | 'unreachable' | 'unauthenticated' };

/**
 * Send the team why the customer cancels, or their request for three days
 * first. The server keeps it and e-mails it, with replies going to the
 * customer.
 */
export async function sendCancelFeedback(input: {
  reasons: CancelReason[];
  message: string;
  choice: CancelChoice;
}): Promise<CancelFeedbackResult> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'unauthenticated' };

  try {
    const res = await fetch(`${API_BASE_URL}/api/billing/cancel-feedback`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      cache: 'no-store',
      // The server gives Resend 15 s.
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { error: data.code === 'too_many' ? 'too_many' : 'server' };
  } catch {
    return { error: 'unreachable' };
  }
}
