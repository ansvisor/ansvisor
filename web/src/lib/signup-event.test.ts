import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sign-up event's rules, once per account (the dashboard's layout tests
 * draw the pages): who is owed it, and the claim that keeps it to one.
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

// The Auth server's account, as the admin API reads and writes it.
const auth = vi.hoisted(() => ({
  account: null as Record<string, unknown> | null,
  admin: {
    getUserById: vi.fn(),
    updateUserById: vi.fn(),
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { auth: { admin: auth.admin } } }));

const sendSignedUp = vi.fn();
vi.mock('@/lib/resend-event', () => ({
  sendSignedUpEvent: (u: unknown) => sendSignedUp(u),
}));
const capturePostHog = vi.fn();
vi.mock('@/lib/posthog-server', () => ({
  capturePostHog: (...args: unknown[]) => capturePostHog(...args),
}));

const { SIGNUP_EVENT_SINCE, sendSignupEventOnce } = await import('./signup-event');

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function signUp(fields: Record<string, unknown> = {}) {
  auth.account = {
    id: 'u1',
    email: 'ada@example.com',
    created_at: '2026-11-13T09:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Ada Lovelace' },
    ...fields,
  };
  return structuredClone(auth.account) as Parameters<typeof sendSignupEventOnce>[0];
}

async function runLater() {
  const tasks = later.tasks.splice(0);
  await Promise.all(tasks.map((task) => task()));
}

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 're_test');
  later.tasks.length = 0;
  later.outsideRequest = false;
  sendSignedUp.mockReset().mockResolvedValue(undefined);
  capturePostHog.mockReset().mockResolvedValue(undefined);
  auth.admin.getUserById.mockReset().mockImplementation(async () => ({
    data: { user: structuredClone(auth.account) },
    error: null,
  }));
  auth.admin.updateUserById
    .mockReset()
    .mockImplementation(async (_id: string, { app_metadata }: { app_metadata: object }) => {
      const meta = auth.account!.app_metadata as object;
      auth.account = { ...auth.account, app_metadata: { ...meta, ...app_metadata } };
      return { data: { user: auth.account }, error: null };
    });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sendSignupEventOnce', () => {
  it('claims the account, then sends, keyed by the signed-in id', async () => {
    sendSignupEventOnce(signUp());
    expect(sendSignedUp).not.toHaveBeenCalled();
    await runLater();
    expect(auth.admin.getUserById).toHaveBeenCalledWith('u1');
    expect(auth.admin.updateUserById).toHaveBeenCalledWith('u1', {
      app_metadata: { signup_event_at: expect.any(String) },
    });
    expect(auth.admin.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      sendSignedUp.mock.invocationCallOrder[0],
    );
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(sendSignedUp).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', email: 'ada@example.com' }),
    );
    // PostHog's signed_up from the same claim: the user id and the way in only.
    expect(capturePostHog).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledWith('signed_up', 'u1', { source: 'email' });
    // The other app_metadata stays.
    expect(auth.account!.app_metadata).toMatchObject({ provider: 'email', providers: ['email'] });
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

  it("sends a Google or GitHub account's event at its first page, not again to one the callback sent it to", async () => {
    // Made an hour ago: the callback sent it then, before this change.
    sendSignupEventOnce(
      signUp({ created_at: ago(3_600_000), app_metadata: { provider: 'google' } }),
    );
    expect(later.tasks).toHaveLength(0);

    sendSignupEventOnce(signUp({ created_at: ago(5_000), app_metadata: { provider: 'github' } }));
    await runLater();
    expect(sendSignedUp).toHaveBeenCalledTimes(1);
    expect(capturePostHog).toHaveBeenCalledWith('signed_up', 'u1', {
      source: 'oauth',
      provider: 'github',
    });
  });

  it('reads nothing for an account already claimed, or without a Resend or PostHog key', () => {
    sendSignupEventOnce(signUp({ app_metadata: { provider: 'email', signup_event_at: 'x' } }));
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    sendSignupEventOnce(signUp());
    expect(later.tasks).toHaveLength(0);
    expect(auth.admin.getUserById).not.toHaveBeenCalled();

    // PostHog's key alone: still claimed once, for the funnel.
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    sendSignupEventOnce(signUp());
    expect(later.tasks).toHaveLength(1);
  });

  it('sends nothing when the claim is already there, or cannot be written', async () => {
    // Another page claimed it after this one's session was read.
    const stale = signUp();
    auth.account!.app_metadata = { provider: 'email', signup_event_at: '2026-11-13T09:01:00Z' };
    sendSignupEventOnce(stale);
    await runLater();
    expect(auth.admin.updateUserById).not.toHaveBeenCalled();

    sendSignupEventOnce(signUp());
    auth.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await runLater();
    expect(sendSignedUp).not.toHaveBeenCalled();
  });

  it('of two servers that claimed at once, only the one whose claim stayed sends', async () => {
    sendSignupEventOnce(signUp());
    // Another server writes its claim over this one's before it is read back.
    auth.admin.updateUserById.mockImplementationOnce(async () => {
      auth.account = {
        ...auth.account,
        app_metadata: { provider: 'email', signup_event_at: '2026-11-13T09:00:00.001Z' },
      };
      return { data: { user: auth.account }, error: null };
    });
    await runLater();
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(capturePostHog).not.toHaveBeenCalled();
  });

  it('never throws, and never logs the address', async () => {
    later.outsideRequest = true;
    expect(() => sendSignupEventOnce(signUp())).not.toThrow();

    later.outsideRequest = false;
    sendSignupEventOnce(signUp());
    auth.admin.getUserById.mockRejectedValueOnce(new Error('auth down for ada@example.com'));
    await expect(runLater()).resolves.toBeUndefined();
    expect(sendSignedUp).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('ada@example.com');
  });
});
