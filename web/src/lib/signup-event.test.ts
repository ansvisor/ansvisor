import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-up events' rules, once per account (the dashboard's layout tests
 * draw the pages): who is owed them, and the claims that keep each to one.
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

// The Auth server's account, as the admin API reads and writes it: a write
// merges app_metadata's keys, and a null removes one.
const auth = vi.hoisted(() => ({
  account: null as Record<string, unknown> | null,
  admin: {
    getUserById: vi.fn(),
    updateUserById: vi.fn(),
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { auth: { admin: auth.admin } } }));

/** Resend's answer to the welcome event: true when it accepted it. */
const sendSignedUp = vi.fn();
vi.mock('@/lib/resend-event', () => ({
  sendSignedUpEvent: (u: unknown) => sendSignedUp(u),
}));
const capturePostHog = vi.fn();
vi.mock('@/lib/posthog-server', () => ({
  capturePostHog: (...args: unknown[]) => capturePostHog(...args),
}));

const { OAUTH_CALLBACK_SENT_UNTIL, SIGNUP_EVENT_SINCE, WELCOME_MAX_TRIES, sendSignupEventOnce } =
  await import('./signup-event');

const NOW = '2026-11-16T10:00:00Z';
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const meta = () => auth.account!.app_metadata as Record<string, unknown>;

function signUp(fields: Record<string, unknown> = {}) {
  auth.account = {
    id: 'u1',
    email: 'ada@example.com',
    created_at: '2026-11-13T09:00:00Z',
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

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(NOW) });
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
  later.tasks.length = 0;
  later.outsideRequest = false;
  sendSignedUp.mockReset().mockResolvedValue(true);
  capturePostHog.mockReset().mockResolvedValue(undefined);
  auth.admin.getUserById.mockReset().mockImplementation(async () => ({
    data: { user: structuredClone(auth.account) },
    error: null,
  }));
  auth.admin.updateUserById
    .mockReset()
    .mockImplementation(
      async (_id: string, { app_metadata }: { app_metadata: Record<string, unknown> }) => {
        const next: Record<string, unknown> = { ...meta() };
        for (const [key, value] of Object.entries(app_metadata)) {
          if (value === null) delete next[key];
          else next[key] = value;
        }
        auth.account = { ...auth.account, app_metadata: next };
        return { data: { user: auth.account }, error: null };
      },
    );
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
    expect(auth.admin.updateUserById).toHaveBeenCalledWith('u1', {
      app_metadata: {
        signup_claim_id: expect.any(String),
        signup_event_at: NOW.replace('Z', '.000Z'),
        signup_event_tries: 1,
        signup_posthog_at: NOW.replace('Z', '.000Z'),
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
    // Accepted: both claims stay, and the other app_metadata too.
    expect(meta()).toMatchObject({
      provider: 'email',
      providers: ['email'],
      signup_event_at: expect.any(String),
      signup_posthog_at: expect.any(String),
    });

    // The next page: nothing more, and no read for it.
    auth.admin.getUserById.mockClear();
    sendSignupEventOnce(session());
    expect(later.tasks).toHaveLength(0);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
  });

  it('starts with accounts made from 13 Nov 2026, 00:00 Istanbul time', async () => {
    expect(SIGNUP_EVENT_SINCE).toBe(Date.parse('2026-11-12T21:00:00Z'));
    sendSignupEventOnce(signUp({ created_at: '2026-11-12T20:59:59Z' }));
    expect(later.tasks).toHaveLength(0);
    sendSignupEventOnce(signUp({ created_at: '2026-11-12T21:00:00Z' }));
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
  });

  it('is never sent to an invited teammate', () => {
    sendSignupEventOnce(signUp({ invited_at: '2026-11-13T09:00:00Z' }));
    expect(later.tasks).toHaveLength(0);
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
      sendSignedUp.mockResolvedValueOnce(false);
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
    expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(/RESEND_API_KEY is not set/);

    // PostHog's key alone: its own claim only, and the welcome stays owed.
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    fresh.sendSignupEventOnce(signUp());
    await runLater();
    expect(auth.admin.updateUserById).toHaveBeenCalledWith('u1', {
      app_metadata: { signup_claim_id: expect.any(String), signup_posthog_at: expect.any(String) },
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
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('re_live');
  });

  it(`releases a refused or failed welcome for a later page, up to ${WELCOME_MAX_TRIES} tries`, async () => {
    expect(WELCOME_MAX_TRIES).toBe(3);
    sendSignedUp.mockResolvedValue(false);
    for (let page = 1; page <= WELCOME_MAX_TRIES; page++) {
      sendSignupEventOnce(page === 1 ? signUp() : session());
      await runLater();
      expect(sendSignedUp).toHaveBeenCalledTimes(page);
      expect(meta().signup_event_at).toBeUndefined();
      expect(meta().signup_event_tries).toBe(page);
    }
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toMatch(/0 tries left/);
    // The cap: no more tries, and no read for them.
    auth.admin.getUserById.mockClear();
    sendSignupEventOnce(session());
    expect(later.tasks).toHaveLength(0);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();
    // PostHog's signed_up went once, from the first page, whatever Resend said.
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(meta().signup_posthog_at).toEqual(expect.any(String));
  });

  it('keeps the welcome claimed once Resend accepts a retry', async () => {
    sendSignedUp.mockResolvedValueOnce(false);
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
  });

  it("keeps PostHog's claim apart from the welcome's", async () => {
    // Welcomed by this change, PostHog's key added since: PostHog's alone.
    sendSignupEventOnce(
      signUp({
        app_metadata: { provider: 'email', signup_event_at: 'x', signup_event_tries: 1 },
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

  it('sends nothing when the claim is already there, or cannot be written', async () => {
    // Another page claimed it after this one's session was read.
    const stale = signUp();
    auth.account!.app_metadata = {
      provider: 'email',
      signup_event_at: '2026-11-13T09:01:00Z',
      signup_event_tries: 1,
      signup_posthog_at: '2026-11-13T09:01:00Z',
    };
    sendSignupEventOnce(stale);
    await runLater();
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();

    sendSignupEventOnce(signUp());
    auth.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await runLater();
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(capturePostHog).not.toHaveBeenCalled();
  });

  it('sends once for two pages of one server at once', async () => {
    sendSignupEventOnce(signUp());
    sendSignupEventOnce(session());
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledTimes(1);
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

  it('never throws, and never logs the address', async () => {
    later.outsideRequest = true;
    expect(() => sendSignupEventOnce(signUp())).not.toThrow();

    later.outsideRequest = false;
    sendSignupEventOnce(signUp());
    auth.admin.getUserById.mockRejectedValueOnce(new Error('auth down for ada@example.com'));
    await expect(runLater()).resolves.toBeUndefined();
    expect(sendSignedUp).not.toHaveBeenCalled();

    sendSignedUp.mockResolvedValueOnce(false);
    sendSignupEventOnce(signUp());
    await runLater();
    const logged = JSON.stringify([
      vi.mocked(console.error).mock.calls,
      vi.mocked(console.warn).mock.calls,
    ]);
    expect(logged).not.toMatch(/ada@example\.com|Ada|re_test|phc_test/);
  });
});
