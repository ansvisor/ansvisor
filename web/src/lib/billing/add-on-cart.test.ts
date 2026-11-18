import { describe, expect, it } from 'vitest';
import { currentAddOns, itemChanges, type CartItem } from './add-on-cart';
import type { RecurringAddOnRow } from './add-on-sync';

/** The item changes a Growth workspace's add-on pick makes on its subscription (00546). */

const tier = (units: number): RecurringAddOnRow => ({
  kind: 'tracking',
  stripe_price_id: null,
  stripe_lookup_key: `addon_tracking_${units}_month`,
  grant_prompts: units,
  grant_brands: null,
});
const CATALOG = [
  tier(100),
  tier(1000),
  {
    ...tier(0),
    kind: 'brand' as const,
    grant_prompts: null,
    grant_brands: 1,
    stripe_lookup_key: 'addon_brand_month',
  },
];

const plan: CartItem = { id: 'si_plan', quantity: 1, price: { id: 'price_growth', metadata: {} } };
const tracking = (units: number): CartItem => ({
  id: 'si_tracking',
  quantity: 1,
  price: {
    id: `price_t${units}`,
    lookup_key: `addon_tracking_${units}_month`,
    metadata: { addon: 'tracking' },
  },
});
const brands = (quantity: number): CartItem => ({
  id: 'si_brand',
  quantity,
  price: { id: 'price_brand', lookup_key: 'addon_brand_month', metadata: { addon: 'brand' } },
});

describe('currentAddOns', () => {
  it('finds the tier and the extra brands, never the plan’s item', () => {
    const current = currentAddOns([plan, tracking(1000), brands(3)], CATALOG);
    expect(current.tracking).toMatchObject({ units: 1000, item: { id: 'si_tracking' } });
    expect(current.brands).toMatchObject({ quantity: 3, item: { id: 'si_brand' } });
    expect(currentAddOns([plan], CATALOG)).toEqual({ tracking: null, brands: null });
  });
});

describe('itemChanges', () => {
  const none = { tracking: null, brands: null };
  const target = (trackingPriceId: string | null, extraBrands: number) => ({
    trackingPriceId,
    brandPriceId: 'price_brand',
    extraBrands,
  });

  it('adds a tier and brands to a plan without any', () => {
    expect(itemChanges(none, target('price_t100', 2))).toEqual([
      { price: 'price_t100' },
      { price: 'price_brand', quantity: 2 },
    ]);
  });

  it('swaps the tier on the same item, and sets the brands’ quantity', () => {
    const current = currentAddOns([plan, tracking(100), brands(1)], CATALOG);
    expect(itemChanges(current, target('price_t1000', 4))).toEqual([
      { id: 'si_tracking', price: 'price_t1000' },
      { id: 'si_brand', quantity: 4 },
    ]);
  });

  it('removes the tier, and the brands at 0', () => {
    const current = currentAddOns([plan, tracking(100), brands(2)], CATALOG);
    expect(itemChanges(current, target(null, 0))).toEqual([
      { id: 'si_tracking', deleted: true },
      { id: 'si_brand', deleted: true },
    ]);
  });

  it('changes nothing when nothing changes', () => {
    const current = currentAddOns([plan, tracking(100), brands(2)], CATALOG);
    expect(itemChanges(current, target('price_t100', 2))).toEqual([]);
    expect(itemChanges(none, target(null, 0))).toEqual([]);
  });
});
