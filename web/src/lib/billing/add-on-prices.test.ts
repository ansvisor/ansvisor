// @vitest-environment node
import type Stripe from 'stripe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * A Growth add-on's Stripe price is found by its lookup key, checked against
 * its catalog row and kept on it (00546). Stripe is mocked.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { priceMismatch, resolveAddOnPrice } = await import('./add-on-prices');

const ROW = {
  id: 'tracking_100_month',
  kind: 'tracking' as const,
  price_cents: 7500,
  currency: 'usd',
  billing: 'monthly' as const,
  stripe_lookup_key: 'addon_tracking_100_month',
  stripe_price_id: null,
};

const price = (over: Partial<Stripe.Price> = {}) =>
  ({
    id: 'price_live_t100',
    active: true,
    unit_amount: 7500,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { addon: 'tracking', units: '100' },
    ...over,
  }) as unknown as Stripe.Price;

const list = vi.fn();
const stripe = { prices: { list } } as unknown as Stripe;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.failures = {};
  db.tables = { add_on_products: [{ ...ROW }] };
});

describe('priceMismatch', () => {
  it('passes a price that fits its row, and names what doesn’t', () => {
    expect(priceMismatch(ROW, price())).toBeNull();
    expect(priceMismatch(ROW, price({ unit_amount: 7000 }))).toMatch(/amount/);
    expect(priceMismatch(ROW, price({ currency: 'eur' }))).toMatch(/currency/);
    expect(
      priceMismatch(ROW, price({ recurring: { interval: 'year' } as Stripe.Price.Recurring })),
    ).toMatch(/interval/);
    expect(priceMismatch(ROW, price({ metadata: { addon: 'brand' } }))).toMatch(/addon/);
    expect(priceMismatch(ROW, price({ active: false }))).toBe('inactive');
  });

  it('wants no interval on a one-time row', () => {
    const topUp = { ...ROW, kind: 'ai_topup' as const, billing: 'one_time' as const };
    expect(priceMismatch(topUp, price({ recurring: null, metadata: {} }))).toBeNull();
  });
});

describe('resolveAddOnPrice', () => {
  it('finds the price by its lookup key, and keeps it on the row', async () => {
    list.mockResolvedValue({ data: [price()] });
    await expect(resolveAddOnPrice(stripe, ROW)).resolves.toBe('price_live_t100');
    expect(list).toHaveBeenCalledWith({
      lookup_keys: ['addon_tracking_100_month'],
      active: true,
      limit: 1,
    });
    expect(db.tables.add_on_products[0].stripe_price_id).toBe('price_live_t100');
  });

  it('uses the row’s own price without asking Stripe', async () => {
    await expect(
      resolveAddOnPrice(stripe, { ...ROW, stripe_price_id: 'price_staff' }),
    ).resolves.toBe('price_staff');
    expect(list).not.toHaveBeenCalled();
  });

  it('sells nothing on a missing or mismatched price', async () => {
    list.mockResolvedValue({ data: [] });
    await expect(resolveAddOnPrice(stripe, ROW)).resolves.toBeNull();
    list.mockResolvedValue({ data: [price({ unit_amount: 1 })] });
    await expect(resolveAddOnPrice(stripe, ROW)).resolves.toBeNull();
    await expect(
      resolveAddOnPrice(stripe, { ...ROW, stripe_lookup_key: null }),
    ).resolves.toBeNull();
    expect(db.tables.add_on_products[0].stripe_price_id).toBeNull();
  });
});
