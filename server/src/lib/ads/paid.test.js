import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { readPaid, sumSpend, TOP_TERMS } = await import('./paid.js');

/** A query that records its filters and resolves to `result`. */
function query(result, calls) {
  const q = {
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  for (const name of ['select', 'eq', 'in', 'not', 'order', 'range']) {
    q[name] = (...args) => {
      calls.push([name, ...args]);
      return q;
    };
  }
  return q;
}

function fakeDb({ accounts = [], totals = [], accountsError = null, totalsError = null } = {}) {
  const calls = { accounts: [], rpc: [] };
  return {
    calls,
    from: (table) => {
      calls.accounts.push(['from', table]);
      return query({ data: accounts, error: accountsError }, calls.accounts);
    },
    rpc: (name, params) => {
      calls.rpc.push(['rpc', name, params]);
      return query({ data: totals, error: totalsError }, calls.rpc);
    },
  };
}

const PROMPTS = [
  { promptId: 'p-crm', text: 'Best CRM for a small business?', keywords: ['crm software'] },
  { promptId: 'p-mail', text: 'Email marketing tools for startups', keywords: [] },
];
const INPUT = {
  orgId: 'org-1',
  brandId: 'b-1',
  from: '2026-10-24',
  to: '2026-11-22',
  prompts: PROMPTS,
};
const term = (account_id, search_term, cost_micros, clicks = 1) => ({
  account_id,
  search_term,
  cost_micros,
  clicks,
  impressions: clicks * 10,
  conversions: 0.5,
});

describe('readPaid', () => {
  it('is not measured until one of the brand’s Google accounts has been read', async () => {
    const db = fakeDb();
    const paid = await readPaid(INPUT, { db });
    expect(paid).toEqual({ measured: false, byPrompt: new Map(), unmatched: [] });
    expect(db.calls.rpc).toEqual([]);
  });

  it('reads only the brand’s read Google accounts within the organization', async () => {
    const db = fakeDb({ accounts: [{ id: 'a-1', currency_code: 'USD' }] });
    await readPaid(INPUT, { db });
    expect(db.calls.accounts).toEqual(
      expect.arrayContaining([
        ['from', 'ads_accounts'],
        ['eq', 'organization_id', 'org-1'],
        ['eq', 'brand_id', 'b-1'],
        ['eq', 'platform', 'google'],
        ['in', 'status', ['active', 'error']],
        ['not', 'synced_through', 'is', null],
      ]),
    );
    expect(db.calls.rpc[0]).toEqual([
      'rpc',
      'ads_search_term_totals',
      { p_account_ids: ['a-1'], p_from: '2026-10-24', p_to: '2026-11-22' },
    ]);
    expect(db.calls.rpc).toContainEqual(['range', 0, 999]);
  });

  it('sums each prompt’s matched terms per currency and keeps the rest unmatched', async () => {
    const db = fakeDb({
      accounts: [
        { id: 'a-usd', currency_code: 'USD' },
        { id: 'a-eur', currency_code: 'EUR' },
      ],
      totals: [
        term('a-usd', 'crm software', 12_345_678, 4),
        term('a-usd', 'small business crm', 2_000_000, 2),
        term('a-eur', 'crm software', 3_000_000, 1),
        term('a-usd', 'email marketing tools', 990_000, 3),
        term('a-usd', 'free games', 5_000_000, 9),
      ],
    });
    const paid = await readPaid(INPUT, { db });
    expect(paid.measured).toBe(true);
    expect(paid.byPrompt.get('p-crm')).toEqual({
      channel: 'google',
      spend: [
        { currencyCode: 'USD', amount: 14.35 },
        { currencyCode: 'EUR', amount: 3 },
      ],
      clicks: 7,
      impressions: 70,
      conversions: 1.5,
      termCount: 2,
      terms: [
        { term: 'crm software', currencyCode: 'USD', amount: 12.35, clicks: 4 },
        { term: 'crm software', currencyCode: 'EUR', amount: 3, clicks: 1 },
        { term: 'small business crm', currencyCode: 'USD', amount: 2, clicks: 2 },
      ],
    });
    expect(paid.byPrompt.get('p-mail').spend).toEqual([{ currencyCode: 'USD', amount: 0.99 }]);
    expect(paid.unmatched).toEqual([{ currencyCode: 'USD', amount: 5 }]);
  });

  it(`shows a prompt's ${TOP_TERMS} costliest terms`, async () => {
    const totals = Array.from({ length: 8 }, (_, i) =>
      term('a-1', `crm software ${i}`, (i + 1) * 1_000_000),
    );
    const db = fakeDb({ accounts: [{ id: 'a-1', currency_code: 'GBP' }], totals });
    const p = (await readPaid(INPUT, { db })).byPrompt.get('p-crm');
    expect(p.termCount).toBe(8);
    expect(p.terms.map((t) => t.amount)).toEqual([8, 7, 6, 5, 4]);
  });

  it('throws a read error without its message', async () => {
    const accountsError = { code: '42501', message: 'secret detail' };
    await expect(readPaid(INPUT, { db: fakeDb({ accountsError }) })).rejects.toThrow(
      'ads_accounts read: 42501',
    );
    const db = fakeDb({
      accounts: [{ id: 'a-1', currency_code: 'USD' }],
      totalsError: { code: 'PGRST202', message: 'no function' },
    });
    await expect(readPaid(INPUT, { db })).rejects.toThrow('ads_search_term_totals: PGRST202');
  });
});

describe('sumSpend', () => {
  it('adds amounts per currency, never across currencies', () => {
    expect(
      sumSpend([
        [{ currencyCode: 'USD', amount: 1.1 }],
        null,
        [
          { currencyCode: 'USD', amount: 2.2 },
          { currencyCode: 'TRY', amount: 40 },
        ],
      ]),
    ).toEqual([
      { currencyCode: 'TRY', amount: 40 },
      { currencyCode: 'USD', amount: 3.3 },
    ]);
  });
});
