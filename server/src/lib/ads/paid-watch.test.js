import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Paid watch (Ads Phase 1 P4): Google spend rising on prompts AI already
 * picks the brand for, read by the brand's own Google account's
 * organization, with nothing raised while Google isn't read.
 */

const readStanding = vi.fn();
vi.mock('./standing.js', () => ({ readStanding: (...a) => readStanding(...a) }));
vi.mock('./opportunities.js', () => ({
  readAdsSettings: async () => ({ thresholds: { leadPosition: 2 } }),
}));
vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { MIN_CLICKS, readPaidWatch, spendRising } = await import('./paid-watch.js');

const usd = (amount) => ({ currencyCode: 'USD', amount });
const paid = (amount, clicks = 20, currency = 'USD') => ({
  spend: [{ currencyCode: currency, amount }],
  clicks,
  terms: ['a', 'b', 'c', 'd'].map((term) => ({ term })),
});

function fakeDb(accounts = [{ organization_id: 'org-1' }], calls = []) {
  const q = { then: (resolve) => resolve({ data: accounts, error: null }) };
  for (const name of ['select', 'eq', 'in', 'not', 'limit']) {
    q[name] = (...args) => (calls.push([name, ...args]), q);
  }
  return { calls, from: (table) => (calls.push(['from', table]), q) };
}

const row = (promptId, standing, paidNow, paidBefore = null) => ({
  promptId,
  text: `Prompt ${promptId}`,
  standing: { leader: 'c1', ourPosition: null, ...standing },
  paid: paidNow,
  paidBefore,
});

beforeEach(() => readStanding.mockReset());

describe('spendRising', () => {
  it('needs enough clicks and spend up by a fifth, or new, in the same currency', () => {
    expect(spendRising(paid(12), paid(10))).toBe(true);
    expect(spendRising(paid(11.9), paid(10))).toBe(false);
    expect(spendRising(paid(5), null)).toBe(true);
    expect(spendRising(paid(50, MIN_CLICKS - 1), null)).toBe(false);
    expect(spendRising(null, paid(10))).toBe(false);
    // Before was in another currency only: nothing to compare with, so it's new here.
    expect(spendRising(paid(5), paid(100, 20, 'EUR'))).toBe(true);
  });
});

describe('readPaidWatch', () => {
  it('raises nothing without a read Google account of the brand', async () => {
    const db = fakeDb([]);
    expect(await readPaidWatch('b1', { db })).toEqual([]);
    expect(readStanding).not.toHaveBeenCalled();
    expect(db.calls).toEqual(
      expect.arrayContaining([
        ['from', 'ads_accounts'],
        ['eq', 'brand_id', 'b1'],
        ['eq', 'platform', 'google'],
        ['not', 'synced_through', 'is', null],
      ]),
    );
  });

  it('keeps prompts AI picks the brand for whose Google spend rose, the costliest first', async () => {
    const now = new Date('2026-11-23T03:00:00Z');
    readStanding.mockResolvedValue({
      paid: { measured: true },
      rows: [
        row('lead', { leader: 'us' }, paid(30), paid(10)),
        row('named-2nd', { ourPosition: 2 }, paid(80), null),
        row('named-3rd', { ourPosition: 3 }, paid(90), null),
        row('rival', { leader: 'c1' }, paid(99), null),
        row('flat', { leader: 'us' }, paid(10), paid(10)),
        row('unpaid', { leader: 'us' }, null, null),
      ],
    });
    const rows = await readPaidWatch('b1', { db: fakeDb(), now });
    expect(readStanding).toHaveBeenCalledWith({
      brandId: 'b1',
      orgId: 'org-1',
      period: '30d',
      thresholds: { leadPosition: 2 },
      now,
      paidBefore: true,
    });
    expect(rows.map((r) => r.promptId)).toEqual(['named-2nd', 'lead']);
    expect(rows[1]).toEqual({
      promptId: 'lead',
      text: 'Prompt lead',
      spend: [usd(30)],
      previousSpend: [usd(10)],
      clicks: 20,
      terms: ['a', 'b', 'c'],
    });
  });

  it('raises nothing while Google spend reads as not measured', async () => {
    readStanding.mockResolvedValue({
      paid: { measured: false },
      rows: [row('lead', { leader: 'us' }, null)],
    });
    expect(await readPaidWatch('b1', { db: fakeDb() })).toEqual([]);
  });
});
