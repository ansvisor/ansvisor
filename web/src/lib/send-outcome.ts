/**
 * What became of an event sent to another service (Resend, PostHog), for the
 * sender's caller to act on and log: accepted on a 2xx answer, else a short
 * reason, `refused:<HTTP status>`, `failed:<error name>`, `no_key`,
 * `no_email` or `no_id`. Never an address, a key, an id or an error's message.
 */
export type SendOutcome = { accepted: boolean; reason: string };

export const ACCEPTED: SendOutcome = { accepted: true, reason: 'accepted' };

export const notSent = (reason: 'no_key' | 'no_email' | 'no_id'): SendOutcome => ({
  accepted: false,
  reason,
});

/** A service's answer: accepted on a 2xx. */
export function answered(res: { ok: boolean; status: number }): SendOutcome {
  return res.ok ? ACCEPTED : { accepted: false, reason: `refused:${res.status}` };
}

/** A call that threw (a timeout is a TimeoutError): its name only. */
export function threw(err: unknown): SendOutcome {
  const name = (err as { name?: unknown } | null)?.name;
  return { accepted: false, reason: `failed:${typeof name === 'string' ? name : 'error'}` };
}
