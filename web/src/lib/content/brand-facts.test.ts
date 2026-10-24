import { describe, expect, it } from 'vitest';
import {
  brandFactsPath,
  factMismatches,
  factValueText,
  pagePrices,
  type BrandFact,
} from './brand-facts';

/** A brand fact's value as a person reads it (Quality CE-047). */
describe('factValueText', () => {
  it('writes a price in its currency, a trial’s days, a year, and a claim’s words', () => {
    const price = (amount: number, currency: string) => ({
      plan: 'Pro',
      amount,
      currency,
      period: 'month' as const,
      billed: null,
      per: null,
    });
    expect(factValueText('price', price(49, 'USD'))).toBe('$49');
    expect(factValueText('price', price(49.99, 'EUR'))).toBe('€49.99');
    expect(factValueText('price', price(499, 'TRY'))).toMatch(/^TRY\s499$/);
    expect(factValueText('trial', { days: 14 })).toBe('14');
    expect(factValueText('founded', { year: 2015 })).toBe('2015');
    expect(factValueText('claim', {}, 'SOC 2 certified')).toBe('SOC 2 certified');
    expect(brandFactsPath('b1')).toBe('/dashboard/brands/b1/settings?tab=facts');
  });
});

const approved = (over: Partial<BrandFact>): BrandFact => ({
  id: 'f',
  kind: 'price',
  value: {
    plan: 'Pro',
    amount: 49,
    currency: 'USD',
    period: 'month',
    billed: 'monthly',
    per: null,
  },
  quote: '$49 per month',
  sourceUrl: 'https://ledgerly.example/pricing',
  sourceKind: 'pricing',
  status: 'approved',
  reviewedAt: null,
  firstSeenAt: '2026-10-24T00:00:00Z',
  gone: false,
  replaces: null,
  ...over,
});
const FACTS = [
  approved({ id: 'pro-m' }),
  approved({
    id: 'pro-y',
    value: {
      plan: 'Pro',
      amount: 39,
      currency: 'USD',
      period: 'month',
      billed: 'annually',
      per: null,
    },
  }),
  approved({
    id: 'starter',
    value: {
      plan: 'Starter',
      amount: 19,
      currency: 'USD',
      period: 'month',
      billed: null,
      per: null,
    },
  }),
  approved({ id: 'trial', kind: 'trial', value: { days: 14 }, quote: '14-day free trial' }),
  approved({
    id: 'year',
    kind: 'founded',
    value: { year: 2015 },
    quote: 'Founded in 2015',
    sourceKind: 'about',
  }),
  // Not approved, or gone from the site: never compared.
  approved({
    id: 'p',
    status: 'pending',
    value: { plan: 'Team', amount: 99, currency: 'USD', period: 'month', billed: null, per: null },
  }),
  approved({
    id: 'g',
    gone: true,
    value: { plan: 'Pro', amount: 59, currency: 'USD', period: 'month', billed: null, per: null },
  }),
];
const check = (sentences: string[], facts = FACTS) =>
  factMismatches({
    sentences,
    facts,
    brandName: 'Ledgerly',
    competitorDomains: ['northwind.example'],
  });

describe('pagePrices', () => {
  it('reads a price with its currency and period, and no scale, discount or range', () => {
    expect(pagePrices('Pro costs $49 per month, or €45/mo in Europe.')).toEqual([
      { text: '$49', amount: 49, currency: 'USD', period: 'month', from: false },
      { text: '€45', amount: 45, currency: 'EUR', period: 'month', from: false },
    ]);
    expect(pagePrices('Plans start at $19 a month.')[0]).toMatchObject({ amount: 19, from: true });
    expect(pagePrices('Teams raised $2M, save $10 or get $5 off, paying $10–$20.')).toEqual([]);
    expect(pagePrices('1 299 € par an')[0]).toMatchObject({ amount: 1299, period: 'year' });
  });
});

describe('factMismatches', () => {
  it('compares a plan’s price with any of its approved ones, in its currency and period', () => {
    expect(check(['Ledgerly Pro is $49 per month.', 'Pro is $39/mo billed annually.'])).toEqual({
      compared: 2,
      mismatches: [],
    });
    expect(check(['Ledgerly Pro costs $59 per month.'])).toEqual({
      compared: 1,
      mismatches: [
        {
          kind: 'price',
          page: '$59',
          fact: '$49',
          source: 'pricing',
          sentence: 'Ledgerly Pro costs $59 per month.',
        },
      ],
    });
  });

  it('cries no wolf: another currency or period, no plan nor brand, a competitor, nothing approved', () => {
    expect(
      check([
        'Pro is €45 per month in Europe.',
        'Pro is $468 per year.',
        'Tools like this cost $30 per month.',
        'Northwind Pro costs $29 per month.',
        'The Team plan is $129 per month.',
      ]),
    ).toEqual({ compared: 0, mismatches: [] });
    expect(check(['Ledgerly Pro costs $59 per month.'], [])).toEqual({
      compared: 0,
      mismatches: [],
    });
  });

  it('reads "from" against the lowest price, and the brand’s own price with no plan named', () => {
    expect(check(['Ledgerly starts at $19 per month.']).mismatches).toEqual([]);
    expect(check(['Ledgerly starts at $29 per month.']).mismatches[0]).toMatchObject({
      page: '$29',
      fact: '$19',
    });
    expect(check(['We charge $25 per month.']).mismatches[0]).toMatchObject({ page: '$25' });
  });

  it('compares a trial’s days and the brand’s founding year', () => {
    expect(
      check(['Every plan has a 30-day free trial.', 'Ledgerly was founded in 2012.']).mismatches,
    ).toEqual([
      {
        kind: 'trial',
        page: '30-day',
        fact: '14-day',
        source: 'pricing',
        sentence: 'Every plan has a 30-day free trial.',
      },
      {
        kind: 'founded',
        page: '2012',
        fact: '2015',
        source: 'about',
        sentence: 'Ledgerly was founded in 2012.',
      },
    ]);
    expect(
      check(['Try it free for 2 weeks: a 14-day trial.', 'Founded in 2015, we…']).mismatches,
    ).toEqual([]);
    // Another company's founding year isn't the brand's.
    expect(check(['Stripe was founded in 2010.']).compared).toBe(0);
  });
});
