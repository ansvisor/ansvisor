import { describe, expect, it } from 'vitest';
import { slotDiscount } from './slot-discount';

describe('slotDiscount', () => {
  it('gives nothing up to $500 a month', () => {
    expect(slotDiscount(0, 'month')).toMatchObject({ percentOff: 0, discountCents: 0 });
    expect(slotDiscount(50_000, 'month')).toMatchObject({ percentOff: 0, discountCents: 0 });
  });

  it('takes each step’s rate off only the part above it', () => {
    // $1,500: 5% of $500 + 10% of $500 = $75, 5%.
    expect(slotDiscount(150_000, 'month')).toMatchObject({ percentOff: 5, discountCents: 7_500 });
    // $5,000: $25 + $100 + $300 + $200 = $625, 12.5%.
    expect(slotDiscount(500_000, 'month')).toMatchObject({
      percentOff: 12.5,
      discountCents: 62_500,
    });
  });

  it('rounds the rate down to two decimals', () => {
    // $750: $12.50 is 1.666…%.
    expect(slotDiscount(75_000, 'month')).toMatchObject({ percentOff: 1.66, discountCents: 1_245 });
    // $4,000: $425 is 10.625%.
    expect(slotDiscount(400_000, 'month').percentOff).toBe(10.62);
  });

  it('never costs less for more', () => {
    let paid = 0;
    for (let cents = 0; cents <= 1_000_000; cents += 1_500) {
      const { listCents, discountCents } = slotDiscount(cents, 'month');
      expect(listCents - discountCents).toBeGreaterThanOrEqual(paid);
      paid = listCents - discountCents;
    }
  });

  it('reads a yearly price’s steps on a month', () => {
    expect(slotDiscount(1_500_000, 'year')).toMatchObject({
      percentOff: 5,
      discountCents: 75_000,
    });
    expect(slotDiscount(500_000, 'year').percentOff).toBe(0);
  });

  it('names the step reached and what is left to the next one', () => {
    expect(slotDiscount(75_000, 'month')).toMatchObject({
      step: { fromCents: 50_000, percent: 5 },
      next: { step: { fromCents: 100_000, percent: 10 }, remainingCents: 25_000 },
    });
    expect(slotDiscount(750_000, 'year').next).toEqual({
      step: { fromCents: 100_000, percent: 10 },
      remainingCents: 250_000,
    });
    expect(slotDiscount(400_000, 'month')).toMatchObject({
      step: { percent: 20 },
      next: null,
    });
  });
});
