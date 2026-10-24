import { describe, expect, it } from 'vitest';
import { brandFactsPath, factValueText } from './brand-facts';

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
