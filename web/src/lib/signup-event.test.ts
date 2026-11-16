import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-up events' rules, once per account (the dashboard's layout tests
 * draw the pages): who is owed them, the claims that keep each to one, and
 * the log lines that say where a sign-up's events stopped.
 */

const later = vi.hoisted(() => ({
  tasks: [] as (() => Promise<unknown>)[],
  outsideRequest: false,
}));
vi.mock('next/server', () => ({
  after: (task: () => Promise<unknown>) => {
    if (later.outsideRequest) throw new Error('after() was called outside a request scope');
    later.tasks.push(task);
  },
}));

// The Auth server's account, as the admin API reads and writes it. A write
// merges app_metadata's keys and a null removes one ('merge', what the Auth
// server does), or replaces app_metadata whole ('replace').
const auth = vi.hoisted(() => ({
  account: null as Record<string, unknown> | null,
  writes: 'merge' as 'merge' | 'replace',
  admin: {
    getUserById: vi.fn(),
    updateUserById: vi.fn(),
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { auth: { admin: auth.admin } } }));

/** Resend's and PostHog's answers (lib/send-outcome.ts). */
const sendSignedUp = vi.fn();
vi.mock('@/lib/resend-event', () => ({
  sendSignedUpEvent: (u: unknown) => sendSignedUp(u),
}));
const capturePostHog = vi.fn();
vi.mock('@/lib/posthog-server', () => ({
  capturePostHog: (...args: unknown[]) => capturePostHog(...args),
}));
const ACCEPTED = { result: 'accepted', reason: 'accepted' };
/** Surely not taken: a 4xx. */
const refused = (status: number) => ({ result: 'refused', reason: `refused:${status}` });
/** May have been taken: a call that threw (its name), or a 5xx (its status). */
const unknown = (what: string | number) => ({ result: 'unknown', reason: `unknown:${what}` });

const { MAX_TRIES, OAUTH_CALLBACK_SENT_UNTIL, SIGNUP_EVENT_SINCE, sendSignupEventOnce } =
  await import('./signup-event');

const NOW = '2026-11-16T10:00:00Z';
const AT = '2026-11-16T10:00:00.000Z';
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const meta = () => auth.account!.app_metadata as Record<string, unknown>;

/** A new account, made an hour ago with an e-mail and password unless told otherwise. */
function signUp(fields: Record<string, unknown> = {}) {
  auth.account = {
    id: 'u1',
    email: 'ada@example.com',
    created_at: '2026-11-16T09:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Ada Lovelace' },
    ...fields,
  };
  return session();
}

/** The signed-in session's user, as getUser() reads it now. */
const session = () => structuredClone(auth.account) as Parameters<typeof sendSignupEventOnce>[0];

/** The pages' after() work, as Next runs it, with the claim's wait run through. */
async function runLater() {
  const tasks = later.tasks.splice(0);
  const done = Promise.all(tasks.map((task) => task()));
  await vi.runAllTimersAsync();
  await done;
}

/** Every line logged, at any level. */
const logged = () =>
  [console.log, console.warn, console.error].flatMap((fn) =>
    vi.mocked(fn).mock.calls.map((call) => call.join(' ')),
  );
const clearLogs = () =>
  [console.log, console.warn, console.error].forEach((fn) => vi.mocked(fn).mockClear());

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  later.tasks.length = 0;
  later.outsideRequest = false;
  auth.writes = 'merge';
  sendSignedUp.mockReset().mockResolvedValue(ACCEPTED);
  capturePostHog.mockReset().mockResolvedValue(ACCEPTED);
  auth.admin.getUserById.mockReset().mockImplementation(async () => ({
    data: { user: structuredClone(auth.account) },
    error: null,
  }));
  auth.admin.updateUserById
    .mockReset()
    .mockImplementation(
      async (_id: string, { app_metadata }: { app_metadata: Record<string, unknown> }) => {
        let next: Record<string, unknown> = { ...app_metadata };
        if (auth.writes === 'merge') {
          next = { ...meta() };
          for (const [key, value] of Object.entries(app_metadata)) {
            if (value === null) delete next[key];
            else next[key] = value;
          }
        }
        auth.account = { ...auth.account, app_metadata: next };
        return { data: { user: auth.account }, error: null };
      },
    );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendSignupEventOnce', () => {
  it('claims the account, then sends, keyed by the signed-in id', async () => {
    sendSignupEventOnce(signUp());
    expect(sendSignedUp).not.toHaveBeenCalled();
    await runLater();
    expect(auth.admin.getUserById).toHaveBeenCalledWith('u1');
    expect(auth.admin.updateUserById).toHaveBeenCalledTimes(1);
    // The whole app_metadata, as read, with the claims on it.
    expect(auth.admin.updateUserById).toHaveBeenCalledWith('u1', {
      app_metadata: {
        provider: 'email',
        providers: ['email'],
        signup_claim_id: expect.any(String),
        signup_event_at: AT,
        signup_event_tries: 1,
        signup_posthog_at: AT,
        signup_posthog_tries: 1,
      },
    });
    expect(auth.admin.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      sendSignedUp.mock.invocationCallOrder[0],
    );
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(sendSignedUp).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', email: 'ada@example.com' }),
    );
    // PostHog's signed_up from its own claim: the user id and the way in only.
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledWith('signed_up', 'u1', { source: 'email' });
    // Accepted: both claims stay.
    expect(meta()).toMatchObject({ signup_event_at: AT, signup_posthog_at: AT });
    expect(logged()).toEqual([
      '[signup-event] scheduled: welcome+posthog',
      '[signup-event] claimed: welcome+posthog',
      '[signup-event] welcome_accepted',
      '[signup-event] posthog_accepted',
    ]);

    // The next page: nothing more, no read and no log for it.
    clearLogs();
    auth.admin.getUserById.mockClear();
    sendSignupEventOnce(session());
    expect(later.tasks).toHaveLength(0);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
  });

  it('starts with accounts made from 13 Nov 2026, 00:00 Istanbul time', async () => {
    expect(SIGNUP_EVENT_SINCE).toBe(Date.parse('2026-11-12T21:00:00Z'));
    sendSignupEventOnce(signUp({ created_at: '2026-11-12T20:59:59Z' }));
    expect(later.tasks).toHaveLength(0);
    // An older account is no new sign-up: no log either.
    expect(logged()).toEqual([]);
    sendSignupEventOnce(signUp({ created_at: '2026-11-12T21:00:00Z' }));
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
  });

  it('is never sent to an invited teammate, and says why once, in its first day', () => {
    sendSignupEventOnce(signUp({ invited_at: '2026-11-16T09:00:00Z' }));
    sendSignupEventOnce(session());
    expect(later.tasks).toHaveLength(0);
    expect(logged()).toEqual(['[signup-event] skip: not_owed:invited']);

    clearLogs();
    sendSignupEventOnce(
      signUp({ id: 'u2', created_at: ago(2 * 86_400_000), invited_at: ago(2 * 86_400_000) }),
    );
    expect(logged()).toEqual([]);
  });

  it('says why a new account without a creation date is skipped', () => {
    sendSignupEventOnce(signUp({ created_at: undefined }));
    expect(later.tasks).toHaveLength(0);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
    expect(logged()).toEqual(['[signup-event] skip: not_owed:no_created_at']);
  });

  describe('a Google or GitHub account and the old sign-in callback', () => {
    const google = (created_at: string) =>
      signUp({ created_at, app_metadata: { provider: 'google', providers: ['google'] } });

    it('cuts over when the claim reached production: 14 Nov 2026, 16:00 UTC', () => {
      expect(OAUTH_CALLBACK_SENT_UNTIL).toBe(Date.parse('2026-11-14T16:00:00Z'));
    });

    it('made before the cut-off: only from a page within 10 minutes, as the callback may have sent it', async () => {
      vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
      sendSignupEventOnce(google(ago(3_600_000)));
      expect(later.tasks).toHaveLength(0);
      expect(logged()).toEqual(['[signup-event] skip: not_owed:oauth_window']);
      // Days later too.
      vi.setSystemTime(new Date(NOW));
      sendSignupEventOnce(google('2026-11-14T15:59:59Z'));
      expect(later.tasks).toHaveLength(0);
      expect(auth.admin.getUserById).not.toHaveBeenCalled();

      vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
      sendSignupEventOnce(google(ago(5_000)));
      await runLater();
      expect(sendSignedUp).toHaveBeenCalledTimes(1);
      expect(capturePostHog).toHaveBeenCalledWith('signed_up', 'u1', {
        source: 'oauth',
        provider: 'google',
      });
    });

    it('made from the cut-off on: a later page sends it, and retries a refused one', async () => {
      sendSignupEventOnce(google('2026-11-14T16:00:00Z'));
      sendSignedUp.mockResolvedValueOnce(refused(422));
      await runLater();
      expect(meta().signup_event_at).toBeUndefined();

      // An hour later, the next page tries again.
      vi.advanceTimersByTime(3_600_000);
      sendSignupEventOnce(session());
      await runLater();
      expect(sendSignedUp).toHaveBeenCalledTimes(2);
      expect(meta()).toMatchObject({ signup_event_at: expect.any(String), signup_event_tries: 2 });
    });
  });

  it('claims nothing for the welcome without RESEND_API_KEY, and says so once, never the key', async () => {
    vi.resetModules();
    const fresh = await import('./signup-event');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    fresh.sendSignupEventOnce(signUp());
    fresh.sendSignupEventOnce(signUp());
    expect(later.tasks).toHaveLength(0);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(
      /^\[signup-event\] RESEND_API_KEY is not set/,
    );
    // No other line: an install without the keys is not a failure.
    expect(logged()).toHaveLength(1);

    // PostHog's key alone: its own claim only, and the welcome stays owed.
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    fresh.sendSignupEventOnce(signUp());
    await runLater();
    expect(auth.admin.updateUserById).toHaveBeenCalledWith('u1', {
      app_metadata: {
        provider: 'email',
        providers: ['email'],
        signup_claim_id: expect.any(String),
        signup_posthog_at: AT,
        signup_posthog_tries: 1,
      },
    });
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(meta().signup_event_at).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);

    // The key added later: the next page sends the welcome, and not PostHog's again.
    vi.stubEnv('RESEND_API_KEY', 're_live');
    fresh.sendSignupEventOnce(session());
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(logged().join('\n')).not.toMatch(/re_live|phc_test/);
  });

  it(`releases a refused welcome (a 4xx) for a later page, up to ${MAX_TRIES} tries`, async () => {
    expect(MAX_TRIES).toBe(3);
    sendSignedUp
      .mockResolvedValueOnce(refused(422))
      .mockResolvedValueOnce(refused(429))
      .mockResolvedValueOnce(refused(400));
    for (let page = 1; page <= MAX_TRIES; page++) {
      sendSignupEventOnce(page === 1 ? signUp() : session());
      await runLater();
      expect(sendSignedUp).toHaveBeenCalledTimes(page);
      expect(meta().signup_event_at).toBeUndefined();
      expect(meta().signup_event_tries).toBe(page);
    }
    const lines = logged();
    expect(lines).toContain('[signup-event] resend_refused:422');
    expect(lines).toContain('[signup-event] released: welcome (2 tries left)');
    expect(lines).toContain('[signup-event] resend_refused:429');
    expect(lines).toContain('[signup-event] resend_refused:400');
    expect(lines).toContain('[signup-event] released: welcome (0 tries left)');

    // The cap: no more tries, no read for them, and one line that says so.
    clearLogs();
    auth.admin.getUserById.mockClear();
    sendSignupEventOnce(session());
    sendSignupEventOnce(session());
    expect(later.tasks).toHaveLength(0);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
    expect(logged()).toEqual(['[signup-event] skip: not_owed:welcome_max_tries,posthog_claimed']);
    // PostHog's signed_up went once, from the first page, whatever Resend said.
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(meta().signup_posthog_at).toEqual(AT);
  });

  it(`releases a refused PostHog signed_up (a 4xx) the same way, up to ${MAX_TRIES} tries`, async () => {
    capturePostHog
      .mockResolvedValueOnce(refused(400))
      .mockResolvedValueOnce(refused(401))
      .mockResolvedValueOnce(ACCEPTED);
    sendSignupEventOnce(signUp());
    await runLater();
    // The welcome stays; PostHog's claim is released, its try counted.
    expect(meta()).toMatchObject({ signup_event_at: AT, signup_posthog_tries: 1 });
    expect(meta()).not.toHaveProperty('signup_posthog_at');
    expect(logged()).toContain('[signup-event] posthog_refused:400');
    expect(logged()).toContain('[signup-event] released: posthog (2 tries left)');

    sendSignupEventOnce(session());
    await runLater();
    expect(logged()).toContain('[signup-event] posthog_refused:401');
    sendSignupEventOnce(session());
    await runLater();
    expect(capturePostHog).toHaveBeenCalledTimes(3);
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(meta()).toMatchObject({
      signup_posthog_at: expect.any(String),
      signup_posthog_tries: 3,
    });
    sendSignupEventOnce(session());
    expect(later.tasks).toHaveLength(0);
  });

  it('releases both in one write when both were refused', async () => {
    sendSignedUp.mockResolvedValueOnce(refused(429));
    capturePostHog.mockResolvedValueOnce(refused(429));
    sendSignupEventOnce(signUp());
    await runLater();
    expect(auth.admin.updateUserById).toHaveBeenCalledTimes(2);
    expect(meta()).not.toHaveProperty('signup_event_at');
    expect(meta()).not.toHaveProperty('signup_posthog_at');
    expect(logged()).toContain(
      '[signup-event] released: welcome (2 tries left), posthog (2 tries left)',
    );
  });

  describe('when the answer is unknown: Resend or PostHog may have the event', () => {
    const cases = [
      ['a timeout', unknown('TimeoutError')],
      ['a network error', unknown('TypeError')],
      ['an aborted call', unknown('AbortError')],
      ['a 500', unknown(500)],
      ['a 502', unknown(502)],
      ['a 503', unknown(503)],
      ['a 504', unknown(504)],
    ] as const;

    it.each(cases)(
      'keeps the welcome claimed on %s, so no page sends a second one',
      async (_, outcome) => {
        sendSignedUp.mockResolvedValueOnce(outcome);
        sendSignupEventOnce(signUp());
        await runLater();
        expect(sendSignedUp).toHaveBeenCalledTimes(1);
        // The claim's one write, and no release.
        expect(auth.admin.updateUserById).toHaveBeenCalledTimes(1);
        expect(meta()).toMatchObject({
          signup_event_at: AT,
          signup_event_tries: 1,
          signup_posthog_at: AT,
        });
        expect(console.warn).toHaveBeenCalledWith(
          `[signup-event] welcome_${outcome.reason} (claim kept)`,
        );
        expect(logged().join('\n')).not.toMatch(/released|resend_/);

        // An hour later, the next page: nothing more, and no read for it.
        vi.advanceTimersByTime(3_600_000);
        auth.admin.getUserById.mockClear();
        sendSignupEventOnce(session());
        expect(later.tasks).toHaveLength(0);
        expect(auth.admin.getUserById).not.toHaveBeenCalled();
        expect(sendSignedUp).toHaveBeenCalledTimes(1);
      },
    );

    it.each(cases)("keeps PostHog's claim on %s too", async (_, outcome) => {
      capturePostHog.mockResolvedValueOnce(outcome);
      sendSignupEventOnce(signUp());
      await runLater();
      expect(auth.admin.updateUserById).toHaveBeenCalledTimes(1);
      expect(meta()).toMatchObject({ signup_posthog_at: AT, signup_posthog_tries: 1 });
      expect(console.warn).toHaveBeenCalledWith(
        `[signup-event] posthog_${outcome.reason} (claim kept)`,
      );
      sendSignupEventOnce(session());
      expect(later.tasks).toHaveLength(0);
      expect(capturePostHog).toHaveBeenCalledTimes(1);
    });

    it('releases only the refused one when the other is unknown', async () => {
      sendSignedUp.mockResolvedValueOnce(refused(422));
      capturePostHog.mockResolvedValueOnce(unknown('TimeoutError'));
      sendSignupEventOnce(signUp());
      await runLater();
      expect(auth.admin.updateUserById).toHaveBeenCalledTimes(2);
      expect(meta()).not.toHaveProperty('signup_event_at');
      expect(meta()).toMatchObject({ signup_event_tries: 1, signup_posthog_at: AT });
      expect(logged()).toContain('[signup-event] released: welcome (2 tries left)');
      expect(logged()).toContain('[signup-event] posthog_unknown:TimeoutError (claim kept)');

      // The next page retries the welcome alone.
      sendSignupEventOnce(session());
      await runLater();
      expect(sendSignedUp).toHaveBeenCalledTimes(2);
      expect(capturePostHog).toHaveBeenCalledTimes(1);
      expect(meta()).toMatchObject({ signup_event_at: expect.any(String), signup_event_tries: 2 });
    });
  });

  it('is right whether the Auth server merges app_metadata or replaces it', async () => {
    auth.writes = 'replace';
    sendSignedUp.mockResolvedValueOnce(refused(422));
    sendSignupEventOnce(signUp());
    await runLater();
    // Replaced whole, with what was there kept; the released claim reads as null.
    expect(meta()).toMatchObject({
      provider: 'email',
      providers: ['email'],
      signup_event_at: null,
      signup_event_tries: 1,
      signup_posthog_at: AT,
    });
    sendSignupEventOnce(session());
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(2);
    expect(meta()).toMatchObject({
      provider: 'email',
      signup_event_at: expect.any(String),
      signup_event_tries: 2,
    });
    expect(capturePostHog).toHaveBeenCalledTimes(1);
  });

  it('keeps the welcome claimed once Resend accepts a retry', async () => {
    sendSignedUp.mockResolvedValueOnce(refused(429));
    sendSignupEventOnce(signUp());
    await runLater();
    sendSignupEventOnce(session());
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(2);
    expect(meta()).toMatchObject({ signup_event_at: expect.any(String), signup_event_tries: 2 });
    sendSignupEventOnce(session());
    expect(later.tasks).toHaveLength(0);
  });

  it('never sends either again to an account claimed before the two had their own claims', () => {
    sendSignupEventOnce(signUp({ app_metadata: { provider: 'email', signup_event_at: 'x' } }));
    expect(later.tasks).toHaveLength(0);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
    expect(logged()).toEqual([]);
  });

  it("keeps PostHog's claim apart from the welcome's", async () => {
    // Welcomed by this change, PostHog's key added since: PostHog's alone.
    sendSignupEventOnce(
      signUp({
        app_metadata: {
          provider: 'email',
          signup_event_at: 'x',
          signup_event_tries: 1,
          signup_claim_id: 'c0',
        },
      }),
    );
    await runLater();
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(meta()).toMatchObject({ signup_event_at: 'x', signup_event_tries: 1 });

    // PostHog's had, the welcome not: the welcome's alone.
    sendSignupEventOnce(signUp({ app_metadata: { provider: 'email', signup_posthog_at: 'y' } }));
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(meta().signup_posthog_at).toBe('y');
  });

  it('sends nothing when the claim is already there, or cannot be written, and says which', async () => {
    // Another page claimed it after this one's session was read.
    const stale = signUp();
    auth.account!.app_metadata = {
      provider: 'email',
      signup_event_at: '2026-11-16T09:01:00Z',
      signup_event_tries: 1,
      signup_posthog_at: '2026-11-16T09:01:00Z',
      signup_claim_id: 'c0',
    };
    sendSignupEventOnce(stale);
    await runLater();
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(logged()).toContain('[signup-event] skip: not_owed:claimed');

    sendSignupEventOnce(signUp());
    auth.admin.updateUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { name: 'AuthApiError', status: 403, code: 'not_admin', message: 'u1 ada' },
    });
    await runLater();
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(capturePostHog).not.toHaveBeenCalled();
    expect(logged()).toContain('[signup-event] claim_write_failed:not_admin');
  });

  it('says when the account cannot be read, before the claim or after it', async () => {
    sendSignupEventOnce(signUp());
    auth.admin.getUserById.mockResolvedValueOnce({
      data: { user: null },
      error: { name: 'AuthApiError', status: 401, message: 'Invalid API key' },
    });
    await runLater();
    expect(logged()).toContain('[signup-event] read_failed:401');
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();

    sendSignupEventOnce(signUp());
    auth.admin.getUserById
      .mockImplementationOnce(async () => ({ data: { user: structuredClone(auth.account) } }))
      .mockResolvedValueOnce({ data: { user: null }, error: { name: 'AuthRetryableFetchError' } });
    await runLater();
    expect(logged()).toContain('[signup-event] readback_failed:AuthRetryableFetchError');
    expect(sendSignedUp).not.toHaveBeenCalled();
  });

  it('sends once for two pages of one server at once', async () => {
    sendSignupEventOnce(signUp());
    sendSignupEventOnce(session());
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('[signup-event] skip: in_progress');
  });

  it('sends once for two servers whose pages both read the account before either claimed it', async () => {
    vi.resetModules();
    const other = await import('./signup-event');
    // A write lands an Auth round trip after it is sent.
    const write = auth.admin.updateUserById.getMockImplementation()!;
    auth.admin.updateUserById.mockImplementation(async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return write(...args);
    });
    sendSignupEventOnce(signUp());
    other.sendSignupEventOnce(session());
    await runLater();
    // Both read it unclaimed and both wrote a claim; the last one stayed.
    expect(auth.admin.getUserById).toHaveBeenCalledTimes(4);
    expect(auth.admin.updateUserById).toHaveBeenCalledTimes(2);
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    const last = auth.admin.updateUserById.mock.calls[1][1].app_metadata.signup_claim_id;
    expect(meta().signup_claim_id).toBe(last);
    expect(logged()).toContain('[signup-event] readback_mismatch');
  });

  it('of two servers that claimed at once, only the one whose claim stayed sends', async () => {
    sendSignupEventOnce(signUp());
    // Another server writes its claim over this one's before it is read back.
    auth.admin.updateUserById.mockImplementationOnce(async () => {
      auth.account = {
        ...auth.account,
        app_metadata: {
          provider: 'email',
          signup_claim_id: 'theirs',
          signup_event_at: '2026-11-16T10:00:00.001Z',
          signup_event_tries: 1,
          signup_posthog_at: '2026-11-16T10:00:00.001Z',
          signup_posthog_tries: 1,
        },
      };
      return { data: { user: auth.account }, error: null };
    });
    await runLater();
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(capturePostHog).not.toHaveBeenCalled();
    // Theirs stays: this one's claim isn't released.
    expect(auth.admin.updateUserById).toHaveBeenCalledTimes(1);
  });

  it('never throws, and never logs an id, an address, a name or a key', async () => {
    later.outsideRequest = true;
    expect(() => sendSignupEventOnce(signUp())).not.toThrow();
    expect(logged()).toContain('[signup-event] not_scheduled:Error');

    later.outsideRequest = false;
    sendSignupEventOnce(signUp());
    auth.admin.getUserById.mockRejectedValueOnce(new Error('auth down for ada@example.com'));
    await expect(runLater()).resolves.toBeUndefined();
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(logged()).toContain('[signup-event] failed:Error');

    sendSignedUp.mockResolvedValueOnce(refused(422));
    capturePostHog.mockResolvedValueOnce(unknown('TypeError'));
    sendSignupEventOnce(signUp());
    await runLater();
    sendSignupEventOnce(signUp({ invited_at: AT }));
    const all = logged().join('\n');
    expect(all).not.toMatch(/ada@example\.com|Ada|Lovelace|re_test|phc_test|\bu1\b/);
    expect(logged().every((line) => line.startsWith('[signup-event] '))).toBe(true);
  });
});
