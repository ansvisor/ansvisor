import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's own Google sign-in (BRAND-ACCESS PR 15): the brand uses another
 * brand's connected account or the Account's, connects one of its own (kept
 * pending until Composio says it's active), or disconnects. A brand's own
 * login that no brand uses any more goes, on Composio too; the Account's
 * stays.
 */

const ORG = 'org-1';
const BRAND = { id: 'b1', organization_id: ORG };
const WORKSPACE = 'acct-workspace';
const OWN = 'acct-own';

const db = vi.hoisted(() => ({ tables: {}, writes: [] }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, op: 'select', filters: [], payload: null, head: false };
      const rows = () =>
        (db.tables[table] ?? []).filter((row) =>
          call.filters.every(([op, col, val]) =>
            op === 'in' ? val.includes(row[col]) : row[col] === val,
          ),
        );
      const answer = () => {
        if (call.op !== 'select') {
          db.writes.push(call);
          if (call.op === 'delete') {
            db.tables[table] = (db.tables[table] ?? []).filter((r) => !rows().includes(r));
          }
          if (call.op === 'upsert') {
            const t = (db.tables[table] ??= []);
            const i = t.findIndex(
              (r) => r.brand_id === call.payload.brand_id && r.provider === call.payload.provider,
            );
            if (i >= 0) t[i] = { ...t[i], ...call.payload };
            else t.push(call.payload);
          }
          if (call.op === 'update') for (const r of rows()) Object.assign(r, call.payload);
          if (call.op === 'insert') {
            const row = { id: 'acct-new', ...call.payload };
            (db.tables[table] ??= []).push(row);
            return { data: row, error: null };
          }
          return { data: null, error: null };
        }
        const found = rows();
        return call.head ? { count: found.length, error: null } : { data: found, error: null };
      };
      const chain = {
        select: (_cols, opts) => ((call.head = Boolean(opts?.head)), chain),
        insert: (p) => ((call.op = 'insert'), (call.payload = p), chain),
        update: (p) => ((call.op = 'update'), (call.payload = p), chain),
        upsert: (p) => ((call.op = 'upsert'), (call.payload = p), chain),
        delete: () => ((call.op = 'delete'), chain),
        eq: (col, val) => (call.filters.push(['eq', col, val]), chain),
        in: (col, val) => (call.filters.push(['in', col, val]), chain),
        single: async () => answer(),
        maybeSingle: async () => {
          const a = answer();
          return { ...a, data: Array.isArray(a.data) ? (a.data[0] ?? null) : a.data };
        },
        then: (resolve, reject) => Promise.resolve(answer()).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { activateBrandAccount, removeBrandAccount, startBrandAccount, useAccountForBrand } =
  await import('./brand-integrations.js');

const deleteRemote = vi.fn();
const account = (id, over = {}) => ({
  id,
  organization_id: ORG,
  provider: 'google-analytics',
  composio_entity_id: `org_${ORG}`,
  composio_account_id: `ca_${id}`,
  label: null,
  status: 'connected',
  integration_connection_id: null,
  cms_connection_id: null,
  connected_by: 'u1',
  created_at: '2026-11-01',
  ...over,
});

beforeEach(() => {
  deleteRemote.mockReset();
  db.writes = [];
  db.tables = {
    integration_accounts: [account(WORKSPACE, { integration_connection_id: 'ic-1' }), account(OWN)],
    brand_integrations: [
      { brand_id: 'b1', provider: 'google-analytics', account_id: OWN },
      { brand_id: 'b2', provider: 'google-analytics', account_id: WORKSPACE },
    ],
    brands: [
      { id: 'b1', gsc_property: 'sc-domain:b1.test', ga_property_id: '111' },
      { id: 'b2', gsc_property: 'sc-domain:b2.test', ga_property_id: '222' },
    ],
  };
});

const brandRow = (id) => db.tables.brands.find((b) => b.id === id);

// brandConnection's embed: the brand's row with its account.
function withEmbeds() {
  for (const use of db.tables.brand_integrations) {
    use.account = db.tables.integration_accounts.find((a) => a.id === use.account_id) ?? null;
  }
}

describe('useAccountForBrand', () => {
  it('uses the workspace’s account, and drops the brand’s own login nobody uses', async () => {
    withEmbeds();
    await useAccountForBrand(
      { brand: BRAND, provider: 'google-analytics', accountId: WORKSPACE, brandIds: ['b1', 'b2'] },
      { deleteRemote },
    );
    expect(db.tables.brand_integrations.find((u) => u.brand_id === 'b1').account_id).toBe(
      WORKSPACE,
    );
    expect(deleteRemote).toHaveBeenCalledWith(`ca_${OWN}`);
    expect(db.tables.integration_accounts.map((a) => a.id)).toEqual([WORKSPACE]);
    // The property was picked from the old account: cleared, the other product's kept.
    expect(brandRow('b1')).toMatchObject({
      ga_property_id: null,
      gsc_property: 'sc-domain:b1.test',
    });
  });

  it('keeps the property when the brand already uses that account', async () => {
    withEmbeds();
    await useAccountForBrand(
      { brand: BRAND, provider: 'google-analytics', accountId: OWN, brandIds: ['b1', 'b2'] },
      { deleteRemote },
    );
    expect(brandRow('b1').ga_property_id).toBe('111');
  });

  it('refuses a sign-in no brand the person reaches uses', async () => {
    db.tables.integration_accounts.push(account('acct-hidden'));
    db.tables.brand_integrations.push({
      brand_id: 'b9',
      provider: 'google-analytics',
      account_id: 'acct-hidden',
    });
    withEmbeds();
    await expect(
      useAccountForBrand(
        {
          brand: BRAND,
          provider: 'google-analytics',
          accountId: 'acct-hidden',
          brandIds: ['b1', 'b2'],
        },
        { deleteRemote },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.writes).toEqual([]);
  });
});

describe('a login of the brand’s own', () => {
  it('is pending until Composio says it’s active, then the brand uses it', async () => {
    const started = await startBrandAccount(
      { brand: BRAND, provider: 'google-analytics', userId: 'u1', entityId: `org_${ORG}` },
      { initiate: async () => ({ redirectUrl: 'https://g.test', connectedAccountId: 'ca_new' }) },
    );
    expect(started).toEqual({ redirectUrl: 'https://g.test', accountId: 'acct-new' });
    expect(db.tables.integration_accounts.at(-1)).toMatchObject({
      status: 'pending',
      composio_account_id: 'ca_new',
      connected_by: 'u1',
    });

    withEmbeds();
    const status = vi.fn(async () => 'INITIATED');
    expect(
      await activateBrandAccount(
        { brand: BRAND, provider: 'google-analytics', accountId: 'acct-new', userId: 'u1' },
        { status, deleteRemote },
      ),
    ).toBe('pending');
    // The brand keeps its sign-in meanwhile.
    expect(db.tables.brand_integrations.find((u) => u.brand_id === 'b1').account_id).toBe(OWN);

    status.mockResolvedValue('ACTIVE');
    expect(
      await activateBrandAccount(
        { brand: BRAND, provider: 'google-analytics', accountId: 'acct-new', userId: 'u1' },
        { status, deleteRemote },
      ),
    ).toBe('connected');
    expect(db.tables.brand_integrations.find((u) => u.brand_id === 'b1').account_id).toBe(
      'acct-new',
    );
    expect(db.tables.integration_accounts.find((a) => a.id === 'acct-new').status).toBe(
      'connected',
    );
    expect(deleteRemote).toHaveBeenCalledWith(`ca_${OWN}`);
    expect(brandRow('b1').ga_property_id).toBeNull();
  });

  it('drops the person’s unfinished logins, and anyone’s older than a day, when one starts', async () => {
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    db.tables.integration_accounts.push(
      account('acct-mine', { status: 'pending', connected_by: 'u1', created_at: recent }),
      account('acct-old', { status: 'pending', connected_by: 'u2', created_at: old }),
      account('acct-theirs', { status: 'pending', connected_by: 'u2', created_at: recent }),
    );
    await startBrandAccount(
      { brand: BRAND, provider: 'google-analytics', userId: 'u1', entityId: `org_${ORG}` },
      {
        initiate: async () => ({ redirectUrl: 'https://g.test', connectedAccountId: 'ca_new' }),
        deleteRemote,
      },
    );
    const ids = db.tables.integration_accounts.map((a) => a.id);
    expect(ids).not.toContain('acct-mine');
    expect(ids).not.toContain('acct-old');
    expect(ids).toEqual(expect.arrayContaining([WORKSPACE, OWN, 'acct-theirs', 'acct-new']));
    expect(deleteRemote).toHaveBeenCalledWith('ca_acct-mine');
    expect(deleteRemote).toHaveBeenCalledWith('ca_acct-old');
    expect(deleteRemote).not.toHaveBeenCalledWith('ca_acct-theirs');
  });

  it('is activated only by the person who started it', async () => {
    db.tables.integration_accounts.push(
      account('acct-p', { status: 'pending', connected_by: 'u2' }),
    );
    await expect(
      activateBrandAccount(
        { brand: BRAND, provider: 'google-analytics', accountId: 'acct-p', userId: 'u1' },
        { status: async () => 'ACTIVE', deleteRemote },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('removeBrandAccount', () => {
  it('leaves the Account’s sign-in for the other brands', async () => {
    withEmbeds();
    await removeBrandAccount(
      { brand: { id: 'b2', organization_id: ORG }, provider: 'google-analytics' },
      { deleteRemote },
    );
    expect(db.tables.brand_integrations.some((u) => u.brand_id === 'b2')).toBe(false);
    expect(db.tables.integration_accounts.some((a) => a.id === WORKSPACE)).toBe(true);
    expect(deleteRemote).not.toHaveBeenCalled();
    // Reading through no account, its property no longer applies.
    expect(brandRow('b2')).toMatchObject({
      ga_property_id: null,
      gsc_property: 'sc-domain:b2.test',
    });
  });
});
