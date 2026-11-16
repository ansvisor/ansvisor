import type { SupabaseClient } from '@supabase/supabase-js';
import { answered, notSent, threw, type SendOutcome } from '@/lib/send-outcome';

/**
 * PostHog events the web's server code sends (the core-loop funnel,
 * docs/analytics/core-loop-funnel.md), over its public capture API with
 * fetch: no SDK. The same project and key as the browser's
 * (NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST), and the person is
 * their user id, as the browser identifies, so the two join.
 *
 * Nothing is sent without the key (a self-hosted install), and it never
 * throws: a refused or slow capture is dropped. Properties are ids, counts
 * and kinds, never an e-mail, a name or a text.
 */

const DEFAULT_HOST = 'https://us.i.posthog.com';
const TIMEOUT_MS = 2000;

/**
 * Send one event. Says what became of it (lib/send-outcome.ts): accepted
 * when PostHog answered 2xx; logs nothing, so a caller that needs the event
 * (the sign-up's signed_up) can keep or release its claim and log why.
 */
export async function capturePostHog(
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<SendOutcome> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return notSent('no_key');
  if (!distinctId) return notSent('no_id');
  try {
    const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_HOST).replace(/\/+$/, '');
    const res = await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        // The server's address isn't the person's: no location from it.
        properties: { ...properties, $lib: 'ansvisor-web-server', $geoip_disable: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return answered(res);
  } catch (err) {
    // Dropped, as a browser's event would be. A relative host (a proxy path
    // the browser can use) fails here: TypeError.
    return threw(err);
  }
}

/** The signed-in person's event: their id read from the session. Never throws. */
export async function captureForSessionUser(
  supabase: Pick<SupabaseClient, 'auth'>,
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user?.id) await capturePostHog(event, data.user.id, properties);
  } catch {
    // Dropped.
  }
}
