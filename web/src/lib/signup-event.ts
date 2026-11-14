import { after } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendSignedUpEvent } from '@/lib/resend-event';
import { capturePostHog } from '@/lib/posthog-server';

/**
 * The sign-up events, sent once per account from its first signed-in page
 * (the dashboard's layouts), whichever way the account was made: an e-mail
 * and password, Google or GitHub. Resend's welcome e-mail Automation starts
 * on `user.signed_up`; PostHog's `signed_up` is the core-loop funnel's first
 * step (docs/analytics/core-loop-funnel.md).
 *
 * Not from the sign-in links: the e-mail sign-up's confirmation link doesn't
 * come through /auth/confirm (the template links to {{ .ConfirmationURL }}),
 * so only Google and GitHub sign-ups were sent from there (#2375).
 *
 * Plain module, server only (not 'use server': it exports a constant).
 */

/**
 * Accounts made from this moment on are sent the events: the welcome
 * Automation started then (13 Nov 2026, 00:00 Istanbul time). An older
 * account is never sent them, whenever it next signs in.
 */
export const SIGNUP_EVENT_SINCE = Date.parse('2026-11-13T00:00:00+03:00');

/** Where the claim is kept, in the account's app_metadata: when it was claimed. */
const CLAIM_KEY = 'signup_event_at';

/**
 * A Google or GitHub account is made at its first sign-in, which goes
 * straight on to the dashboard, so its first page comes seconds later. Until
 * this change the sign-in callback sent the event then, keeping no claim: a
 * Google or GitHub account first seen here later than this has had it.
 */
const OAUTH_FIRST_PAGE_WITHIN_MS = 10 * 60_000;

type SessionUser = Pick<User, 'id' | 'created_at' | 'invited_at' | 'app_metadata'>;

/** Whether the account is still owed the event: from the user record alone, no reads. */
function owed(user: SessionUser, now: number): boolean {
  const meta = user.app_metadata ?? {};
  if (meta[CLAIM_KEY]) return false;
  // Invited to a workspace: an invitation, not a sign-up (never sent before either).
  if (user.invited_at) return false;
  const made = Date.parse(user.created_at ?? '');
  if (!(made >= SIGNUP_EVENT_SINCE)) return false;
  return meta.provider === 'email' || now - made <= OAUTH_FIRST_PAGE_WITHIN_MS;
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

async function readUser(id: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
  return error ? null : (data?.user ?? null);
}

/**
 * Claim, then send. The account is read again first (another page may have
 * claimed it since this one's session was read), the claim is written, and
 * read back: of two servers that claimed at once, only the one whose claim
 * stayed sends. A failed read or write sends nothing; a rare missed event is
 * better than a second welcome e-mail.
 */
async function claimAndSend(id: string): Promise<void> {
  if (claiming.has(id)) return;
  claiming.add(id);
  try {
    const current = await readUser(id);
    if (!current || !owed(current, Date.now())) return;
    const claim = new Date().toISOString();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
      app_metadata: { [CLAIM_KEY]: claim },
    });
    if (error) return;
    const claimed = await readUser(id);
    if (claimed?.app_metadata?.[CLAIM_KEY] !== claim) return;
    await Promise.all([
      sendSignedUpEvent(claimed),
      capturePostHog('signed_up', id, signupSource(claimed)),
    ]);
  } catch (err) {
    console.error('[signup-event] failed:', err instanceof Error ? err.name : 'error');
  } finally {
    claiming.delete(id);
  }
}

/**
 * Sends the sign-up events if the signed-in person's account is owed them,
 * in the background (after()): the page never waits, and this never throws.
 * `user` is the session's own (supabase.auth.getUser()); every admin read and
 * write is keyed by its id. An account that has had them, or never will,
 * costs no read at all. Does nothing without RESEND_API_KEY or
 * NEXT_PUBLIC_POSTHOG_KEY (each event needs its own).
 */
export function sendSignupEventOnce(user: SessionUser): void {
  try {
    const anyKey = process.env.RESEND_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!anyKey || !user?.id || !owed(user, Date.now())) return;
    after(() => claimAndSend(user.id));
  } catch (err) {
    console.error('[signup-event] not scheduled:', err instanceof Error ? err.name : 'error');
  }
}
