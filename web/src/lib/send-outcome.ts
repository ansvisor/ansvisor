/**
 * What became of an event sent to another service (Resend, PostHog), for the
 * sender's caller to act on and log. Never an address, a key, an id or an
 * error's message.
 *
 * - `accepted`: the service answered 2xx. Reason `accepted`.
 * - `refused`: it surely didn't take the event, so sending it again is safe:
 *   it answered 4xx (`refused:<HTTP status>`), or nothing was sent (`no_key`,
 *   `no_email`, `no_id`, `bad_host`).
 * - `unknown`: it may have taken the event, so sending it again may send it
 *   twice: the call threw (`unknown:<error name>`: a timeout is a
 *   TimeoutError, an abort an AbortError, a network error a TypeError), or
 *   it answered 5xx (`unknown:<HTTP status>`). A late answer, a dropped
 *   connection or a server error can all come after the event was stored.
 *
 * A 5xx is never taken as a refusal. A 500 can come after the event was
 * stored; a 502 or 504 says only that a gateway got no good answer from a
 * server that may have stored it. A 503 usually means the request was turned
 * away, but neither service documents that it never stores the event then.
 */
export type SendOutcome = {
  result: 'accepted' | 'refused' | 'unknown';
  reason: string;
};

export const ACCEPTED: SendOutcome = { result: 'accepted', reason: 'accepted' };

/** Nothing was sent: refused, as the service never saw it. */
export const notSent = (reason: 'no_key' | 'no_email' | 'no_id' | 'bad_host'): SendOutcome => ({
  result: 'refused',
  reason,
});

/** A service's answer: accepted on a 2xx, refused on a 4xx, else unknown. */
export function answered(res: { ok: boolean; status: number }): SendOutcome {
  if (res.ok) return ACCEPTED;
  if (res.status >= 400 && res.status < 500) {
    return { result: 'refused', reason: `refused:${res.status}` };
  }
  return { result: 'unknown', reason: `unknown:${res.status}` };
}

/** A call that threw: unknown, as the request may have reached the service. Its name only. */
export function threw(err: unknown): SendOutcome {
  const name = (err as { name?: unknown } | null)?.name;
  return {
    result: 'unknown',
    reason: `unknown:${typeof name === 'string' && name ? name : 'error'}`,
  };
}
