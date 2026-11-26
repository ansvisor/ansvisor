import { describe, expect, it } from 'vitest';
import { spendAmount, spendText } from './spend';

describe('spendText', () => {
  it('shows each currency to the cent, never added across currencies', () => {
    expect(
      spendText(
        [
          { currencyCode: 'USD', amount: 14.35 },
          { currencyCode: 'EUR', amount: 3 },
        ],
        'en-US',
      ),
    ).toBe('$14.35 + €3.00');
  });

  it('reads an amount without a known currency as the number alone', () => {
    expect(spendAmount({ currencyCode: null, amount: 1234.5 }, 'en-US')).toBe('1,234.5');
    expect(spendAmount({ currencyCode: 'XX1', amount: 2 }, 'en-US')).toBe('2');
    expect(spendText([], 'en-US')).toBe('0');
  });
});
