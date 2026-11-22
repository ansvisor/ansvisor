import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { campaignStatus, campaignTotals, periodRange, readCampaigns } =
  await import('./campaigns.js');

/**
 * Ads › Campaigns on real data (P1): each campaign's totals over the period,
 * from the daily sync's days, only of the brand's accounts in the workspace.
 */

/** A Supabase stand-in: answers per table, records each call's filters. */
function fakeDb(answers) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const chain = new Proxy(
        {},
        {
          get(_, op) {
            if (op === 'then') {
              const answer = answers[table];
              return (resolve) => resolve(typeof answer === 'function' ? answer(call) : answer);
            }
            return (...args) => {
              call.ops.push([op, ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
}

const NOW = new Date('2026-11-22T10:00:00Z');
const GOOGLE = { id: 'g', platform: 'google', currency_code: 'USD', status: 'active' };
const CHATGPT = { id: 'c', platform: 'chatgpt', currency_code: 'EUR', status: 'active' };

describe('campaignStatus', () => {
  it("reads Google's and ChatGPT's statuses as one set", () => {
    expect(campaignStatus('ENABLED')).toBe('active');
    expect(campaignStatus('active')).toBe('active');
    expect(campaignStatus('PAUSED')).toBe('paused');
    expect(campaignStatus('REMOVED')).toBe('ended');
    expect(campaignStatus('archived')).toBe('ended');
    expect(campaignStatus('UNKNOWN')).toBeNull();
  });
});

describe('periodRange', () => {
  it('covers the period, today included', () => {
    expect(periodRange('7d', NOW)).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(periodRange('nope', NOW).from).toBe('2026-10-24');
  });
});

describe('campaignTotals', () => {
  it("adds a campaign's days, takes its latest name and status, and puts the most spent first", () => {
    const accounts = new Map([
      ['g', GOOGLE],
      ['c', CHATGPT],
    ]);
    const rows = campaignTotals(
      [
        {
          account_id: 'g',
          campaign_id: '1',
          day: '2026-11-20',
          campaign_name: 'Old',
          campaign_status: 'ENABLED',
          clicks: 4,
          cost_micros: 2_000_000,
          conversions: 1,
        },
        {
          account_id: 'g',
          campaign_id: '1',
          day: '2026-11-21',
          campaign_name: 'Brand',
          campaign_status: 'PAUSED',
          clicks: 6,
          cost_micros: 3_000_000,
          conversions: 1.5,
          conversion_value: 30,
        },
        {
          account_id: 'c',
          campaign_id: 'cmpn_1',
          day: '2026-11-21',
          campaign_name: 'Spring',
          campaign_status: 'active',
          clicks: 0,
          cost_micros: 9_000_000,
        },
        { account_id: 'x', campaign_id: '9', day: '2026-11-21', cost_micros: 99_000_000 },
      ],
      accounts,
    );
    expect(rows.map((r) => r.campaignId)).toEqual(['cmpn_1', '1']);
    expect(rows[1]).toMatchObject({
      platform: 'google',
      currencyCode: 'USD',
      name: 'Brand',
      status: 'paused',
      clicks: 10,
      spend: 5,
      cpc: 0.5,
      conversions: 2.5,
      costPerConversion: 2,
      conversionValue: 30,
    });
    expect(rows[0]).toMatchObject({
      currencyCode: 'EUR',
      spend: 9,
      cpc: null,
      costPerConversion: null,
    });
  });
});

describe('readCampaigns', () => {
  it("reads only the brand's accounts in the workspace, and their days in the period", async () => {
    const db = fakeDb({
      ads_accounts: { data: [GOOGLE], error: null },
      ads_campaign_daily: {
        data: [{ account_id: 'g', campaign_id: '1', day: '2026-11-21', cost_micros: 1_000_000 }],
        error: null,
      },
    });
    const read = await readCampaigns(
      { orgId: 'o1', brandId: 'b1', period: '7d' },
      { db, now: NOW },
    );
    expect(db.calls[0].ops).toContainEqual(['eq', 'organization_id', 'o1']);
    expect(db.calls[0].ops).toContainEqual(['eq', 'brand_id', 'b1']);
    expect(db.calls[1].ops).toContainEqual(['in', 'account_id', ['g']]);
    expect(db.calls[1].ops).toContainEqual(['gte', 'day', '2026-11-16']);
    expect(db.calls[1].ops).toContainEqual(['lte', 'day', '2026-11-22']);
    expect(read.accounts[0]).toMatchObject({ id: 'g', platform: 'google' });
    expect(read.campaigns).toHaveLength(1);
  });

  it('reads past 1,000 days in pages', async () => {
    const page = (n) =>
      Array.from({ length: n }, (_, i) => ({
        account_id: 'g',
        campaign_id: String(i),
        day: '2026-11-21',
        cost_micros: 1,
      }));
    let pages = 0;
    const db = fakeDb({
      ads_accounts: { data: [GOOGLE], error: null },
      ads_campaign_daily: () => ({ data: page(pages++ === 0 ? 1000 : 5), error: null }),
    });
    const read = await readCampaigns(
      { orgId: 'o1', brandId: 'b1', period: '90d' },
      { db, now: NOW },
    );
    expect(pages).toBe(2);
    expect(read.campaigns).toHaveLength(1000);
  });

  it('answers empty lists, with no day read, for a brand with no account', async () => {
    const db = fakeDb({ ads_accounts: { data: [], error: null } });
    expect(
      await readCampaigns({ orgId: 'o1', brandId: 'b1', period: '30d' }, { db, now: NOW }),
    ).toMatchObject({ accounts: [], campaigns: [] });
    expect(db.calls).toHaveLength(1);
  });
});
