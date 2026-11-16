import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CLAIM_ID_KEY,
  CLAIM_SETTLE_MS,
  OAUTH_CALLBACK_SENT_UNTIL,
  POSTHOG_CLAIM_KEY,
  SIGNUP_EVENT_SINCE,
  WELCOME_CLAIM_KEY,
  WELCOME_MAX_TRIES,
  WELCOME_TRIES_KEY,
  claimWelcome,
  firstNameOf,
  isOldClaim,
  releaseWelcome,
  resultOf,
  sendWelcomeEvent,
  welcomeStatus,
} from './welcome-claim.js';

/** A deep copy, as the Auth server's JSON answers are. */
const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * The web's pages (web/src/lib/signup-event.ts) and the missed-welcome script
 * claim one account's welcome the same way: the same keys, dates, tries and
 * wait, or a page and the script could both send it.
 */
describe('the welcome claim on both sides', () => {
  const web = readFileSync(
    new URL('../../../web/src/lib/signup-event.ts', import.meta.url),
    'utf8',
  );
  const constant = (name) => {
    const found = web.match(new RegExp(`const ${name} = ([^;]+);`));
    expect(found, `${name} in signup-event.ts`).not.toBeNull();
    return found[1].trim();
  };
  const dateOf = (name) => Date.parse(constant(name).match(/^Date\.parse\('([^']+)'\)$/)[1]);

  it('keeps the same keys in app_metadata', () => {
    expect(constant('WELCOME_CLAIM_KEY')).toBe(`'${WELCOME_CLAIM_KEY}'`);
    expect(constant('WELCOME_TRIES_KEY')).toBe(`'${WELCOME_TRIES_KEY}'`);
    expect(constant('CLAIM_ID_KEY')).toBe(`'${CLAIM_ID_KEY}'`);
    expect(constant('POSTHOG_CLAIM_KEY')).toBe(`'${POSTHOG_CLAIM_KEY}'`);
    expect(WELCOME_CLAIM_KEY).toBe('signup_event_at');
  });

  it('starts, cuts over, stops and waits at the same points', () => {
    expect(dateOf('SIGNUP_EVENT_SINCE')).toBe(SIGNUP_EVENT_SINCE);
    expect(dateOf('OAUTH_CALLBACK_SENT_UNTIL')).toBe(OAUTH_CALLBACK_SENT_UNTIL);
    expect(Number(constant('MAX_TRIES'))).toBe(WELCOME_MAX_TRIES);
    expect(Number(constant('CLAIM_SETTLE_MS'))).toBe(CLAIM_SETTLE_MS);
    expect(SIGNUP_EVENT_SINCE).toBe(Date.parse('2026-11-12T21:00:00Z'));
    expect(OAUTH_CALLBACK_SENT_UNTIL).toBe(Date.parse('2026-11-14T16:00:00Z'));
  });
});

const account = (fields = {}) => ({
  id: 'u1',
  email: 'ada@example.com',
  created_at: '2026-11-15T09:00:00Z',
  email_confirmed_at: '2026-11-15T09:01:00Z',
  last_sign_in_at: '2026-11-15T09:01:00Z',
  invited_at: null,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Ada Lovelace' },
  ...fields,
});

describe('welcomeStatus', () => {
  it('owes a confirmed, signed-in sign-up with no claim', () => {
    expect(welcomeStatus(account())).toBe('owed');
  });

  it('leaves out who the web never welcomes, and who has a claim', () => {
    expect(welcomeStatus(account({ created_at: '2026-11-12T20:59:59Z' }))).toBe('before-since');
    expect(welcomeStatus(account({ invited_at: '2026-11-15T09:00:00Z' }))).toBe('invited');
    expect(welcomeStatus(account({ email_confirmed_at: null }))).toBe('unconfirmed');
    expect(welcomeStatus(account({ last_sign_in_at: null }))).toBe('never-signed-in');
    expect(welcomeStatus(account({ email: '' }))).toBe('no-email');
    expect(
      welcomeStatus(
        account({
          app_metadata: { provider: 'email', signup_event_at: 'x', signup_event_tries: 1 },
        }),
      ),
    ).toBe('claimed');
  });

  describe('an old-style claim (from before the split: no tries, no claim id)', () => {
    const claimed = (extra) =>
      account({ app_metadata: { provider: 'email', signup_event_at: 'x', ...extra } });

    it('is left out by default, and owed with includeOldClaims', () => {
      expect(isOldClaim(claimed().app_metadata)).toBe(true);
      expect(welcomeStatus(claimed())).toBe('old-claim');
      expect(welcomeStatus(claimed(), { includeOldClaims: true })).toBe('owed');
      // Still only from --since, and only as the other rules allow.
      expect(
        welcomeStatus(claimed(), {
          includeOldClaims: true,
          since: Date.parse('2026-11-16T00:00:00Z'),
        }),
      ).toBe('before-since');
      expect(welcomeStatus(claimed({ provider: 'github' }), { includeOldClaims: true })).toBe(
        'owed',
      );
      const early = account({
        created_at: '2026-11-14T10:00:00Z',
        app_metadata: { provider: 'google', signup_event_at: 'x' },
      });
      expect(welcomeStatus(early, { includeOldClaims: true })).toBe('early-oauth');
    });

    it('a new-style claim is never included, either way', () => {
      for (const extra of [
        { signup_event_tries: 1, signup_claim_id: 'c1' },
        { signup_event_tries: 1 },
        { signup_claim_id: 'c1' },
      ]) {
        expect(isOldClaim(claimed(extra).app_metadata)).toBe(false);
        expect(welcomeStatus(claimed(extra))).toBe('claimed');
        expect(welcomeStatus(claimed(extra), { includeOldClaims: true })).toBe('claimed');
      }
      expect(isOldClaim({ provider: 'email' })).toBe(false);
    });
  });

  it('takes a later --since, never an earlier one', () => {
    const since = Date.parse('2026-11-16T00:00:00Z');
    expect(welcomeStatus(account(), { since })).toBe('before-since');
    expect(welcomeStatus(account({ created_at: '2026-11-12T20:00:00Z' }), { since: 0 })).toBe(
      'before-since',
    );
  });

  it('leaves out a Google or GitHub account made before the cut-off unless asked', () => {
    const google = (created_at) =>
      account({ created_at, app_metadata: { provider: 'google', providers: ['google'] } });
    expect(welcomeStatus(google('2026-11-14T15:59:59Z'))).toBe('early-oauth');
    expect(welcomeStatus(google('2026-11-14T15:59:59Z'), { includeEarlyOAuth: true })).toBe('owed');
    expect(welcomeStatus(google('2026-11-14T16:00:00Z'))).toBe('owed');
    // An e-mail sign-up was never sent it by the callback.
    expect(welcomeStatus(account({ created_at: '2026-11-13T10:00:00Z' }))).toBe('owed');
  });
});

/** The service client's auth.admin, over one account. */
function adminOver(user) {
  const state = { user: copy(user) };
  const admin = {
    getUserById: vi.fn(async () => ({ data: { user: copy(state.user) }, error: null })),
    updateUserById: vi.fn(async (_id, { app_metadata }) => {
      const meta = { ...state.user.app_metadata };
      for (const [key, value] of Object.entries(app_metadata)) {
        if (value === null) delete meta[key];
        else meta[key] = value;
      }
      state.user = { ...state.user, app_metadata: meta };
      return { data: { user: state.user }, error: null };
    }),
  };
  return { admin, state };
}

describe('claimWelcome', () => {
  const isOwed = (user) => welcomeStatus(user) === 'owed';
  const now = () => Date.parse('2026-11-16T10:00:00Z');

  it('writes the claim with a new id and one more try, waits, and reads it back', async () => {
    const { admin, state } = adminOver(
      account({ app_metadata: { provider: 'email', signup_event_tries: 2 } }),
    );
    const sleep = vi.fn(async () => {});
    const claimed = await claimWelcome(admin, 'u1', { isOwed, sleep, now, newClaimId: () => 'c1' });
    expect(claimed).toMatchObject({ id: 'u1' });
    // The whole app_metadata, as read, with the claim on it.
    expect(admin.updateUserById).toHaveBeenCalledWith('u1', {
      app_metadata: {
        provider: 'email',
        signup_claim_id: 'c1',
        signup_event_at: '2026-11-16T10:00:00.000Z',
        signup_event_tries: 3,
      },
    });
    expect(sleep).toHaveBeenCalledWith(CLAIM_SETTLE_MS);
    expect(state.user.app_metadata.provider).toBe('email');
  });

  it('claims nothing for an account no longer owed it, and sends nothing for a lost claim', async () => {
    const claimedBefore = adminOver(
      account({ app_metadata: { provider: 'email', signup_event_at: 'x' } }),
    );
    const sleep = async () => {};
    expect(await claimWelcome(claimedBefore.admin, 'u1', { isOwed, sleep, now })).toBeNull();
    expect(claimedBefore.admin.updateUserById).not.toHaveBeenCalled();

    // A web page's claim landed over this one before it was read back.
    const { admin, state } = adminOver(account());
    const lose = async () => {
      state.user.app_metadata = { ...state.user.app_metadata, signup_claim_id: 'theirs' };
    };
    expect(await claimWelcome(admin, 'u1', { isOwed, sleep: lose, now })).toBeNull();

    const failing = adminOver(account());
    failing.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    expect(await claimWelcome(failing.admin, 'u1', { isOwed, sleep, now })).toBeNull();
  });

  it('replaces an old-style claim with a new-style one, keeping PostHog had it', async () => {
    const { admin, state } = adminOver(
      account({ app_metadata: { provider: 'google', signup_event_at: '2026-11-16T07:00:30Z' } }),
    );
    const isOwedOld = (user) => welcomeStatus(user, { includeOldClaims: true }) === 'owed';
    const claimed = await claimWelcome(admin, 'u1', {
      isOwed: isOwedOld,
      sleep: async () => {},
      now,
      newClaimId: () => 'c2',
    });
    expect(claimed).not.toBeNull();
    expect(state.user.app_metadata).toEqual({
      provider: 'google',
      signup_claim_id: 'c2',
      signup_event_at: '2026-11-16T10:00:00.000Z',
      signup_event_tries: 1,
      signup_posthog_at: '2026-11-16T07:00:30Z',
    });
    expect(isOldClaim(state.user.app_metadata)).toBe(false);
    expect(welcomeStatus(state.user, { includeOldClaims: true })).toBe('claimed');
  });

  it('releases a claim, keeping the count of tries', async () => {
    const { admin, state } = adminOver(
      account({
        app_metadata: { provider: 'email', signup_event_at: 'x', signup_event_tries: 1 },
      }),
    );
    expect(await releaseWelcome(admin, copy(state.user))).toBe(true);
    expect(state.user.app_metadata).toEqual({ provider: 'email', signup_event_tries: 1 });
  });

  it('is right whether the Auth server merges app_metadata or replaces it', async () => {
    const { admin, state } = adminOver(
      account({ app_metadata: { provider: 'google', providers: ['google'] } }),
    );
    // Replaces it whole.
    admin.updateUserById.mockImplementation(async (_id, { app_metadata }) => {
      state.user = { ...state.user, app_metadata };
      return { data: { user: state.user }, error: null };
    });
    const claimed = await claimWelcome(admin, 'u1', { isOwed, sleep: async () => {}, now });
    expect(state.user.app_metadata).toMatchObject({ provider: 'google', providers: ['google'] });
    expect(await releaseWelcome(admin, claimed)).toBe(true);
    expect(state.user.app_metadata).toMatchObject({
      provider: 'google',
      providers: ['google'],
      signup_event_at: null,
      signup_event_tries: 1,
    });
    // Released reads as owed again.
    expect(welcomeStatus(state.user)).toBe('owed');
  });
});

describe('sendWelcomeEvent', () => {
  it("sends Resend's user.signed_up with the e-mail and first name, and says it was accepted", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await sendWelcomeEvent(account(), { apiKey: 're_test', fetchImpl })).toEqual({
      result: 'accepted',
      status: 200,
      error: null,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.resend.com/events/send');
    expect(init.headers.Authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body)).toEqual({
      event: 'user.signed_up',
      email: 'ada@example.com',
      payload: { first_name: 'Ada' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('says a 4xx was refused: Resend surely did not take it', async () => {
    for (const status of [400, 401, 403, 404, 408, 409, 422, 429]) {
      const fetchImpl = vi.fn(async () => ({ ok: false, status }));
      expect(await sendWelcomeEvent(account(), { apiKey: 're_test', fetchImpl })).toEqual({
        result: 'refused',
        status,
        error: null,
      });
    }
  });

  it('says a 5xx is unknown: Resend may have stored the event before it failed', async () => {
    for (const status of [500, 502, 503, 504]) {
      const fetchImpl = vi.fn(async () => ({ ok: false, status }));
      expect(await sendWelcomeEvent(account(), { apiKey: 're_test', fetchImpl })).toEqual({
        result: 'unknown',
        status,
        error: null,
      });
    }
  });

  it('says a timeout, an abort or a network error is unknown, by name only', async () => {
    const thrown = [
      Object.assign(new Error('The operation timed out for ada@example.com'), {
        name: 'TimeoutError',
      }),
      Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }),
      new TypeError('fetch failed'),
    ];
    for (const err of thrown) {
      const fetchImpl = vi.fn(async () => {
        throw err;
      });
      expect(await sendWelcomeEvent(account(), { apiKey: 're_test', fetchImpl })).toEqual({
        result: 'unknown',
        status: null,
        error: err.name,
      });
    }
  });

  it('sends nothing without a key or an address: refused, as Resend never saw it', async () => {
    const none = vi.fn();
    expect(await sendWelcomeEvent(account(), { apiKey: '', fetchImpl: none })).toEqual({
      result: 'refused',
      status: null,
      error: 'not sent',
    });
    expect(
      (await sendWelcomeEvent(account({ email: '' }), { apiKey: 're_test', fetchImpl: none }))
        .result,
    ).toBe('refused');
    expect(none).not.toHaveBeenCalled();
  });

  it('sorts statuses as the web does (lib/send-outcome.ts)', () => {
    expect([200, 202, 299].map(resultOf)).toEqual(['accepted', 'accepted', 'accepted']);
    expect([400, 422, 429, 499].map(resultOf)).toEqual([
      'refused',
      'refused',
      'refused',
      'refused',
    ]);
    expect([500, 502, 503, 504, 599, null].map(resultOf)).toEqual(Array(6).fill('unknown'));
  });

  it('takes the first word of the full name or the name', () => {
    expect(firstNameOf({ user_metadata: { full_name: ' Ada Lovelace ' } })).toBe('Ada');
    expect(firstNameOf({ user_metadata: { name: 'Grace Hopper' } })).toBe('Grace');
    expect(firstNameOf({ user_metadata: {} })).toBe('');
  });
});
