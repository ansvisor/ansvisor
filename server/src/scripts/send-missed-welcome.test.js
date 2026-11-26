import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_SETTLE_MS, SIGNUP_EVENT_SINCE } from '../lib/welcome-claim.js';
import { exitCodeOf, parseArgs, run } from './send-missed-welcome.js';

/** A deep copy, as the Auth server's JSON answers are. */
const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * The missed-welcome script over an in-memory Auth server and a fake Resend:
 * nothing real is called (the global fetch throws if it ever is).
 */

const person = (n, fields = {}) => ({
  id: `u${n}`,
  email: `person${n}@example.com`,
  created_at: '2026-11-15T09:00:00Z',
  email_confirmed_at: '2026-11-15T09:01:00Z',
  last_sign_in_at: '2026-11-15T09:01:00Z',
  invited_at: null,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: `Name${n} Surname${n}` },
  ...fields,
});

const ACCOUNTS = [
  person(1, { created_at: '2026-11-16T08:00:00Z' }),
  person(2, {
    created_at: '2026-11-15T12:00:00Z',
    app_metadata: { provider: 'google', providers: ['google'] },
  }),
  // A new-style claim: never picked, with or without --include-old-claims.
  person(3, {
    app_metadata: {
      provider: 'email',
      signup_event_at: '2026-11-15T09:02:00Z',
      signup_event_tries: 1,
      signup_claim_id: 'c3',
    },
  }),
  person(4, { email_confirmed_at: null, last_sign_in_at: null }),
  person(5, { invited_at: '2026-11-15T08:00:00Z' }),
  person(6, { last_sign_in_at: null }),
  person(7, { created_at: '2026-11-01T09:00:00Z' }),
  person(8, {
    created_at: '2026-11-13T10:00:00Z',
    app_metadata: { provider: 'github', providers: ['github'] },
  }),
  // An old-style claim (no tries, no claim id): a Google sign-up whose first
  // page claimed both events while the web had no Resend key.
  person(9, {
    created_at: '2026-11-16T07:00:00Z',
    app_metadata: {
      provider: 'google',
      providers: ['google'],
      signup_event_at: '2026-11-16T07:00:30.000Z',
    },
  }),
];
const OLD_CLAIM_AT = '2026-11-16T07:00:30.000Z';

/** The service client's auth.admin over these accounts. */
function authServer(accounts, { perPage } = {}) {
  const users = new Map(accounts.map((user) => [user.id, copy(user)]));
  return {
    users,
    listUsers: vi.fn(async ({ page, perPage: size }) => {
      const all = [...users.values()];
      const step = perPage ?? size;
      return { data: { users: all.slice((page - 1) * step, page * step) }, error: null };
    }),
    getUserById: vi.fn(async (id) => ({
      data: { user: copy(users.get(id)) },
      error: null,
    })),
    updateUserById: vi.fn(async (id, { app_metadata }) => {
      const user = users.get(id);
      const meta = { ...user.app_metadata };
      for (const [key, value] of Object.entries(app_metadata)) {
        if (value === null) delete meta[key];
        else meta[key] = value;
      }
      users.set(id, { ...user, app_metadata: meta });
      return { data: { user: users.get(id) }, error: null };
    }),
  };
}

let lines;
const log = (line) => lines.push(line);
const sleep = vi.fn(async () => {});
const output = () => lines.join('\n');
const PRIVATE = /@example\.com|Name\d|Surname\d|re_test/;

beforeEach(() => {
  lines = [];
  sleep.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('a real call');
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('parseArgs', () => {
  it('is a dry run from 13 Nov 2026, 00:00 Istanbul time, by default', () => {
    expect(parseArgs([])).toMatchObject({
      send: false,
      since: SIGNUP_EVENT_SINCE,
      pauseMs: 1000,
      includeEarlyOAuth: false,
      includeOldClaims: false,
    });
    expect(parseArgs(['--dry-run']).send).toBe(false);
  });

  it('reads --send, --since, --pause-ms, --include-early-oauth and --include-old-claims', () => {
    expect(
      parseArgs([
        '--send',
        '--since',
        '2026-11-15',
        '--pause-ms=250',
        '--include-early-oauth',
        '--include-old-claims',
      ]),
    ).toMatchObject({
      send: true,
      since: Date.parse('2026-11-15'),
      pauseMs: 250,
      includeEarlyOAuth: true,
      includeOldClaims: true,
    });
    expect(parseArgs(['--since=2026-11-14T00:00:00+03:00']).since).toBe(
      Date.parse('2026-11-13T21:00:00Z'),
    );
  });

  it('refuses a --since before the Automation started, and bad or unknown options', () => {
    expect(() => parseArgs(['--since', '2026-11-12'])).toThrow(/never sent the welcome/);
    expect(() => parseArgs(['--since', 'yesterday'])).toThrow(/isn't a date/);
    expect(() => parseArgs(['--pause-ms', '-5'])).toThrow(/whole number/);
    expect(() => parseArgs(['--send', '--dry-run'])).toThrow(/pick one/);
    expect(() => parseArgs(['--all'])).toThrow(/Unknown option/);
  });
});

describe('a dry run', () => {
  it('prints the count and the dates, never an address or a name, and writes nothing', async () => {
    const admin = authServer(ACCOUNTS);
    const result = await run(parseArgs([]), { admin, apiKey: 're_test', sleep, log });
    expect(result).toMatchObject({ owed: 2, sent: 0 });
    expect(lines[0]).toBe(
      'Accounts made since 2026-11-12T21:00:00.000Z that missed the welcome: 2',
    );
    expect(lines.slice(1, 3)).toEqual([
      '  made 2026-11-15T12:00:00Z (google)',
      '  made 2026-11-16T08:00:00Z (email)',
    ]);
    expect(output()).toContain('already claimed (signup_event_at): 1');
    expect(output()).toMatch(/old-style claim .*--include-old-claims.*: 1/);
    expect(output()).not.toContain('Of these, old-style claims');
    expect(output()).toContain('e-mail never confirmed (never welcomed, by design): 1');
    expect(output()).toContain('invited to a workspace (never welcomed): 1');
    expect(output()).toContain('never signed in: 1');
    expect(output()).toMatch(/Google or GitHub, made before 2026-11-14T16:00:00\.000Z.*: 1/);
    expect(output()).toContain('Dry run: nothing claimed or sent.');
    expect(output()).not.toMatch(PRIVATE);
    expect(output()).not.toMatch(/\bu\d\b/);
    expect(admin.updateUserById).not.toHaveBeenCalled();
    expect(admin.getUserById).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('needs no Resend key, and counts early Google or GitHub accounts only when asked', async () => {
    const admin = authServer(ACCOUNTS);
    const result = await run(parseArgs(['--include-early-oauth']), { admin, sleep, log });
    expect(result.owed).toBe(3);
    expect(output()).toContain('  made 2026-11-13T10:00:00Z (github)');
  });

  it('leaves out an old-style claim by default, and includes it with --include-old-claims', async () => {
    const admin = authServer(ACCOUNTS);
    const result = await run(parseArgs(['--include-old-claims']), { admin, sleep, log });
    expect(result).toMatchObject({ owed: 3, oldClaims: 1 });
    expect(lines.slice(1, 4)).toEqual([
      '  made 2026-11-15T12:00:00Z (google)',
      '  made 2026-11-16T07:00:00Z (google, old-style claim)',
      '  made 2026-11-16T08:00:00Z (email)',
    ]);
    expect(output()).toContain('Of these, old-style claims (--include-old-claims): 1');
    // The new-style claim stays left out.
    expect(output()).toContain('already claimed (signup_event_at): 1');
    expect(output()).not.toMatch(/old-style claim \(signup_event_at/);
    expect(output()).not.toMatch(PRIVATE);
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it('reads every page of accounts', async () => {
    const many = Array.from({ length: 2500 }, (_, n) =>
      person(100 + n, {
        created_at: new Date(Date.parse('2026-11-14T00:00:00Z') + n * 1000).toISOString(),
      }),
    );
    const admin = authServer(many);
    const result = await run(parseArgs([]), { admin, sleep, log });
    expect(admin.listUsers).toHaveBeenCalledTimes(3);
    expect(result.owed).toBe(2500);
  });
});

describe('--send', () => {
  it('claims each account as the web does, sends, and releases the claim only on a 4xx', async () => {
    const admin = authServer(ACCOUNTS);
    // u2 (made first) is refused, u1 accepted.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 422 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await run(parseArgs(['--send', '--pause-ms', '700']), {
      admin,
      apiKey: 're_test',
      fetchImpl,
      sleep,
      log,
    });
    expect(result).toMatchObject({
      owed: 2,
      sent: 1,
      refused: 1,
      unknown: 0,
      skipped: 0,
      unreleased: 0,
    });

    // Claimed before each send, keyed by the listed account's id.
    expect(admin.updateUserById.mock.calls[0]).toEqual([
      'u2',
      {
        app_metadata: {
          provider: 'google',
          providers: ['google'],
          signup_claim_id: expect.any(String),
          signup_event_at: expect.any(String),
          signup_event_tries: 1,
        },
      },
    ]);
    expect(admin.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
      fetchImpl.mock.invocationCallOrder[0],
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      event: 'user.signed_up',
      email: 'person2@example.com',
      payload: { first_name: 'Name2' },
    });
    // Refused: released, the try counted. Accepted: kept.
    expect(admin.users.get('u2').app_metadata).not.toHaveProperty('signup_event_at');
    expect(admin.users.get('u2').app_metadata.signup_event_tries).toBe(1);
    expect(admin.users.get('u1').app_metadata).toMatchObject({
      signup_event_at: expect.any(String),
      signup_event_tries: 1,
    });
    // Nobody else touched: not the old-style claim either, without the flag.
    expect(new Set(admin.updateUserById.mock.calls.map(([id]) => id))).toEqual(
      new Set(['u1', 'u2']),
    );
    expect(admin.users.get('u9').app_metadata).toEqual(ACCOUNTS[8].app_metadata);
    // The claim's wait for each, and a pause between the two sends.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([CLAIM_SETTLE_MS, 700, CLAIM_SETTLE_MS]);
    expect(output()).toContain(
      'made 2026-11-15T12:00:00Z (google): refused (HTTP 422); claim released',
    );
    expect(output()).toContain('made 2026-11-16T08:00:00Z (email): sent');
    expect(lines.at(-1)).toBe(
      'Done: 1 sent, 1 refused (claim released), 0 kept (unknown), 0 skipped',
    );
    expect(exitCodeOf(result)).toBe(1);
    expect(output()).not.toMatch(PRIVATE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the claim when Resend times out, so a second run never sends it again', async () => {
    const admin = authServer(ACCOUNTS);
    const timedOut = vi.fn(async () => {
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    });
    const result = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl: timedOut,
      sleep,
      log,
    });
    expect(result).toMatchObject({ sent: 0, refused: 0, unknown: 2, unreleased: 0 });
    expect(output()).toContain(
      'made 2026-11-16T08:00:00Z (email): unknown (TimeoutError); claim kept, as Resend may have it',
    );
    // Claimed, never released.
    expect(admin.updateUserById).toHaveBeenCalledTimes(2);
    expect(admin.users.get('u1').app_metadata).toMatchObject({
      signup_event_at: expect.any(String),
      signup_event_tries: 1,
    });
    expect(exitCodeOf(result)).toBe(1);

    const none = vi.fn();
    const again = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl: none,
      sleep,
      log,
    });
    expect(again).toMatchObject({ owed: 0, sent: 0 });
    expect(none).not.toHaveBeenCalled();
  });

  it('keeps the claim on a network error too', async () => {
    const admin = authServer([ACCOUNTS[0]]);
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl: down,
      sleep,
      log,
    });
    expect(result).toMatchObject({ sent: 0, refused: 0, unknown: 1 });
    expect(output()).toContain('unknown (TypeError); claim kept, as Resend may have it');
    expect(admin.users.get('u1').app_metadata.signup_event_at).toEqual(expect.any(String));
  });

  it('releases a refused claim (a 4xx), and a second run sends only what is left', async () => {
    const admin = authServer(ACCOUNTS);
    const refused = vi.fn(async () => ({ ok: false, status: 429 }));
    await run(parseArgs(['--send']), { admin, apiKey: 're_test', fetchImpl: refused, sleep, log });
    expect(output()).toContain('refused (HTTP 429); claim released');
    expect(admin.users.get('u1').app_metadata).not.toHaveProperty('signup_event_at');

    const accepted = vi.fn(async () => ({ ok: true, status: 202 }));
    const again = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl: accepted,
      sleep,
      log,
    });
    expect(again).toMatchObject({ sent: 2, refused: 0, unknown: 0 });
    expect(admin.users.get('u1').app_metadata.signup_event_tries).toBe(2);
    expect(exitCodeOf(again)).toBe(0);

    // Everyone has it now: a third run sends nothing.
    const none = vi.fn();
    const third = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl: none,
      sleep,
      log,
    });
    expect(third).toMatchObject({ owed: 0, sent: 0 });
    expect(none).not.toHaveBeenCalled();
  });

  it('prints each outcome, and a summary that counts "kept (unknown)" apart', async () => {
    const made = (n) => `2026-11-15T1${n}:00:00Z`;
    const admin = authServer([1, 2, 3, 4, 5, 6].map((n) => person(n, { created_at: made(n) })));
    // In order of creation: a 2xx, a 4xx, a 5xx, a timeout, a 4xx whose
    // release fails, and one a web page claimed meanwhile.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 400 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce({ ok: false, status: 422 });
    const write = admin.updateUserById.getMockImplementation();
    admin.updateUserById.mockImplementation(async (id, attrs) =>
      // u5's release (its claim's null) fails.
      id === 'u5' && attrs.app_metadata.signup_event_at === null
        ? { data: null, error: { status: 500 } }
        : write(id, attrs),
    );
    const settle = vi.fn(async () => {
      const u6 = admin.users.get('u6');
      if (u6.app_metadata.signup_claim_id) u6.app_metadata.signup_claim_id = 'a-page';
    });
    const result = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl,
      sleep: settle,
      log,
    });
    expect(result).toEqual({
      owed: 6,
      oldClaims: 0,
      stuck: 0,
      sent: 1,
      posthogSent: 0,
      refused: 2,
      unknown: 2,
      skipped: 1,
      unreleased: 1,
    });
    const sends = lines.filter((line) => line.startsWith('  made') && line.includes('):'));
    expect(sends).toEqual([
      `  made ${made(1)} (email): sent`,
      `  made ${made(2)} (email): refused (HTTP 400); claim released`,
      `  made ${made(3)} (email): unknown (HTTP 503); claim kept, as Resend may have it`,
      `  made ${made(4)} (email): unknown (TimeoutError); claim kept, as Resend may have it`,
      `  made ${made(5)} (email): refused (HTTP 422); claim NOT released`,
      `  made ${made(6)} (email): skipped (no longer owed, claimed elsewhere, or not claimable)`,
    ]);
    expect(lines.slice(-2)).toEqual([
      'Done: 1 sent, 2 refused (claim released), 2 kept (unknown), 1 skipped, ' +
        '1 claim(s) not released',
      "Kept (unknown): check Resend's Events for user.signed_up at those times before " +
        'clearing a claim by hand (see the header of this script).',
    ]);
    expect(exitCodeOf(result)).toBe(1);
    expect(output()).not.toMatch(PRIVATE);
  });

  it('exits 0 only when every send was accepted or skipped', () => {
    const none = { sent: 0, refused: 0, unknown: 0, skipped: 0, unreleased: 0 };
    expect(exitCodeOf({ ...none, sent: 3, skipped: 1 })).toBe(0);
    expect(exitCodeOf({ ...none, refused: 1 })).toBe(1);
    expect(exitCodeOf({ ...none, unknown: 1 })).toBe(1);
    expect(exitCodeOf({ ...none, unreleased: 1 })).toBe(1);
  });

  it('with --include-old-claims, claims an old-style claim again the new way, and never picks it twice', async () => {
    const admin = authServer(ACCOUNTS);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const send = parseArgs(['--send', '--include-old-claims']);
    const result = await run(send, { admin, apiKey: 're_test', fetchImpl, sleep, log });
    expect(result).toMatchObject({ owed: 3, oldClaims: 1, sent: 3, refused: 0 });

    // Claimed again before the send: a new claim id, a try, and PostHog's own
    // claim from the old one (it covered both), so the web never sends PostHog's again.
    const claim = admin.updateUserById.mock.calls.find(([id]) => id === 'u9');
    expect(claim[1]).toEqual({
      app_metadata: {
        provider: 'google',
        providers: ['google'],
        signup_claim_id: expect.any(String),
        signup_event_at: expect.any(String),
        signup_event_tries: 1,
        signup_posthog_at: OLD_CLAIM_AT,
      },
    });
    expect(claim[1].app_metadata.signup_event_at).not.toBe(OLD_CLAIM_AT);
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).email)).toContain(
      'person9@example.com',
    );
    expect(admin.users.get('u9').app_metadata).toMatchObject({
      provider: 'google',
      signup_event_tries: 1,
      signup_claim_id: expect.any(String),
      signup_posthog_at: OLD_CLAIM_AT,
    });
    // The new-style claim was never touched.
    expect(admin.users.get('u3').app_metadata).toEqual(ACCOUNTS[2].app_metadata);
    expect(output()).toContain('made 2026-11-16T07:00:00Z (google, old-style claim): sent');
    expect(output()).not.toMatch(PRIVATE);

    // Now new-style: a second run with the flag picks nobody.
    lines = [];
    const again = await run(send, { admin, apiKey: 're_test', fetchImpl, sleep, log });
    expect(again).toMatchObject({ owed: 0, oldClaims: 0, sent: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('with --include-old-claims, releases a refused old-style claim as a new-style account still owed', async () => {
    const admin = authServer([ACCOUNTS[8]]);
    const refused = vi.fn(async () => ({ ok: false, status: 429 }));
    const result = await run(parseArgs(['--send', '--include-old-claims']), {
      admin,
      apiKey: 're_test',
      fetchImpl: refused,
      sleep,
      log,
    });
    expect(result).toMatchObject({ sent: 0, refused: 1 });
    const meta = admin.users.get('u9').app_metadata;
    expect(meta).not.toHaveProperty('signup_event_at');
    expect(meta).toMatchObject({ signup_event_tries: 1, signup_posthog_at: OLD_CLAIM_AT });

    // No longer old-style: the next run sends it without the flag.
    lines = [];
    const accepted = vi.fn(async () => ({ ok: true, status: 200 }));
    const again = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl: accepted,
      sleep,
      log,
    });
    expect(again).toMatchObject({ owed: 1, oldClaims: 0, sent: 1 });
    expect(admin.users.get('u9').app_metadata.signup_event_tries).toBe(2);
  });

  it('skips an account a web page claimed meanwhile', async () => {
    const admin = authServer(ACCOUNTS);
    // A page's claim lands over the script's before it is read back.
    const settle = vi.fn(async () => {
      for (const user of admin.users.values()) {
        user.app_metadata = { ...user.app_metadata, signup_claim_id: 'a-page' };
      }
    });
    const fetchImpl = vi.fn();
    const result = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl,
      sleep: settle,
      log,
    });
    expect(result).toMatchObject({ sent: 0, skipped: 2 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses to start without RESEND_API_KEY', async () => {
    const admin = authServer(ACCOUNTS);
    await expect(run(parseArgs(['--send']), { admin, apiKey: '', sleep, log })).rejects.toThrow(
      /RESEND_API_KEY is not set/,
    );
    expect(admin.listUsers).not.toHaveBeenCalled();
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });
});

describe('--stuck-since', () => {
  const NOW = Date.parse('2026-11-25T10:00:00Z');
  const now = () => NOW;
  // Claimed by its first page on 20 Nov, read back wrong (readback_mismatch): nothing sent.
  const stuckPerson = person(10, {
    created_at: '2026-11-20T09:00:00Z',
    email_confirmed_at: '2026-11-20T09:01:00Z',
    last_sign_in_at: '2026-11-20T09:01:00Z',
    app_metadata: {
      provider: 'google',
      providers: ['google'],
      signup_event_at: '2026-11-20T09:01:05.000Z',
      signup_event_tries: 1,
      signup_posthog_at: '2026-11-20T09:01:05.000Z',
      signup_posthog_tries: 1,
      signup_claim_id: 'c10',
    },
  });

  it('reads the date, and refuses one that is not', () => {
    expect(parseArgs(['--stuck-since', '2026-11-19T00:00:00Z']).stuckSince).toBe(
      Date.parse('2026-11-19T00:00:00Z'),
    );
    expect(parseArgs([]).stuckSince).toBeNull();
    expect(() => parseArgs(['--stuck-since', 'soon'])).toThrow("--stuck-since isn't a date");
  });

  it('leaves a stuck claim out without it', async () => {
    const admin = authServer([...ACCOUNTS, stuckPerson]);
    const result = await run(parseArgs([]), { admin, sleep, log, now });
    expect(result.owed).toBe(2);
    expect(output()).not.toContain('stuck');
  });

  it('sends the welcome and PostHog signed_up again for a claim written in the window, once', async () => {
    const admin = authServer([...ACCOUNTS, stuckPerson]);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const posthog = vi.fn(async (events) => events.length);
    const opts = parseArgs(['--send', '--stuck-since', '2026-11-19T00:00:00Z']);

    const result = await run(opts, {
      admin,
      apiKey: 're_test',
      fetchImpl,
      sleep,
      log,
      now,
      posthog,
    });

    // u1 and u2 as before, and u10; u3's claim (15 Nov) is before the window.
    expect(result).toMatchObject({ owed: 3, stuck: 1, sent: 3, posthogSent: 1 });
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).email)).toContain(
      'person10@example.com',
    );
    expect(posthog).toHaveBeenCalledWith([
      {
        event: 'signed_up',
        distinctId: 'u10',
        properties: { source: 'oauth', provider: 'google' },
        timestamp: '2026-11-20T09:00:00Z',
      },
    ]);
    const meta = admin.users.get('u10').app_metadata;
    expect(meta.signup_event_tries).toBe(2);
    expect(meta.signup_claim_id).not.toBe('c10');
    expect(meta.signup_event_at).toBe(new Date(NOW).toISOString());
    expect(meta.signup_posthog_at).toBe(new Date(NOW).toISOString());
    expect(admin.users.get('u3').app_metadata).toEqual(ACCOUNTS[2].app_metadata);
    expect(output()).toContain('(google, stuck claim): PostHog signed_up sent');
    expect(output()).not.toMatch(PRIVATE);

    // Claimed again by this run: a second run picks nobody.
    lines = [];
    const again = await run(opts, {
      admin,
      apiKey: 're_test',
      fetchImpl,
      sleep,
      log,
      now,
      posthog,
    });
    expect(again).toMatchObject({ owed: 0, sent: 0, posthogSent: 0 });
    expect(posthog).toHaveBeenCalledTimes(1);
  });

  it('sends no PostHog event, and keeps its claim as it was, without the key', async () => {
    const admin = authServer([stuckPerson]);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const opts = parseArgs(['--send', '--stuck-since', '2026-11-19T00:00:00Z']);

    const result = await run(opts, { admin, apiKey: 're_test', fetchImpl, sleep, log, now });

    expect(result).toMatchObject({ owed: 1, sent: 1, posthogSent: 0 });
    expect(admin.users.get('u10').app_metadata.signup_posthog_at).toBe('2026-11-20T09:01:05.000Z');
  });
});
