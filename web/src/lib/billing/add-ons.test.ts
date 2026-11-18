import { describe, expect, it } from 'vitest';
import {
  addMonthsUtc,
  addOnForPlan,
  addOnInterval,
  addOnOnSale,
  isAddOnPrice,
  planItemOf,
  purchaseIdOf,
  trackingTiers,
  type AddOnProductRow,
} from './add-ons';

const PURCHASE = 'a0000000-0000-4000-8000-000000000001';

describe('add-on packs', () => {
  it('are on sale only while active, sold in the product and with a Stripe price', () => {
    const self = 'self_serve' as const;
    expect(addOnOnSale({ active: true, stripe_price_id: 'price_1', sale: self })).toBe(true);
    expect(addOnOnSale({ active: true, stripe_price_id: null, sale: self })).toBe(false);
    expect(addOnOnSale({ active: false, stripe_price_id: 'price_1', sale: self })).toBe(false);
    expect(addOnOnSale({ active: true, stripe_price_id: 'price_1', sale: 'contact_sales' })).toBe(
      false,
    );
  });

  it('name their purchase in Stripe metadata, and nothing else passes for one', () => {
    expect(purchaseIdOf({ add_on_purchase_id: PURCHASE })).toBe(PURCHASE);
    expect(purchaseIdOf({ add_on_purchase_id: 'not-an-id' })).toBeNull();
    expect(purchaseIdOf({ plan_id: 'growth' })).toBeNull();
    expect(purchaseIdOf(null)).toBeNull();
  });

  it('last whole months, on the month’s last day when it is shorter', () => {
    const at = (iso: string, months: number) => addMonthsUtc(new Date(iso), months).toISOString();
    expect(at('2026-10-30T10:00:00.000Z', 12)).toBe('2027-10-30T10:00:00.000Z');
    expect(at('2027-01-31T08:00:00.000Z', 1)).toBe('2027-02-28T08:00:00.000Z');
    expect(at('2027-12-31T23:59:00.000Z', 2)).toBe('2028-02-29T23:59:00.000Z');
  });

  it('never take the plan’s place on its subscription', () => {
    const pack = { id: 'si_pack', metadata: { add_on_purchase_id: PURCHASE } };
    const plan = { id: 'si_plan', metadata: {} };
    expect(planItemOf([pack, plan])).toBe(plan);
    expect(planItemOf([plan, pack])).toBe(plan);
    expect(planItemOf([])).toBeUndefined();
  });

  it('never take a Growth add-on item for the plan’s, by its lookup key or metadata (00546)', () => {
    const plan = { id: 'si_plan', metadata: {}, price: { lookup_key: null, metadata: {} } };
    const tracking = {
      id: 'si_tracking',
      metadata: {},
      price: { lookup_key: 'addon_tracking_1000_month', metadata: { addon: 'tracking' } },
    };
    const brand = { id: 'si_brand', metadata: {}, price: { metadata: { addon: 'brand' } } };
    expect(planItemOf([tracking, brand, plan])).toBe(plan);
    // No plan's item: none, rather than an add-on's.
    expect(planItemOf([tracking, brand])).toBeUndefined();
  });

  it('know a Growth add-on’s price', () => {
    expect(isAddOnPrice({ lookup_key: 'addon_brand_year' })).toBe(true);
    expect(isAddOnPrice({ lookup_key: null, metadata: { addon: 'ai_topup' } })).toBe(true);
    expect(isAddOnPrice({ lookup_key: 'growth_month', metadata: { plan_id: 'growth' } })).toBe(
      false,
    );
    expect(isAddOnPrice({ metadata: { addon: 'something' } })).toBe(false);
    expect(isAddOnPrice('price_1')).toBe(false);
    expect(isAddOnPrice(null)).toBe(false);
  });
});

const product = (over: Partial<AddOnProductRow>): AddOnProductRow => ({
  id: 'x',
  kind: 'tracking',
  name: 'Extra tracking',
  price_cents: 7500,
  currency: 'usd',
  billing: 'monthly',
  grant_ai_usd: null,
  grant_bytes: null,
  grant_prompts: 100,
  grant_brands: null,
  grant_briefs: null,
  grant_opportunities: null,
  multiplier: null,
  valid_months: null,
  stripe_lookup_key: null,
  stripe_price_id: 'price_1',
  sale: 'self_serve',
  plans: ['growth'],
  active: true,
  highlight: false,
  sort: 0,
  ...over,
});

describe('Growth add-ons', () => {
  it('are for the plans they name; a pack with no plans is for any paid plan', () => {
    expect(addOnForPlan({ plans: ['growth'] }, 'growth')).toBe(true);
    expect(addOnForPlan({ plans: ['growth'] }, 'starter')).toBe(false);
    expect(addOnForPlan({ plans: ['growth'] }, 'enterprise')).toBe(false);
    expect(addOnForPlan({ plans: null }, 'starter')).toBe(true);
  });

  it('bill on the interval their billing names', () => {
    expect(addOnInterval({ billing: 'monthly' })).toBe('month');
    expect(addOnInterval({ billing: 'yearly' })).toBe('year');
    expect(addOnInterval({ billing: 'one_time' })).toBeNull();
  });

  it('list the active tracking tiers of one interval, smallest first, Contact sales kept', () => {
    const rows = [
      product({ id: 't1000m', grant_prompts: 1000 }),
      product({ id: 't100m', grant_prompts: 100 }),
      product({ id: 't5000m', grant_prompts: 5000, sale: 'contact_sales' }),
      product({ id: 't250m', grant_prompts: 250, active: false }),
      product({ id: 't100y', grant_prompts: 100, billing: 'yearly' }),
      product({ id: 'brand', kind: 'brand', grant_prompts: null, grant_brands: 1 }),
    ];
    expect(trackingTiers(rows, 'month').map((p) => p.id)).toEqual(['t100m', 't1000m', 't5000m']);
    expect(trackingTiers(rows, 'year').map((p) => p.id)).toEqual(['t100y']);
    const shown = trackingTiers(rows, 'month');
    expect(shown.filter(addOnOnSale).map((p) => p.id)).toEqual(['t100m', 't1000m']);
  });
});
