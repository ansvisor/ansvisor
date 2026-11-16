import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_SETTLE_MS, SIGNUP_EVENT_SINCE } from '../lib/welcome-claim.js';
import { parseArgs, run } from './send-missed-welcome.js';

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
  person(3, { app_metadata: { provider: 'email', signup_event_at: '2026-11-15T09:02:00Z' } }),
  person(4, { email_confirmed_at: null, last_sign_in_at: null }),
  person(5, { invited_at: '2026-11-15T08:00:00Z' }),
  person(6, { last_sign_in_at: null }),
  person(7, { created_at: '2026-11-01T09:00:00Z' }),
  person(8, {
    created_at: '2026-11-13T10:00:00Z',
    app_metadata: { provider: 'github', providers: ['github'] },
  }),
];

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
    });
    expect(parseArgs(['--dry-run']).send).toBe(false);
  });

  it('reads --send, --since, --pause-ms and --include-early-oauth', () => {
    expect(
      parseArgs(['--send', '--since', '2026-11-15', '--pause-ms=250', '--include-early-oauth']),
    ).toMatchObject({
      send: true,
      since: Date.parse('2026-11-15'),
      pauseMs: 250,
      includeEarlyOAuth: true,
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
  it('claims each account as the web does, sends, and keeps the claim only on a 2xx', async () => {
    const admin = authServer(ACCOUNTS);
    // u2 (made first) is refused, u1 accepted.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await run(parseArgs(['--send', '--pause-ms', '700']), {
      admin,
      apiKey: 're_test',
      fetchImpl,
      sleep,
      log,
    });
    expect(result).toMatchObject({ owed: 2, sent: 1, refused: 1, skipped: 0, unreleased: 0 });

    // Claimed before each send, keyed by the listed account's id.
    expect(admin.updateUserById.mock.calls[0]).toEqual([
      'u2',
      {
        app_metadata: {
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
    // Nobody else touched.
    expect(new Set(admin.updateUserById.mock.calls.map(([id]) => id))).toEqual(
      new Set(['u1', 'u2']),
    );
    // The claim's wait for each, and a pause between the two sends.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([CLAIM_SETTLE_MS, 700, CLAIM_SETTLE_MS]);
    expect(output()).toContain(
      'made 2026-11-15T12:00:00Z: not accepted (HTTP 500); claim released',
    );
    expect(output()).toContain('made 2026-11-16T08:00:00Z: sent');
    expect(output()).toContain('Done: 1 sent, 1 not accepted (claim released), 0 skipped');
    expect(output()).not.toMatch(PRIVATE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('releases the claim when Resend does not answer, and a second run sends only what is left', async () => {
    const admin = authServer(ACCOUNTS);
    const timedOut = vi.fn(async () => {
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    });
    await run(parseArgs(['--send']), { admin, apiKey: 're_test', fetchImpl: timedOut, sleep, log });
    expect(output()).toContain('not accepted (TimeoutError); claim released');
    expect(admin.users.get('u1').app_metadata).not.toHaveProperty('signup_event_at');

    const accepted = vi.fn(async () => ({ ok: true, status: 202 }));
    const again = await run(parseArgs(['--send']), {
      admin,
      apiKey: 're_test',
      fetchImpl: accepted,
      sleep,
      log,
    });
    expect(again).toMatchObject({ sent: 2, refused: 0 });
    expect(admin.users.get('u1').app_metadata.signup_event_tries).toBe(2);

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
