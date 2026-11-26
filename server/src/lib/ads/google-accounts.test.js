import { describe, expect, it, vi } from 'vitest';

/**
 * Google Ads accounts on a brand (Ads Phase 1, G2): only the brand's own
 * live sign-in, and only one of the route's workspace, lists or connects
 * customers (CLAUDE.md rule 3); a customer id only counts when that sign-in
 * reaches it now; a manager account is listed, never connected.
 */

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../composio.js', () => ({
  isComposioConfigured: () => true,
  getActiveConnection: async () => null,
  executeGoogleAdsTool: async () => null,
}));

const { AdsAccountError } = await import('./accounts.js');
const { connectGoogleAccounts, googleSignIn, listGoogleCustomers, MAX_CUSTOMERS } =
  await import('./google-accounts.js');

const ORG = '11111111-1111-1111-1111-111111111111';
const BRAND = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const SIGN_IN = '55555555-5555-5555-5555-555555555555';
const scope = { orgId: ORG, brandId: BRAND, userId: USER };
const target = { entityId: `org_${ORG}`, accountId: 'ca_1' };

/** A fake Supabase client: records each table's calls, answers with `answers[table]`. */
function fakeDb(answers = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const chain = {};
      for (const op of ['select', 'upsert', 'eq']) {
        chain[op] = (...args) => {
          call.ops.push([op, ...args]);
          return chain;
        };
      }
      chain.then = (resolve) => resolve(answers[table]?.(call) ?? { data: [], error: null });
      return chain;
    },
  };
}

const connection = (over = {}) => ({
  brandId: BRAND,
  provider: 'google-ads',
  accountId: SIGN_IN,
  organizationId: ORG,
  entityId: `org_${ORG}`,
  composioAccountId: 'ca_1',
  connected: true,
  ...over,
});

const customer = (id, over = {}) => ({
  id,
  name: `Account ${id}`,
  currencyCode: 'USD',
  timeZone: 'Europe/Istanbul',
  manager: false,
  testAccount: false,
  ...over,
});

const code = (promise) =>
  promise.then(
    () => 'resolved',
    (err) => (err instanceof AdsAccountError ? err.code : err),
  );

describe('googleSignIn', () => {
  const deps = (over = {}) => ({
    configured: () => true,
    connectionOf: async () => connection(),
    reach: vi.fn(async () => {}),
    active: async () => ({ id: 'ca_1' }),
    ...over,
  });

  it("answers the brand's live sign-in and what a call runs as", async () => {
    const d = deps();
    expect(await googleSignIn(scope, d)).toEqual({ accountId: SIGN_IN, target });
    expect(d.reach).toHaveBeenCalledWith(USER, connection());
  });

  it("refuses another workspace's sign-in, as if there were none", async () => {
    const d = deps({ connectionOf: async () => connection({ organizationId: 'other-org' }) });
    expect(await code(googleSignIn(scope, d))).toBe('not_connected');
    expect(d.reach).not.toHaveBeenCalled();
  });

  it('is not connected without a live sign-in, and not configured without the auth config', async () => {
    for (const over of [
      { connectionOf: async () => null },
      { connectionOf: async () => connection({ connected: false }) },
      { connectionOf: async () => connection({ accountId: null }) },
      { active: async () => null },
    ]) {
      expect(await code(googleSignIn(scope, deps(over)))).toBe('not_connected');
    }
    expect(await code(googleSignIn(scope, deps({ configured: () => false })))).toBe(
      'not_configured',
    );
  });
});

describe('listGoogleCustomers', () => {
  const signIn = async () => ({ accountId: SIGN_IN, target });

  it('describes each customer reached, marking the ones the brand reads already', async () => {
    const db = fakeDb({ ads_accounts: () => ({ data: [{ external_id: '1111111111' }] }) });
    const info = vi.fn(async (_t, id) =>
      id === '3333333333' ? Promise.reject(new Error('closed')) : customer(id),
    );
    const out = await listGoogleCustomers(scope, {
      db,
      signIn,
      accessible: async () => ['1111111111', '2222222222', '3333333333'],
      info,
    });
    expect(out.more).toBe(0);
    expect(out.customers.map((c) => [c.id, c.connected, c.unavailable])).toEqual([
      ['1111111111', true, false],
      ['2222222222', false, false],
      ['3333333333', false, true],
    ]);
    expect(db.calls[0].ops).toEqual([
      ['select', 'external_id'],
      ['eq', 'organization_id', ORG],
      ['eq', 'brand_id', BRAND],
      ['eq', 'platform', 'google'],
    ]);
  });

  it(`describes the first ${MAX_CUSTOMERS} and counts the rest`, async () => {
    const ids = Array.from({ length: MAX_CUSTOMERS + 3 }, (_, i) => String(1000000000 + i));
    const info = vi.fn(async (_t, id) => customer(id));
    const out = await listGoogleCustomers(scope, {
      db: fakeDb(),
      signIn,
      accessible: async () => ids,
      info,
    });
    expect([out.customers.length, out.more, info.mock.calls.length]).toEqual([
      MAX_CUSTOMERS,
      3,
      MAX_CUSTOMERS,
    ]);
  });

  it('says Google Ads did not answer when the list fails', async () => {
    const accessible = async () => Promise.reject(new Error('composio down'));
    expect(await code(listGoogleCustomers(scope, { db: fakeDb(), signIn, accessible }))).toBe(
      'upstream',
    );
  });
});

describe('connectGoogleAccounts', () => {
  const signIn = async () => ({ accountId: SIGN_IN, target });
  const accessible = async () => ['1111111111', '2222222222', '9999999999'];
  const row = (id) => ({ id: `row-${id}`, platform: 'google', external_id: id, status: 'active' });

  it("keeps the picked accounts on the brand with the sign-in's id, and logs each", async () => {
    const db = fakeDb({
      ads_accounts: (call) => ({ data: call.ops[0][1].map((r) => row(r.external_id)) }),
    });
    const log = vi.fn(async () => {});
    const out = await connectGoogleAccounts(
      { ...scope, customerIds: ['111-111-1111', '2222222222'] },
      { db, signIn, accessible, info: async (_t, id) => customer(id), log },
    );
    expect(out.map((a) => a.externalId)).toEqual(['1111111111', '2222222222']);
    const [op, rows, options] = db.calls[0].ops[0];
    expect([op, options]).toEqual(['upsert', { onConflict: 'brand_id,platform,external_id' }]);
    expect(rows[0]).toMatchObject({
      organization_id: ORG,
      brand_id: BRAND,
      platform: 'google',
      external_id: '1111111111',
      name: 'Account 1111111111',
      currency_code: 'USD',
      integration_account_id: SIGN_IN,
      status: 'active',
      connected_by: USER,
    });
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatchObject({
      event: 'connection.connect',
      target: { platform: 'google', external: '1111111111' },
    });
  });

  it("refuses an id the sign-in doesn't reach, before writing anything", async () => {
    const db = fakeDb();
    const info = vi.fn(async (_t, id) => customer(id));
    const out = code(
      connectGoogleAccounts(
        { ...scope, customerIds: ['1111111111', '4444444444'] },
        { db, signIn, accessible, info },
      ),
    );
    expect(await out).toBe('not_accessible');
    expect([db.calls.length, info.mock.calls.length]).toEqual([0, 0]);
  });

  it('refuses a manager account and one Google Ads will not describe', async () => {
    const deps = (info) => ({ db: fakeDb(), signIn, accessible, info });
    const manager = async (_t, id) => customer(id, { manager: id === '9999999999' });
    expect(
      await code(
        connectGoogleAccounts(
          { ...scope, customerIds: ['1111111111', '9999999999'] },
          deps(manager),
        ),
      ),
    ).toBe('manager_account');
    expect(
      await code(
        connectGoogleAccounts(
          { ...scope, customerIds: ['2222222222'] },
          deps(async () => null),
        ),
      ),
    ).toBe('not_accessible');
  });

  it('refuses no ids, a malformed one, or more than 20', async () => {
    const deps = { db: fakeDb(), signIn: vi.fn(signIn), accessible };
    for (const customerIds of [
      [],
      ['12345'],
      Array.from({ length: 21 }, (_, i) => String(1000000000 + i)),
    ]) {
      expect(await code(connectGoogleAccounts({ ...scope, customerIds }, deps))).toBe(
        'not_accessible',
      );
    }
    expect(deps.signIn).not.toHaveBeenCalled();
  });
});
