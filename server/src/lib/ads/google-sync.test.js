import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../composio.js', () => ({
  executeGoogleAdsTool: vi.fn(),
  getActiveConnection: vi.fn(),
  isComposioConfigured: vi.fn(() => true),
}));

const { googleSyncer, googleTarget } = await import('./google-sync.js');
const { AdsSyncError } = await import('./sync.js');

/**
 * Google Ads' part of the daily sync (G3): the account's own sign-in, only
 * when it is its workspace's, and each window's campaigns and search terms.
 */

/** A Supabase stand-in answering one integration_accounts read; it records the filters. */
function signInDb(row, error = null) {
  const ops = [];
  const chain = {
    select: (...a) => (ops.push(['select', ...a]), chain),
    eq: (...a) => (ops.push(['eq', ...a]), chain),
    maybeSingle: async () => ({ data: row, error }),
  };
  return { ops, from: (table) => (ops.push(['from', table]), chain) };
}

const ACCOUNT = () => ({
  id: 'acc',
  organization_id: 'org1',
  platform: 'google',
  external_id: '1234567890',
  integration_account_id: 'ia1',
});
const LIVE = {
  id: 'ia1',
  composio_entity_id: 'ent',
  composio_account_id: 'ca_1',
  status: 'connected',
};
const WINDOW = { since: '2026-11-15', until: '2026-11-21' };

describe('googleTarget', () => {
  it("reads the sign-in only on the account's workspace, as Google Ads'", async () => {
    const db = signInDb(LIVE);
    expect(await googleTarget(ACCOUNT(), { db })).toEqual({ entityId: 'ent', accountId: 'ca_1' });
    expect(db.ops).toContainEqual(['eq', 'id', 'ia1']);
    expect(db.ops).toContainEqual(['eq', 'organization_id', 'org1']);
    expect(db.ops).toContainEqual(['eq', 'provider', 'google-ads']);
  });

  it("marks an account whose sign-in was deleted 'disconnected', with no read", async () => {
    const db = signInDb(LIVE);
    const err = await googleTarget({ ...ACCOUNT(), integration_account_id: null }, { db }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(AdsSyncError);
    expect(err).toMatchObject({ code: 'signin_gone', status: 'disconnected' });
    expect(db.ops).toHaveLength(0);
  });

  it("treats another workspace's sign-in as gone", async () => {
    await expect(googleTarget(ACCOUNT(), { db: signInDb(null) })).rejects.toMatchObject({
      code: 'signin_gone',
      status: 'disconnected',
    });
  });

  it("keeps an expired sign-in 'error', to be read again once it is back", async () => {
    await expect(
      googleTarget(ACCOUNT(), { db: signInDb({ ...LIVE, status: 'expired' }) }),
    ).rejects.toMatchObject({ code: 'signin_gone', status: 'error' });
  });
});

describe('googleSyncer', () => {
  const campaign = {
    campaign_id: '111',
    day: '2026-11-20',
    campaign_name: 'Brand',
    campaign_status: 'ENABLED',
    impressions: 100,
    clicks: 7,
    cost_micros: 3_500_000,
    conversions: 1.5,
    conversion_value: 40,
  };
  const term = {
    campaign_id: '111',
    search_term: 'best crm',
    day: '2026-11-20',
    impressions: 10,
    clicks: 2,
    cost_micros: 900_000,
    conversions: 0,
  };

  it('writes campaign days and search terms per window, reading the sign-in once', async () => {
    const db = signInDb(LIVE);
    const readCampaigns = vi.fn(async () => [campaign]);
    const readSearchTerms = vi.fn(async () => [term]);
    const writeTerms = vi.fn(async () => 1);
    const writeDays = vi.fn(async () => {});
    const sync = googleSyncer({ readCampaigns, readSearchTerms, writeTerms });
    const account = ACCOUNT();
    await sync({ account, window: WINDOW, writeDays, db });
    await sync({ account, window: WINDOW, writeDays, db });

    expect(db.ops.filter(([op]) => op === 'from')).toHaveLength(1);
    expect(readCampaigns).toHaveBeenCalledWith(
      { entityId: 'ent', accountId: 'ca_1' },
      '1234567890',
      WINDOW,
    );
    expect(writeDays.mock.calls[0][0]).toEqual([
      {
        campaignId: '111',
        campaignName: 'Brand',
        campaignStatus: 'ENABLED',
        day: '2026-11-20',
        impressions: 100,
        clicks: 7,
        costMicros: 3_500_000,
        conversions: 1.5,
        conversionValue: 40,
      },
    ]);
    expect(writeTerms.mock.calls[0][0]).toBe('acc');
    expect(writeTerms.mock.calls[0][1][0]).toMatchObject({
      campaignId: '111',
      searchTerm: 'best crm',
      costMicros: 900_000,
    });
  });

  it("turns a Composio or Google failure into 'upstream', never its message", async () => {
    const sync = googleSyncer({
      readCampaigns: async () => {
        throw new Error('customer 1234567890 Acme Inc: PERMISSION_DENIED');
      },
      readSearchTerms: vi.fn(),
      writeTerms: vi.fn(),
    });
    const err = await sync({
      account: ACCOUNT(),
      window: WINDOW,
      writeDays: vi.fn(),
      db: signInDb(LIVE),
    }).catch((e) => e);
    expect(err).toMatchObject({ name: 'AdsSyncError', code: 'upstream', status: 'error' });
    expect(err.message).not.toContain('Acme');
  });
});
