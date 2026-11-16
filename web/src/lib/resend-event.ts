import { firstNameOf } from '@/lib/action-center/first-day';
import { answered, notSent, threw, type SendOutcome } from '@/lib/send-outcome';

const TIMEOUT_MS = 5000;

/**
 * Tell Resend a custom event happened to someone (it starts the Automation
 * set up for that event), over its HTTP API with RESEND_API_KEY, like the
 * server's e-mails. Says what became of it (lib/send-outcome.ts): accepted on
 * a 2xx; refused on a 4xx, or without the key or the address; unknown on a
 * 5xx or a call that threw (a timeout, an abort, a network error), as Resend
 * may have the event then. Never throws, and logs nothing: the caller logs
 * the outcome's reason (never the key or the address).
 *
 * No idempotency key: nothing in this repo or its packages documents one for
 * the events endpoint, so a retry can't be made safe that way.
 */
export async function sendResendEvent(
  event: string,
  email: string,
  payload: Record<string, string>,
): Promise<SendOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return notSent('no_key');
  if (!email) return notSent('no_email');
  try {
    const res = await fetch('https://api.resend.com/events/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, email, payload }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return answered(res);
  } catch (err) {
    return threw(err);
  }
}

/**
 * A brand-new person's welcome event: their e-mail and first name, nothing
 * else. Says whether Resend accepted it, refused it, or may have it.
 */
export async function sendSignedUpEvent(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): Promise<SendOutcome> {
  const meta = user.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string');
  if (!user.email) return notSent('no_email');
  return sendResendEvent('user.signed_up', user.email, { first_name: firstNameOf(name) ?? '' });
}
