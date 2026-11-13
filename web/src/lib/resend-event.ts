import { firstNameOf } from '@/lib/action-center/first-day';

const TIMEOUT_MS = 5000;

/**
 * Tell Resend a custom event happened to someone (it starts the Automation
 * set up for that event), over its HTTP API with RESEND_API_KEY, like the
 * server's e-mails. Does nothing without the key and never throws: a failure
 * is logged (never the key or the address) and swallowed, so the caller is
 * never blocked.
 */
export async function sendResendEvent(
  event: string,
  email: string,
  payload: Record<string, string>,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !email) return;
  try {
    const res = await fetch('https://api.resend.com/events/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, email, payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[resend] event ${event} refused: HTTP ${res.status}`);
  } catch (err) {
    console.error(`[resend] event ${event} failed:`, err instanceof Error ? err.name : 'error');
  }
}

/** A brand-new person's welcome event: their e-mail and first name, nothing else. */
export async function sendSignedUpEvent(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const meta = user.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string');
  if (!user.email) return;
  await sendResendEvent('user.signed_up', user.email, { first_name: firstNameOf(name) ?? '' });
}
