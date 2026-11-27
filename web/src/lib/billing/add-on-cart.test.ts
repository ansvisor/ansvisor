import { describe, expect, it } from 'vitest';
import {
  addOnsThroughPlanChange,
  currentAddOns,
  currentSlotItems,
  itemChanges,
  slotItemChanges,
  type CartItem,
} from './add-on-cart';
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

describe('addOnsThroughPlanChange', () => {
  const periodRow = (
    id: string,
    kind: 'tracking' | 'brand',
    billing: 'monthly' | 'yearly',
    units: number | null,
  ) => ({
    id,
    kind,
    billing,
    active: true,
    stripe_price_id: null,
    stripe_lookup_key: `addon_${id}`,
    grant_prompts: units,
    grant_brands: kind === 'brand' ? 1 : null,
  });
  const ROWS = [
    periodRow('tracking_100_month', 'tracking', 'monthly', 100),
    periodRow('tracking_100_year', 'tracking', 'yearly', 100),
    periodRow('brand_month', 'brand', 'monthly', null),
    periodRow('brand_year', 'brand', 'yearly', null),
  ];
  const items = [plan, tracking(100), brands(2)];

  it('moves each add-on to the new period’s price on Growth', () => {
    expect(addOnsThroughPlanChange(items, ROWS, { planId: 'growth', interval: 'year' })).toEqual({
      removals: [],
      swaps: [
        { itemId: 'si_tracking', row: ROWS[1] },
        { itemId: 'si_brand', row: ROWS[3] },
      ],
      missing: [],
    });
  });

  it('leaves them when the period stays', () => {
    expect(addOnsThroughPlanChange(items, ROWS, { planId: 'growth', interval: 'month' })).toEqual({
      removals: [],
      swaps: [],
      missing: [],
    });
  });

  it('ends them on any other plan', () => {
    expect(addOnsThroughPlanChange(items, ROWS, { planId: 'starter', interval: 'month' })).toEqual({
      removals: ['si_tracking', 'si_brand'],
      swaps: [],
      missing: [],
    });
  });

  it('names one with no price on the new period', () => {
    const noYear = ROWS.filter((r) => r.id !== 'brand_year');
    expect(
      addOnsThroughPlanChange(items, noYear, { planId: 'growth', interval: 'year' }).missing,
    ).toEqual(['si_brand']);
  });
});

describe('tracking slots (00564)', () => {
  const slotRow = (platform: string, billing: 'monthly' | 'yearly' = 'monthly') => {
    const stripeId = platform.replace(/-/g, '_');
    const suffix = billing === 'monthly' ? 'month' : 'year';
    return {
      id: `slots_${stripeId}_${suffix}`,
      kind: 'slots' as const,
      billing,
      active: true,
      stripe_price_id: null,
      stripe_lookup_key: `addon_slots_${stripeId}_${suffix}`,
      grant_prompts: null,
      grant_brands: null,
      platform,
      grant_slots: 100,
    };
  };
  const slotItem = (platform: string, units: number, billing: 'monthly' | 'yearly' = 'monthly') => {
    const row = slotRow(platform, billing);
    return {
      id: `si_${row.id}`,
      quantity: units,
      price: {
        id: `price_${row.id}`,
        lookup_key: row.stripe_lookup_key,
        metadata: { addon: 'slots', platform: platform.replace(/-/g, '_') },
      },
    } as CartItem;
  };
  const ROWS = [
    slotRow('claude-web'),
    slotRow('claude-web', 'yearly'),
    slotRow('grok-web'),
    slotRow('grok-web', 'yearly'),
  ];

  it('reads the slot items by platform', () => {
    const current = currentSlotItems([plan, tracking(100), slotItem('claude-web', 3)], ROWS);
    expect([...current.keys()]).toEqual(['claude-web']);
    expect(current.get('claude-web')?.units).toBe(3);
  });

  it('adds, resizes and removes slot items, each carrying the volume coupon', () => {
    const current = currentSlotItems([slotItem('claude-web', 3), slotItem('grok-web', 1)], ROWS);
    const changes = slotItemChanges(
      current,
      new Map([
        ['claude-web', { priceId: 'price_slots_claude_web_month', units: 8 }],
        ['naver-web', { priceId: 'price_naver', units: 2 }],
      ]),
      'addon_slots_off_0125',
    );
    const coupon = [{ coupon: 'addon_slots_off_0125' }];
    expect(changes).toEqual([
      { id: 'si_slots_claude_web_month', quantity: 8, discounts: coupon },
      { id: 'si_slots_grok_web_month', deleted: true },
      { price: 'price_naver', quantity: 2, discounts: coupon },
    ]);
  });

  it('clears the coupon when no discount is left, and changes nothing when no units do', () => {
    const current = currentSlotItems([slotItem('claude-web', 3)], ROWS);
    expect(
      slotItemChanges(
        current,
        new Map([['claude-web', { priceId: 'price_slots_claude_web_month', units: 1 }]]),
        null,
      ),
    ).toEqual([{ id: 'si_slots_claude_web_month', quantity: 1, discounts: '' }]);
    expect(
      slotItemChanges(
        current,
        new Map([['claude-web', { priceId: 'price_slots_claude_web_month', units: 3 }]]),
        'addon_slots_off_0500',
      ),
    ).toEqual([]);
  });

  it('keeps slots through a period change on Growth and Enterprise, on the same platform', () => {
    const items = [plan, slotItem('claude-web', 3), slotItem('grok-web', 1)];
    for (const planId of ['growth', 'enterprise']) {
      const result = addOnsThroughPlanChange(items, ROWS, { planId, interval: 'year' });
      expect(result.removals).toEqual([]);
      expect(result.swaps.map((s) => [s.itemId, s.row.id])).toEqual([
        ['si_slots_claude_web_month', 'slots_claude_web_year'],
        ['si_slots_grok_web_month', 'slots_grok_web_year'],
      ]);
    }
  });

  it('ends slots on Starter', () => {
    const items = [plan, slotItem('claude-web', 3)];
    expect(
      addOnsThroughPlanChange(items, ROWS, { planId: 'starter', interval: 'month' }).removals,
    ).toEqual(['si_slots_claude_web_month']);
  });
});
