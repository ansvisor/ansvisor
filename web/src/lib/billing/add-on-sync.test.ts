// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Growth's recurring add-ons (00546) are mirrored from the plan's Stripe
 * subscription onto its organization: the whole state each time, read from
 * Stripe afresh. No call reaches Stripe: the subscription is written here.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const stripeApi = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock('@/lib/stripe', () => ({ stripe: { subscriptions: { retrieve: stripeApi.retrieve } } }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { addOnTotals, syncAddOns } = await import('./add-on-sync');

const tier = (units: number, interval = 'month') => ({
  kind: 'tracking' as const,
  stripe_price_id: null,
  stripe_lookup_key: `addon_tracking_${units}_${interval}`,
  grant_prompts: units,
  grant_brands: null,
});
const BRAND = {
  kind: 'brand' as const,
  stripe_price_id: 'price_brand_m',
  stripe_lookup_key: 'addon_brand_month',
  grant_prompts: null,
  grant_brands: 1,
};
const CATALOG = [tier(100), tier(1000), tier(1000, 'year'), BRAND];

const planItem = { quantity: 1, price: { id: 'price_growth', lookup_key: null, metadata: {} } };
const trackingItem = (units: number) => ({
  quantity: 1,
  price: {
    id: `price_t${units}`,
    lookup_key: `addon_tracking_${units}_month`,
    metadata: { addon: 'tracking', units: String(units) },
  },
});
const brandItem = (quantity: number) => ({
  quantity,
  price: { id: 'price_brand_m', lookup_key: 'addon_brand_month', metadata: { addon: 'brand' } },
});

describe('addOnTotals', () => {
  it('adds the tracking tier’s locations and the extra brands, and nothing for the plan', () => {
    expect(addOnTotals([planItem, trackingItem(1000), brandItem(3)], CATALOG)).toEqual({
      prompts: 1000,
      brands: 3,
    });
    expect(addOnTotals([planItem], CATALOG)).toEqual({ prompts: 0, brands: 0 });
  });

  it('leaves CHAT-18’s storage packs out', () => {
    const storage = {
      quantity: 1,
      price: { id: 'price_st25', lookup_key: null, metadata: {} },
    };
    expect(addOnTotals([planItem, storage], CATALOG)).toEqual({ prompts: 0, brands: 0 });
  });

  it('knows a price by its resolved id too', () => {
    const byId = { quantity: 2, price: { id: 'price_brand_m', metadata: { addon: 'brand' } } };
    expect(addOnTotals([byId], CATALOG)).toEqual({ prompts: 0, brands: 2 });
  });

  it('falls back on Stripe’s metadata for a price the catalog doesn’t hold (set by staff)', () => {
    const staff = {
      quantity: 1,
      price: { id: 'price_x', lookup_key: null, metadata: { addon: 'tracking', units: '7500' } },
    };
    expect(addOnTotals([staff], CATALOG)).toEqual({ prompts: 7500, brands: 0 });
    const bad = {
      quantity: 1,
      price: { id: 'price_y', lookup_key: null, metadata: { addon: 'tracking', units: 'lots' } },
    };
    expect(addOnTotals([bad], CATALOG)).toEqual({ prompts: 0, brands: 0 });
  });
});

describe('syncAddOns', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
    db.failures = {};
    db.log = [];
    db.tables = {
      organizations: [
        { id: ORG, stripe_subscription_id: 'sub_1', add_on_prompts: 250, add_on_brands: 1 },
        // A workspace on another subscription is never touched.
        { id: OTHER, stripe_subscription_id: 'sub_2', add_on_prompts: 100, add_on_brands: 0 },
      ],
      add_on_products: [
        ...CATALOG,
        // A CHAT-18 pack: not read.
        { kind: 'storage', stripe_price_id: 'price_st25', stripe_lookup_key: null },
      ],
    };
  });

  afterEach(() => vi.unstubAllEnvs());

  const org = (id: string) => db.tables.organizations.find((o) => o.id === id);
  const subscription = (status: string, items: unknown[]) => ({
    id: 'sub_1',
    status,
    items: { data: items },
  });

  it('writes what the subscription adds, read from Stripe afresh', async () => {
    stripeApi.retrieve.mockResolvedValue(
      subscription('active', [planItem, trackingItem(1000), brandItem(2)]),
    );
    await syncAddOns('sub_1');
    expect(stripeApi.retrieve).toHaveBeenCalledWith('sub_1');
    expect(org(ORG)).toMatchObject({ add_on_prompts: 1000, add_on_brands: 2 });
    expect(org(OTHER)).toMatchObject({ add_on_prompts: 100, add_on_brands: 0 });
  });

  it('writes 0 once the add-ons are removed, or the subscription isn’t active or in trial', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active', [planItem]));
    await syncAddOns('sub_1');
    expect(org(ORG)).toMatchObject({ add_on_prompts: 0, add_on_brands: 0 });

    for (const status of ['canceled', 'past_due', 'unpaid', 'incomplete_expired']) {
      db.tables.organizations[0].add_on_prompts = 250;
      stripeApi.retrieve.mockResolvedValue(subscription(status, [planItem, trackingItem(100)]));
      await syncAddOns('sub_1');
      expect(org(ORG)?.add_on_prompts).toBe(0);
    }
  });

  it('counts in the trial too', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing', [planItem, trackingItem(100)]));
    await syncAddOns('sub_1');
    expect(org(ORG)?.add_on_prompts).toBe(100);
  });

  it('throws when it can’t read the catalog or write the organization, for Stripe to retry', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active', [planItem, trackingItem(100)]));
    db.failures = { add_on_products: { message: 'down' } };
    await expect(syncAddOns('sub_1')).rejects.toThrow('down');
    db.failures = { organizations: { message: 'down' } };
    await expect(syncAddOns('sub_1')).rejects.toThrow('down');
    expect(org(ORG)?.add_on_prompts).toBe(250);
  });

  it('throws without Stripe', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    await expect(syncAddOns('sub_1')).rejects.toThrow('Stripe is not configured');
  });
});
