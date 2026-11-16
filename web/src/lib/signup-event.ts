import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendSignedUpEvent } from '@/lib/resend-event';
import { capturePostHog } from '@/lib/posthog-server';
import type { SendOutcome } from '@/lib/send-outcome';

/**
 * The sign-up events, sent once per account from its first signed-in page
 * (the dashboard's layouts), whichever way the account was made: an e-mail
 * and password, Google or GitHub. Resend's welcome e-mail Automation starts
 * on `user.signed_up`; PostHog's `signed_up` is the core-loop funnel's first
 * step (docs/analytics/core-loop-funnel.md).
 *
 * Each event has its own claim in the account's app_metadata, written before
 * it is sent, and only where this server has the event's key:
 * - the welcome (RESEND_API_KEY): `signup_event_at`, tries in
 *   `signup_event_tries`;
 * - PostHog's `signed_up` (NEXT_PUBLIC_POSTHOG_KEY): `signup_posthog_at`,
 *   tries in `signup_posthog_tries`.
 * A claim is released only when the service surely didn't take the event: it
 * answered 4xx (lib/send-outcome.ts), so a later page tries again, up to
 * MAX_TRIES for each. It stays when the service accepted it (a 2xx), and
 * when it may have: a timeout, an aborted or network error, or a 5xx can all
 * come after the event was stored, and sending again could send a second
 * welcome e-mail. A rare missed event is better than that; the log says
 * `welcome_unknown:<name> (claim kept)`.
 *
 * Every step logs one short `[signup-event]` line with a reason code (never
 * an id, an address or a key), so a sign-up that got nothing shows where it
 * stopped. An account that has had its events logs nothing; one that is not
 * owed them for another reason is logged only in its first day.
 *
 * An e-mail sign-up whose address is never confirmed never reaches a
 * signed-in page, so it never gets either: no welcome to an unconfirmed
 * address, by design. server/src/scripts/send-missed-welcome.js sends the
 * welcome, by hand, to the accounts that missed it, with the same claim
 * (server/src/lib/welcome-claim.js; its test checks the two agree).
 *
 * Not from the sign-in links: the e-mail sign-up's confirmation link doesn't
 * come through /auth/confirm (the template links to {{ .ConfirmationURL }}),
 * so only Google and GitHub sign-ups were sent from there (#2375).
 *
 * after() and the layouts' redirect(): a callback is queued on the request's
 * AfterContext and runs once the response closes (next/dist/server/after);
 * a redirect() or notFound() thrown later in the render is answered on the
 * same response (a 307 with its Location), so the queued work still runs.
 *
 * Plain module, server only (not 'use server': it exports constants).
 */

/**
 * Accounts made from this moment on are sent the events: the welcome
 * Automation started then (13 Nov 2026, 00:00 Istanbul time). An older
 * account is never sent them, whenever it next signs in.
 */
export const SIGNUP_EVENT_SINCE = Date.parse('2026-11-13T00:00:00+03:00');

/**
 * Until the claim went live, the Google and GitHub sign-in callback sent the
 * welcome itself at an account's first sign-in, keeping no claim (#2375). The
 * claim came with commit 40931db52 (#2383, merged 14 Nov 2026 11:30 UTC) and
 * reached production with the first deployment that held it (d12dc19a5,
 * live 14 Nov 2026 15:42 UTC); this is that, rounded up to 16:00 UTC (19:00
 * Istanbul time) for requests still on the old deployment.
 *
 * A Google or GitHub account made before it is sent the events only from a
 * page within OAUTH_FIRST_PAGE_WITHIN_MS of being made: a later page's
 * account may have had the welcome from the callback. One made from it on
 * never had anything from the callback, so a later page may try again.
 */
export const OAUTH_CALLBACK_SENT_UNTIL = Date.parse('2026-11-14T19:00:00+03:00');

/** How many times each event is claimed before the pages stop trying. */
export const MAX_TRIES = 3;

/** A Google or GitHub account's first page comes seconds after it is made. */
const OAUTH_FIRST_PAGE_WITHIN_MS = 10 * 60_000;

/** An account not owed the events is logged only this long after it was made. */
const LOG_NEW_ACCOUNTS_FOR_MS = 24 * 60 * 60_000;

// Where the claims are kept, in the account's app_metadata.
/** The welcome: when it was claimed. Released only if Resend refused it (a 4xx). */
const WELCOME_CLAIM_KEY = 'signup_event_at';
/** How many times the welcome was claimed. */
const WELCOME_TRIES_KEY = 'signup_event_tries';
/** PostHog's signed_up: when it was claimed. Released only if PostHog refused it (a 4xx). */
const POSTHOG_CLAIM_KEY = 'signup_posthog_at';
/** How many times PostHog's signed_up was claimed. */
const POSTHOG_TRIES_KEY = 'signup_posthog_tries';
/** A new id with every claim written: the one read back is the one that stayed. */
const CLAIM_ID_KEY = 'signup_claim_id';

/**
 * How long a written claim is left before it is read back. Two servers that
 * read the account before either claimed it both write a claim, and the one
 * written last stays. A write is one Auth round trip, well under this, so
 * each reads back after the other's write has landed: only one finds its own.
 */
const CLAIM_SETTLE_MS = 1500;

type SessionUser = Pick<User, 'id' | 'email' | 'created_at' | 'invited_at' | 'app_metadata'>;
type Meta = Record<string, unknown>;
type Reason = string;

const metaOf = (user: Pick<User, 'app_metadata'>): Meta => user.app_metadata ?? {};
const triesOf = (meta: Meta, key: string): number => Number(meta[key]) || 0;

/** One line in the server's log: a step and its reason code, nothing else. */
function log(line: string, level: 'log' | 'warn' | 'error' = 'log'): void {
  console[level](`[signup-event] ${line}`);
}

/** An error's code for the log: Auth's code or HTTP status, or its name. Never its message. */
function codeOf(err: unknown): string {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; name?: unknown };
  for (const value of [e.code, e.status, e.name]) {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  return 'error';
}

/**
 * A welcome claim from before the two events had their own claims (no count
 * of tries, no claim id): written for both at once, so PostHog's is not owed.
 */
function oldClaim(meta: Meta): boolean {
  return (
    Boolean(meta[WELCOME_CLAIM_KEY]) &&
    meta[WELCOME_TRIES_KEY] == null &&
    meta[CLAIM_ID_KEY] == null
  );
}

/** Why the account isn't a sign-up the events are for, or null when it is. */
function signUpReason(user: SessionUser, now: number): Reason | null {
  // Invited to a workspace: an invitation, not a sign-up (never sent before either).
  if (user.invited_at) return 'invited';
  const made = Date.parse(user.created_at ?? '');
  if (Number.isNaN(made)) return 'no_created_at';
  if (made < SIGNUP_EVENT_SINCE) return 'before_since';
  if (metaOf(user).provider === 'email' || made >= OAUTH_CALLBACK_SENT_UNTIL) return null;
  return now - made <= OAUTH_FIRST_PAGE_WITHIN_MS ? null : 'oauth_window';
}

/** Why the account isn't owed the welcome by this server, or null when it is. */
function welcomeReason(user: SessionUser, now: number): Reason | null {
  const meta = metaOf(user);
  if (meta[WELCOME_CLAIM_KEY]) return 'claimed';
  if (!process.env.RESEND_API_KEY) return 'no_key';
  if (!user.email) return 'no_email';
  if (triesOf(meta, WELCOME_TRIES_KEY) >= MAX_TRIES) return 'max_tries';
  return signUpReason(user, now);
}

/** Why the account isn't owed PostHog's signed_up by this server, or null when it is. */
function posthogReason(user: SessionUser, now: number): Reason | null {
  const meta = metaOf(user);
  if (meta[POSTHOG_CLAIM_KEY] || oldClaim(meta)) return 'claimed';
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return 'no_key';
  if (triesOf(meta, POSTHOG_TRIES_KEY) >= MAX_TRIES) return 'max_tries';
  return signUpReason(user, now);
}

type Owed = { welcome: Reason | null; posthog: Reason | null };

/** Whether the account is owed each event: null, or why not. From the user record alone. */
function owed(user: SessionUser, now: number): Owed {
  return { welcome: welcomeReason(user, now), posthog: posthogReason(user, now) };
}

/** The reason neither is owed, for the log: one word when both say the same. */
function notOwed({ welcome, posthog }: Owed): string {
  return welcome === posthog ? `${welcome}` : `welcome_${welcome},posthog_${posthog}`;
}

/** Which events, for the log. */
const which = (welcome: boolean, posthog: boolean) =>
  [welcome && 'welcome', posthog && 'posthog'].filter(Boolean).join('+');

/** New accounts' skips this process has logged: each once. Ids are kept, never logged. */
const toldSkips = new Set<string>();

/**
 * Log why an account is not owed the events, if that says something: not
 * for one that has had them (or whose key this install doesn't set), not
 * past its first day, and once per process.
 */
function logSkip(user: SessionUser, reasons: Owed, now: number): void {
  const quiet = [reasons.welcome, reasons.posthog].every((r) => r === 'claimed' || r === 'no_key');
  // Past its first day (an account without a creation date is logged).
  const old = now - Date.parse(user.created_at ?? '') > LOG_NEW_ACCOUNTS_FOR_MS;
  if (quiet || old) return;
  const reason = notOwed(reasons);
  const key = `${user.id}:${reason}`;
  if (toldSkips.has(key)) return;
  if (toldSkips.size >= 1000) toldSkips.clear();
  toldSkips.add(key);
  log(`skip: not_owed:${reason}`);
}

/** Accounts this server is claiming right now: two of its pages at once claim once. */
const claiming = new Set<string>();

/** PostHog's way in: an e-mail, or the provider; no e-mail address or name. */
function signupSource(user: Pick<User, 'app_metadata'>): Record<string, unknown> {
  const provider = user.app_metadata?.provider;
  return provider === 'email'
    ? { source: 'email' }
    : { source: 'oauth', provider: provider ?? null };
}

async function readUser(id: string): Promise<{ user: User | null; code: string }> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
  if (error) return { user: null, code: codeOf(error) };
  return data?.user ? { user: data.user, code: '' } : { user: null, code: 'no_user' };
}

/**
 * Write the account's app_metadata: the whole object, as just read, with the
 * changes on it. The Auth server merges app_metadata's top-level keys (a null
 * removes one), but the SDK only sends what it is given (a PUT to
 * /admin/users/:id) and doesn't promise that; with the whole object the
 * write is right whether the server merges or replaces, and a released key
 * reads as null or not at all, unclaimed either way. Null on success, else
 * the error's code.
 */
async function writeMeta(id: string, appMetadata: Meta): Promise<string | null> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    app_metadata: appMetadata,
  });
  return error ? codeOf(error) : null;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, CLAIM_SETTLE_MS));

/**
 * Log what became of one event: `welcome_accepted`; `resend_refused:<status>`
 * (or why nothing was sent), released below; `welcome_unknown:<error name or
 * status> (claim kept)`. Likewise for PostHog.
 */
function logOutcome(event: 'welcome' | 'posthog', outcome: SendOutcome): void {
  if (outcome.result === 'accepted') return log(`${event}_accepted`);
  if (outcome.result === 'unknown') return log(`${event}_${outcome.reason} (claim kept)`, 'warn');
  const service = event === 'welcome' ? 'resend' : 'posthog';
  log(`${service}_${outcome.reason}`, 'error');
}

/**
 * Claim, then send. The account is read again first (another page may have
 * claimed it since this one's session was read), the claims are written with
 * a new claim id, left to settle and read back: of two servers that claimed
 * at once, only the one whose claim stayed sends. A failed read or write
 * sends nothing; a rare missed event is better than a second welcome e-mail.
 * An event the service refused (a 4xx) is released, in one write, so a later
 * page tries again; one it may have taken (a 5xx, a timeout, a network error)
 * keeps its claim, for the same reason.
 */
async function claimAndSend(id: string): Promise<void> {
  if (claiming.has(id)) return log('skip: in_progress');
  claiming.add(id);
  try {
    const read = await readUser(id);
    if (!read.user) return log(`read_failed:${read.code}`, 'error');
    const current = read.user;
    const now = Date.now();
    const reasons = owed(current, now);
    const welcome = reasons.welcome === null;
    const posthog = reasons.posthog === null;
    if (!welcome && !posthog) return log(`skip: not_owed:${notOwed(reasons)}`);

    const at = new Date(now).toISOString();
    const claimId = randomUUID();
    const meta = metaOf(current);
    const writeFailed = await writeMeta(id, {
      ...meta,
      [CLAIM_ID_KEY]: claimId,
      ...(welcome
        ? { [WELCOME_CLAIM_KEY]: at, [WELCOME_TRIES_KEY]: triesOf(meta, WELCOME_TRIES_KEY) + 1 }
        : {}),
      ...(posthog
        ? { [POSTHOG_CLAIM_KEY]: at, [POSTHOG_TRIES_KEY]: triesOf(meta, POSTHOG_TRIES_KEY) + 1 }
        : {}),
    });
    if (writeFailed) return log(`claim_write_failed:${writeFailed}`, 'error');
    log(`claimed: ${which(welcome, posthog)}`);

    await settle();
    const back = await readUser(id);
    if (!back.user) return log(`readback_failed:${back.code}`, 'error');
    const claimed = back.user;
    const stayed = metaOf(claimed);
    const sendWelcome =
      welcome && stayed[CLAIM_ID_KEY] === claimId && stayed[WELCOME_CLAIM_KEY] === at;
    const sendPosthog =
      posthog && stayed[CLAIM_ID_KEY] === claimId && stayed[POSTHOG_CLAIM_KEY] === at;
    if (!sendWelcome && !sendPosthog) return log('readback_mismatch', 'warn');

    const [welcomeSent, posthogSent] = await Promise.all([
      sendWelcome ? sendSignedUpEvent(claimed) : null,
      sendPosthog ? capturePostHog('signed_up', id, signupSource(claimed)) : null,
    ]);
    if (welcomeSent) logOutcome('welcome', welcomeSent);
    if (posthogSent) logOutcome('posthog', posthogSent);

    const release: Meta = {};
    const left: string[] = [];
    if (welcomeSent?.result === 'refused') {
      release[WELCOME_CLAIM_KEY] = null;
      left.push(`welcome (${MAX_TRIES - triesOf(stayed, WELCOME_TRIES_KEY)} tries left)`);
    }
    if (posthogSent?.result === 'refused') {
      release[POSTHOG_CLAIM_KEY] = null;
      left.push(`posthog (${MAX_TRIES - triesOf(stayed, POSTHOG_TRIES_KEY)} tries left)`);
    }
    if (!left.length) return;
    const releaseFailed = await writeMeta(id, { ...stayed, ...release });
    if (releaseFailed) log(`release_failed:${releaseFailed}`, 'error');
    else log(`released: ${left.join(', ')}`);
  } catch (err) {
    log(`failed:${codeOf(err)}`, 'error');
  } finally {
    claiming.delete(id);
  }
}

/** Whether this server process has said it has no RESEND_API_KEY. */
let toldNoResendKey = false;

/**
 * Sends the sign-up events if the signed-in person's account is owed them,
 * in the background (after()): the page never waits, and this never throws.
 * `user` is the session's own (supabase.auth.getUser()); every admin read and
 * write is keyed by its id. An account that has had them, or never will,
 * costs no read at all. Each event needs its own key (RESEND_API_KEY,
 * NEXT_PUBLIC_POSTHOG_KEY); without RESEND_API_KEY the server says so once
 * in its log, so a missing key shows.
 */
export function sendSignupEventOnce(user: SessionUser): void {
  try {
    if (!process.env.RESEND_API_KEY && !toldNoResendKey) {
      toldNoResendKey = true;
      log(
        'RESEND_API_KEY is not set on this server: the welcome e-mail event ' +
          '(user.signed_up) is not sent, and no account is claimed for it (web/.env.example)',
        'warn',
      );
    }
    if (!user?.id) return;
    const now = Date.now();
    const reasons = owed(user, now);
    if (reasons.welcome !== null && reasons.posthog !== null) return logSkip(user, reasons, now);
    after(() => claimAndSend(user.id));
    log(`scheduled: ${which(reasons.welcome === null, reasons.posthog === null)}`);
  } catch (err) {
    log(`not_scheduled:${codeOf(err)}`, 'error');
  }
}
