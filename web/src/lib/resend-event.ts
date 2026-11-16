import { firstNameOf } from '@/lib/action-center/first-day';

const TIMEOUT_MS = 5000;

/**
 * Tell Resend a custom event happened to someone (it starts the Automation
 * set up for that event), over its HTTP API with RESEND_API_KEY, like the
 * server's e-mails. Says whether Resend accepted it (a 2xx answer): false
 * without the key or the address, on a refusal and on a failed or timed-out
 * call. Never throws: a failure is logged (never the key or the address) and
 * swallowed, so the caller is never blocked.
 */
export async function sendResendEvent(
  event: string,
  email: string,
  payload: Record<string, string>,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !email) return false;
  try {
    const res = await fetch('https://api.resend.com/events/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, email, payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[resend] event ${event} refused: HTTP ${res.status}`);
    return res.ok;
  } catch (err) {
    // The error's name only (a timeout is a TimeoutError DOMException).
    const name = (err as { name?: unknown } | null)?.name;
    console.error(`[resend] event ${event} failed:`, typeof name === 'string' ? name : 'error');
    return false;
  }
}

/**
 * A brand-new person's welcome event: their e-mail and first name, nothing
 * else. True when Resend accepted it.
 */
export async function sendSignedUpEvent(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): Promise<boolean> {
  const meta = user.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string');
  if (!user.email) return false;
  return sendResendEvent('user.signed_up', user.email, { first_name: firstNameOf(name) ?? '' });
}
