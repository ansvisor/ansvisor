import { randomUUID } from 'node:crypto';

/**
 * The welcome e-mail's claim, as the web's pages keep it
 * (web/src/lib/signup-event.ts), for scripts/send-missed-welcome.js: the same
 * keys in the account's app_metadata and the same way to claim, so a page
 * and the script never both send one account its welcome.
 * welcome-claim.test.js checks the two agree.
 *
 * - `signup_event_at`: the welcome, claimed. It is released (removed) only
 *   when Resend surely didn't take the event (a 4xx answer). It stays when
 *   Resend accepted it (a 2xx) and when it may have (a 5xx, a timeout, an
 *   aborted or network error): sending again could send a second welcome.
 * - `signup_event_tries`: how many times it was claimed. The web's pages stop
 *   at WELCOME_MAX_TRIES; the script, run by hand, doesn't.
 * - `signup_claim_id`: a new id with every claim written. The claim is read
 *   back after CLAIM_SETTLE_MS, and only the writer whose id stayed sends.
 * - `signup_posthog_at`: PostHog's `signed_up`, claimed apart.
 *
 * Every write sends the whole app_metadata, as just read, with the change on
 * it: the Auth server merges top-level keys (a null removes one), but the SDK
 * only sends what it is given and doesn't promise that, so this is right
 * whether it merges or replaces; a released key reads as null or not at all.
 *
 * An old-style claim is a `signup_event_at` with neither a count of tries nor
 * a claim id: written before this split, for both events at once, and kept
 * whether or not Resend got the welcome. The script re-sends those only with
 * --include-old-claims.
 *
 * A stuck claim is a new-style one written while the web's read-back got a
 * memoized answer from before the claim (Next.js deduped the identical GET;
 * fixed in web/src/lib/supabase/admin.ts): every sign-up from 19 Nov 2026
 * until the fix ended in readback_mismatch, its claims kept and nothing
 * sent, PostHog's `signed_up` included. The script re-sends those only with
 * --stuck-since, for claims written from then until the run started.
 */

/** The welcome Automation started then (13 Nov 2026, 00:00 Istanbul time). */
export const SIGNUP_EVENT_SINCE = Date.parse('2026-11-13T00:00:00+03:00');

/**
 * Until then the Google and GitHub sign-in callback sent the welcome itself,
 * keeping no claim: the claim reached production at 15:42 UTC on 14 Nov 2026
 * (#2383), rounded up. See the web's OAUTH_CALLBACK_SENT_UNTIL.
 */
export const OAUTH_CALLBACK_SENT_UNTIL = Date.parse('2026-11-14T19:00:00+03:00');

export const WELCOME_MAX_TRIES = 3;
export const WELCOME_CLAIM_KEY = 'signup_event_at';
export const WELCOME_TRIES_KEY = 'signup_event_tries';
export const CLAIM_ID_KEY = 'signup_claim_id';
export const POSTHOG_CLAIM_KEY = 'signup_posthog_at';
export const CLAIM_SETTLE_MS = 1500;

const RESEND_EVENTS_URL = 'https://api.resend.com/events/send';
const TIMEOUT_MS = 10_000;

const triesOf = (meta) => Number(meta?.[WELCOME_TRIES_KEY]) || 0;

/**
 * Whether the welcome claim is old-style: from before the welcome and
 * PostHog had their own claims (no count of tries, no claim id). Such a claim
 * was written whether or not Resend got the event.
 */
export function isOldClaim(meta) {
  return (
    Boolean(meta?.[WELCOME_CLAIM_KEY]) &&
    meta[WELCOME_TRIES_KEY] == null &&
    meta[CLAIM_ID_KEY] == null
  );
}

/**
 * Whether an account missed the welcome: 'owed', or why it is left out.
 * From the user record alone. Made since `since` (never before
 * SIGNUP_EVENT_SINCE), not invited, with a confirmed e-mail, signed in at
 * least once, and no welcome claim. With `includeOldClaims`, an old-style
 * claim (isOldClaim) doesn't count as one; a new-style claim always does. A
 * Google or GitHub account made before OAUTH_CALLBACK_SENT_UNTIL may have had
 * it from the old sign-in callback, so it is left out unless
 * `includeEarlyOAuth`.
 */
export function welcomeStatus(
  user,
  {
    since = SIGNUP_EVENT_SINCE,
    includeEarlyOAuth = false,
    includeOldClaims = false,
    stuckSince = null,
    stuckUntil = null,
  } = {},
) {
  const made = Date.parse(user?.created_at ?? '');
  if (!(made >= since) || !(made >= SIGNUP_EVENT_SINCE)) return 'before-since';
  if (user.invited_at) return 'invited';
  if (!user.email) return 'no-email';
  if (!user.email_confirmed_at) return 'unconfirmed';
  if (!user.last_sign_in_at) return 'never-signed-in';
  const meta = user.app_metadata ?? {};
  if (meta[WELCOME_CLAIM_KEY]) {
    if (isOldClaim(meta)) {
      if (!includeOldClaims) return 'old-claim';
    } else if (!inWindow(meta[WELCOME_CLAIM_KEY], stuckSince, stuckUntil)) {
      return 'claimed';
    }
  }
  if (meta.provider !== 'email' && made < OAUTH_CALLBACK_SENT_UNTIL && !includeEarlyOAuth) {
    return 'early-oauth';
  }
  return 'owed';
}

/** Whether a claim's time is in [since, until): a stuck claim's window. */
function inWindow(value, since, until) {
  if (since == null || until == null) return false;
  const at = Date.parse(typeof value === 'string' ? value : '');
  return !Number.isNaN(at) && at >= since && at < until;
}

/**
 * Whether a new-style welcome claim is stuck: written in [since, until), the
 * window --stuck-since names. Such an account's welcome was never sent.
 */
export function isStuckClaim(meta, since, until) {
  return (
    Boolean(meta?.[WELCOME_CLAIM_KEY]) &&
    !isOldClaim(meta) &&
    inWindow(meta[WELCOME_CLAIM_KEY], since, until)
  );
}

/** Whether PostHog's `signed_up` claim is stuck too: written in [since, until). */
export function isStuckPosthogClaim(meta, since, until) {
  return inWindow(meta?.[POSTHOG_CLAIM_KEY], since, until);
}

/**
 * PostHog's `signed_up` properties, as the web sends them (signupSource in
 * web/src/lib/signup-event.ts): how the person signed up, never who.
 */
export function signupSourceOf(user) {
  const provider = user?.app_metadata?.provider;
  return provider === 'email'
    ? { source: 'email' }
    : { source: 'oauth', provider: provider ?? null };
}

async function readUser(admin, id) {
  const { data, error } = await admin.getUserById(id);
  return error ? null : (data?.user ?? null);
}

/**
 * Claim one account's welcome as the web's pages do: read it again, write the
 * claim with a new claim id and one more try, let it settle, read it back.
 * `admin` is the service client's auth.admin. Returns the account as read
 * back when this claim stayed, else null: no longer owed (`isOwed`), a
 * failed read or write, or another writer's claim stayed.
 *
 * An old-style claim (owed only with --include-old-claims) is replaced by a
 * new-style one, so it is never picked as old-style again. It covered
 * PostHog's `signed_up` too, so PostHog's own claim is written from it: the
 * web's pages never send that event again.
 */
export async function claimWelcome(
  admin,
  id,
  { isOwed, sleep, now = Date.now, newClaimId = randomUUID, restampPosthog = false },
) {
  const current = await readUser(admin, id);
  if (!current || !isOwed(current)) return null;
  const at = new Date(now()).toISOString();
  const claimId = newClaimId();
  const before = current.app_metadata ?? {};
  const { error } = await admin.updateUserById(id, {
    app_metadata: {
      ...before,
      [CLAIM_ID_KEY]: claimId,
      [WELCOME_CLAIM_KEY]: at,
      [WELCOME_TRIES_KEY]: triesOf(before) + 1,
      ...(isOldClaim(before)
        ? { [POSTHOG_CLAIM_KEY]: before[POSTHOG_CLAIM_KEY] ?? before[WELCOME_CLAIM_KEY] }
        : {}),
      // A stuck PostHog claim is sent now: stamped now, so it is never stuck again.
      ...(restampPosthog ? { [POSTHOG_CLAIM_KEY]: at } : {}),
    },
  });
  if (error) return null;
  await sleep(CLAIM_SETTLE_MS);
  const claimed = await readUser(admin, id);
  const meta = claimed?.app_metadata ?? {};
  return claimed && meta[CLAIM_ID_KEY] === claimId && meta[WELCOME_CLAIM_KEY] === at
    ? claimed
    : null;
}

/**
 * Release a welcome claim Resend refused (its count of tries stays), on the
 * account as claimWelcome read it back. True when written.
 */
export async function releaseWelcome(admin, user) {
  const { error } = await admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata ?? {}), [WELCOME_CLAIM_KEY]: null },
  });
  return !error;
}

/** The first word of the person's name, or '': as the web's welcome sends it. */
export function firstNameOf(user) {
  const meta = user?.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find((value) => typeof value === 'string');
  return name?.trim().split(/\s+/)[0] ?? '';
}

/**
 * What became of a send, by the web's rule (web/src/lib/send-outcome.ts):
 * 'accepted' on a 2xx; 'refused' on a 4xx (Resend surely didn't take it, so
 * the claim may be released); 'unknown' on a 5xx, as Resend may have stored
 * the event before it failed.
 */
export function resultOf(status) {
  if (status >= 200 && status < 300) return 'accepted';
  if (status >= 400 && status < 500) return 'refused';
  return 'unknown';
}

/**
 * Send the welcome event, as the web does (lib/resend-event.ts): Resend's
 * `user.signed_up` with the e-mail and the first name. Says what became of it
 * (`result`: resultOf; a call that threw, such as a timeout, an abort or a
 * network error, is 'unknown'; nothing sent is 'refused'), with the HTTP
 * status or the error's name; never the key or the address. Never throws.
 * No idempotency key: none is documented for the events endpoint.
 */
export async function sendWelcomeEvent(user, { apiKey, fetchImpl = fetch }) {
  if (!apiKey || !user?.email) return { result: 'refused', status: null, error: 'not sent' };
  try {
    const res = await fetchImpl(RESEND_EVENTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'user.signed_up',
        email: user.email,
        payload: { first_name: firstNameOf(user) },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const status = res.status ?? null;
    return { result: res.ok ? 'accepted' : resultOf(status), status, error: null };
  } catch (err) {
    const name = err?.name;
    return {
      result: 'unknown',
      status: null,
      error: typeof name === 'string' && name ? name : 'error',
    };
  }
}
