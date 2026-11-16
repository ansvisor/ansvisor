import { randomUUID } from 'node:crypto';

/**
 * The welcome e-mail's claim, as the web's pages keep it
 * (web/src/lib/signup-event.ts), for scripts/send-missed-welcome.js: the same
 * keys in the account's app_metadata and the same way to claim, so a page
 * and the script never both send one account its welcome.
 * welcome-claim.test.js checks the two agree.
 *
 * - `signup_event_at`: the welcome, claimed. It stays only once Resend
 *   accepted the event (a 2xx answer); otherwise it is released (removed).
 * - `signup_event_tries`: how many times it was claimed. The web's pages stop
 *   at WELCOME_MAX_TRIES; the script, run by hand, doesn't.
 * - `signup_claim_id`: a new id with every claim written. The claim is read
 *   back after CLAIM_SETTLE_MS, and only the writer whose id stayed sends.
 * - `signup_posthog_at`: PostHog's `signed_up`, claimed apart.
 *
 * An old-style claim is a `signup_event_at` with neither a count of tries nor
 * a claim id: written before this split, for both events at once, and kept
 * whether or not Resend got the welcome. The script re-sends those only with
 * --include-old-claims.
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
  { since = SIGNUP_EVENT_SINCE, includeEarlyOAuth = false, includeOldClaims = false } = {},
) {
  const made = Date.parse(user?.created_at ?? '');
  if (!(made >= since) || !(made >= SIGNUP_EVENT_SINCE)) return 'before-since';
  if (user.invited_at) return 'invited';
  if (!user.email) return 'no-email';
  if (!user.email_confirmed_at) return 'unconfirmed';
  if (!user.last_sign_in_at) return 'never-signed-in';
  const meta = user.app_metadata ?? {};
  if (meta[WELCOME_CLAIM_KEY]) {
    if (!isOldClaim(meta)) return 'claimed';
    if (!includeOldClaims) return 'old-claim';
  }
  if (meta.provider !== 'email' && made < OAUTH_CALLBACK_SENT_UNTIL && !includeEarlyOAuth) {
    return 'early-oauth';
  }
  return 'owed';
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
  { isOwed, sleep, now = Date.now, newClaimId = randomUUID },
) {
  const current = await readUser(admin, id);
  if (!current || !isOwed(current)) return null;
  const at = new Date(now()).toISOString();
  const claimId = newClaimId();
  const before = current.app_metadata ?? {};
  const { error } = await admin.updateUserById(id, {
    app_metadata: {
      [CLAIM_ID_KEY]: claimId,
      [WELCOME_CLAIM_KEY]: at,
      [WELCOME_TRIES_KEY]: triesOf(before) + 1,
      ...(isOldClaim(before)
        ? { [POSTHOG_CLAIM_KEY]: before[POSTHOG_CLAIM_KEY] ?? before[WELCOME_CLAIM_KEY] }
        : {}),
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

/** Release a welcome claim Resend didn't accept (its count of tries stays). True when written. */
export async function releaseWelcome(admin, id) {
  const { error } = await admin.updateUserById(id, {
    app_metadata: { [WELCOME_CLAIM_KEY]: null },
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
 * Send the welcome event, as the web does (lib/resend-event.ts): Resend's
 * `user.signed_up` with the e-mail and the first name. Says whether Resend
 * accepted it (2xx), with the HTTP status or the error's name; never the key
 * or the address. Never throws.
 */
export async function sendWelcomeEvent(user, { apiKey, fetchImpl = fetch }) {
  if (!apiKey || !user?.email) return { accepted: false, status: null, error: 'not sent' };
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
    return { accepted: Boolean(res.ok), status: res.status ?? null, error: null };
  } catch (err) {
    const name = err?.name;
    return { accepted: false, status: null, error: typeof name === 'string' ? name : 'error' };
  }
}
