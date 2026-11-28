// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Buying, changing or removing Growth's extra tracking and brands (00546):
 * Admins of an active Growth plan only; items on the plan's own subscription,
 * on its interval, charged at once; never below what's in use. Stripe is
 * mocked; nothing reaches it.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const auth = vi.hoisted(() => ({ user: { id: 'u_admin' } as unknown }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }) } }),
}));

const guard = vi.hoisted(() => ({ assertWritable: vi.fn() }));
vi.mock('@/lib/subscription-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subscription-guard')>()),
  assertWritable: guard.assertWritable,
}));

const capacity = vi.hoisted(() => ({ settleSlots: vi.fn() }));
vi.mock('@/lib/prompt-capacity', () => capacity);
const usage = vi.hoisted(() => ({
  prompts: 150,
  brands: 3,
  slots: new Map<string, number>(),
}));
vi.mock('@/lib/prompt-locations', () => ({
  getOrgLocationUsage: async () => ({ total: usage.prompts, byBrand: {} }),
  getOrgSlotUsage: async () => usage.slots,
}));
vi.mock('@/lib/plan-brand-count', () => ({ countPlanBrands: async () => usage.brands }));

const stripeApi = vi.hoisted(() => ({
  retrieve: vi.fn(),
  update: vi.fn(),
  preview: vi.fn(),
  listPrices: vi.fn(),
  createInvoice: vi.fn(),
  createInvoiceItem: vi.fn(),
  finalize: vi.fn(),
  pay: vi.fn(),
  voidInvoice: vi.fn(),
  retrievePrice: vi.fn(),
  retrieveCoupon: vi.fn(),
  createCoupon: vi.fn(),
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: { retrieve: stripeApi.retrieve, update: stripeApi.update },
    invoices: {
      createPreview: stripeApi.preview,
      create: stripeApi.createInvoice,
      finalizeInvoice: stripeApi.finalize,
      pay: stripeApi.pay,
      voidInvoice: stripeApi.voidInvoice,
    },
    invoiceItems: { create: stripeApi.createInvoiceItem },
    prices: { list: stripeApi.listPrices, retrieve: stripeApi.retrievePrice },
    coupons: { retrieve: stripeApi.retrieveCoupon, create: stripeApi.createCoupon },
  },
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { SubscriptionInactiveError } = await import('@/lib/subscription-guard');
const { applyAddOnChange, previewAddOnChange, readPlanAddOns } = await import('./plan-add-ons');

const ORG = '11111111-1111-4111-8111-111111111111';

const row = (id: string, kind: 'tracking' | 'brand', units: number | null, over = {}) => ({
  id,
  kind,
  price_cents: kind === 'brand' ? 2500 : (units ?? 0) * 75,
  currency: 'usd',
  billing: id.endsWith('year') ? 'yearly' : 'monthly',
  grant_prompts: kind === 'tracking' ? units : null,
  grant_brands: kind === 'brand' ? 1 : null,
  stripe_price_id: `price_${id}`,
  stripe_lookup_key: `addon_${id}`,
  sale: 'self_serve',
  plans: ['growth'],
  active: true,
  ...over,
});

const topUpRow = (multiplier: number, price: number) => ({
  id: `ai_topup_${multiplier}x`,
  kind: 'ai_topup',
  price_cents: price,
  currency: 'usd',
  billing: 'one_time',
  grant_prompts: null,
  grant_brands: null,
  multiplier,
  stripe_price_id: `price_ai_topup_${multiplier}x`,
  stripe_lookup_key: `addon_ai_topup_${multiplier}x`,
  sale: 'self_serve',
  plans: ['growth', 'enterprise'],
  active: true,
});

const planItem = (interval = 'month') => ({
  id: 'si_plan',
  quantity: 1,
  price: {
    id: 'price_growth',
    unit_amount: interval === 'month' ? 24900 : 239000,
    currency: 'usd',
    recurring: { interval },
    metadata: {},
  },
});
const addOnItem = (id: string, product: string, quantity = 1) => ({
  id,
  quantity,
  price: {
    id: `price_${product}`,
    lookup_key: `addon_${product}`,
    unit_amount: 0,
    metadata: { addon: product.startsWith('brand') ? 'brand' : 'tracking' },
  },
});
/** A subscription discount as Stripe returns it with `discounts.source.coupon` expanded. */
const discount = (id: string, coupon: Record<string, unknown>, end: number | null = null) => ({
  id,
  end,
  source: { type: 'coupon', coupon: { valid: true, ...coupon } },
});
const subscription = (items: unknown[], over = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  discounts: [],
  items: { data: items },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  auth.user = { id: 'u_admin' };
  usage.prompts = 150;
  usage.brands = 3;
  usage.slots = new Map();
  guard.assertWritable.mockResolvedValue(undefined);
  db.failures = {};
  db.tables = {
    profiles: [
      { id: 'u_admin', organization_id: ORG, role: 'admin' },
      { id: 'u_manager', organization_id: ORG, role: 'manager' },
    ],
    organizations: [
      {
        id: ORG,
        plan: 'growth',
        subscription_status: 'active',
        cancel_at_period_end: false,
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
        add_on_prompts: 0,
        add_on_brands: 0,
      },
    ],
    add_on_products: [
      row('tracking_100_month', 'tracking', 100),
      row('tracking_1000_month', 'tracking', 1000),
      row('tracking_5000_month', 'tracking', 5000, { sale: 'contact_sales' }),
      row('tracking_1000_year', 'tracking', 1000),
      // Extra brands: Growth's and Enterprise's (00566).
      row('brand_month', 'brand', null, { plans: ['growth', 'enterprise'] }),
      row('brand_year', 'brand', null, { plans: ['growth', 'enterprise'] }),
      topUpRow(5, 3900),
      topUpRow(10, 6900),
      topUpRow(20, 12900),
    ],
    add_on_purchases: [],
  };
  stripeApi.createInvoice.mockResolvedValue({ id: 'in_topup' });
  stripeApi.createInvoiceItem.mockResolvedValue({ id: 'ii_topup' });
  stripeApi.finalize.mockResolvedValue({ id: 'in_topup' });
  stripeApi.pay.mockResolvedValue({ id: 'in_topup', status: 'paid' });
  stripeApi.voidInvoice.mockResolvedValue({ id: 'in_topup' });
  stripeApi.retrieve.mockResolvedValue(subscription([planItem()]));
  stripeApi.preview.mockResolvedValue({ amount_due: 4120 });
  stripeApi.update.mockImplementation(async (_id: string, params: { items: unknown[] }) => ({
    ...subscription([planItem()]),
    items: {
      data: [
        planItem(),
        ...(params.items as { price?: string; quantity?: number }[])
          .filter((i) => i.price)
          .map((i) => ({
            id: 'si_new',
            quantity: i.quantity ?? 1,
            price: {
              id: i.price,
              lookup_key: (i.price as string).replace('price_', 'addon_'),
              metadata: {},
            },
          })),
      ],
    },
  }));
});

afterEach(() => vi.unstubAllEnvs());

const org = () => db.tables.organizations[0];

describe('the preview', () => {
  it('shows the new limits, what’s due today and the total from the next renewal', async () => {
    const preview = await previewAddOnChange({ trackingUnits: 1000, extraBrands: 3 });
    expect(preview).toMatchObject({
      ok: true,
      changed: true,
      limits: { prompts: 1250, brands: 7 },
      dueTodayCents: 4120,
      // $249 + $750 (here 1,000 × 75¢) + 3 × $25
      totalCents: 24900 + 75000 + 7500,
      interval: 'month',
    });
    expect(stripeApi.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        subscription: 'sub_1',
        subscription_details: expect.objectContaining({
          items: [
            { price: 'price_tracking_1000_month' },
            { price: 'price_brand_month', quantity: 3 },
          ],
          proration_behavior: 'always_invoice',
        }),
      }),
    );
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('picks the add-on prices on the plan’s interval', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription([planItem('year')]));
    await previewAddOnChange({ trackingUnits: 1000, extraBrands: 1 });
    expect(stripeApi.preview.mock.calls[0][0].subscription_details.items).toEqual([
      { price: 'price_tracking_1000_year' },
      { price: 'price_brand_year', quantity: 1 },
    ]);
  });
});

describe('applying', () => {
  it('changes the subscription once, charged at once, and writes the new limits', async () => {
    const preview = await previewAddOnChange({ trackingUnits: 100, extraBrands: 2 });
    if (!preview.ok) throw new Error('preview refused');
    await expect(
      applyAddOnChange({
        trackingUnits: 100,
        extraBrands: 2,
        prorationDate: preview.prorationDate,
      }),
    ).resolves.toEqual({ ok: true, changed: true, limits: { prompts: 350, brands: 6 } });
    expect(guard.assertWritable).toHaveBeenCalled();
    const [id, params, options] = stripeApi.update.mock.calls[0];
    expect(id).toBe('sub_1');
    expect(params).toMatchObject({
      items: [{ price: 'price_tracking_100_month' }, { price: 'price_brand_month', quantity: 2 }],
      proration_behavior: 'always_invoice',
      proration_date: preview.prorationDate,
      payment_behavior: 'error_if_incomplete',
    });
    expect(params).not.toHaveProperty('discounts');
    expect(options.idempotencyKey).toMatch(new RegExp(`^plan-add-ons-${ORG}-[0-9a-f]{32}$`));
    expect(org()).toMatchObject({ add_on_prompts: 100, add_on_brands: 2 });
  });

  it('swaps a tier on its own item and removes brands at 0', async () => {
    usage.brands = 4;
    stripeApi.retrieve.mockResolvedValue(
      subscription([
        planItem(),
        addOnItem('si_t', 'tracking_100_month'),
        addOnItem('si_b', 'brand_month', 2),
      ]),
    );
    await applyAddOnChange({ trackingUnits: 1000, extraBrands: 0 });
    expect(stripeApi.update.mock.calls[0][1].items).toEqual([
      { id: 'si_t', price: 'price_tracking_1000_month' },
      { id: 'si_b', deleted: true },
    ]);
  });

  it('does nothing when nothing changes', async () => {
    stripeApi.retrieve.mockResolvedValue(
      subscription([planItem(), addOnItem('si_t', 'tracking_100_month')]),
    );
    await expect(applyAddOnChange({ trackingUnits: 100, extraBrands: 0 })).resolves.toEqual({
      ok: true,
      changed: false,
      limits: { prompts: 350, brands: 4 },
    });
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('moves the subscription’s discount onto the plan’s item, so add-ons are charged in full', async () => {
    stripeApi.retrieve.mockResolvedValue(
      subscription([planItem()], {
        discounts: [
          discount('di_teknopark', { id: 'TEKNOPARK', duration: 'forever', percent_off: 20 }),
        ],
      }),
    );
    await applyAddOnChange({ trackingUnits: 100, extraBrands: 0 });
    expect(stripeApi.retrieve).toHaveBeenCalledWith('sub_1', {
      expand: ['discounts.source.coupon'],
    });
    const params = stripeApi.update.mock.calls[0][1];
    expect(params.discounts).toBe('');
    // Stripe takes no existing discount (di_…) on an item: the coupon goes as a new one.
    expect(params.items).toEqual([
      { price: 'price_tracking_100_month' },
      { id: 'si_plan', discounts: [{ coupon: 'TEKNOPARK' }] },
    ]);
  });

  it('moves a coupon that runs for months as a copy for the whole months it has left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-28T12:00:00Z'));
    try {
      // SAVE50 for 3 months from Oct 10: it ends Jan 10, so Dec 10 is its last renewal.
      stripeApi.retrieve.mockResolvedValue(
        subscription([planItem()], {
          discounts: [
            discount(
              'di_save50',
              { id: 'SAVE50', name: 'SAVE50', duration: 'repeating', percent_off: 50 },
              Date.UTC(2027, 0, 10) / 1000,
            ),
          ],
        }),
      );
      stripeApi.retrieveCoupon.mockRejectedValue({ code: 'resource_missing' });
      stripeApi.createCoupon.mockImplementation(async (params: { id: string }) => params);
      await applyAddOnChange({ trackingUnits: 100, extraBrands: 0 });
      expect(stripeApi.createCoupon).toHaveBeenCalledWith({
        id: 'SAVE50_plan_1m',
        name: 'SAVE50',
        percent_off: 50,
        duration: 'repeating',
        duration_in_months: 1,
        metadata: { moved_from: 'SAVE50' },
      });
      expect(stripeApi.update.mock.calls[0][1].items).toContainEqual({
        id: 'si_plan',
        discounts: [{ coupon: 'SAVE50_plan_1m' }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers Stripe’s words when the card is declined, and keeps the limits', async () => {
    stripeApi.update.mockRejectedValue({
      type: 'StripeCardError',
      statusCode: 402,
      message: 'Your card was declined.',
    });
    await expect(applyAddOnChange({ trackingUnits: 100, extraBrands: 0 })).resolves.toEqual({
      ok: false,
      failure: 'payment_failed',
      message: 'Your card was declined.',
    });
    expect(org()).toMatchObject({ add_on_prompts: 0, add_on_brands: 0 });
  });

  it('answers failed, without throwing, when Stripe is down', async () => {
    stripeApi.update.mockRejectedValue(new Error('timeout'));
    await expect(applyAddOnChange({ trackingUnits: 100, extraBrands: 0 })).resolves.toEqual({
      ok: false,
      failure: 'failed',
    });
  });
});

describe('is refused', () => {
  const refused = async (failure: string, input = { trackingUnits: 100, extraBrands: 0 }) => {
    await expect(applyAddOnChange(input)).resolves.toMatchObject({ ok: false, failure });
    expect(stripeApi.update).not.toHaveBeenCalled();
  };

  it('when the workspace is read-only', async () => {
    guard.assertWritable.mockRejectedValue(new SubscriptionInactiveError());
    await refused('no_plan');
  });

  it('to everyone but Admins, and off the cloud', async () => {
    auth.user = { id: 'u_manager' };
    await refused('admin_only');
    auth.user = { id: 'u_admin' };
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await refused('not_cloud');
  });

  it('on Starter and Enterprise, saying which', async () => {
    org().plan = 'starter';
    await expect(applyAddOnChange({ trackingUnits: 100, extraBrands: 0 })).resolves.toEqual({
      ok: false,
      failure: 'not_growth',
      plan: 'starter',
    });
    org().plan = 'enterprise';
    await refused('not_growth');
  });

  it('in the trial, without an active plan, and while the plan is set to end', async () => {
    org().subscription_status = 'trialing';
    await refused('trial');
    org().subscription_status = 'past_due';
    await refused('no_plan');
    org().subscription_status = 'active';
    org().cancel_at_period_end = true;
    await refused('ending');
  });

  it('for a Contact sales tier, and one with no Stripe price that fits', async () => {
    await refused('contact_sales', { trackingUnits: 5000, extraBrands: 0 });
    await refused('unavailable', { trackingUnits: 300, extraBrands: 0 });
    db.tables.add_on_products[0] = {
      ...db.tables.add_on_products[0],
      stripe_price_id: null,
    };
    stripeApi.listPrices.mockResolvedValue({ data: [] });
    await refused('unavailable');
  });

  it('below what’s in use, with the numbers', async () => {
    stripeApi.retrieve.mockResolvedValue(
      subscription([
        planItem(),
        addOnItem('si_t', 'tracking_1000_month'),
        addOnItem('si_b', 'brand_month', 2),
      ]),
    );
    usage.prompts = 950;
    usage.brands = 6;
    await expect(applyAddOnChange({ trackingUnits: 100, extraBrands: 2 })).resolves.toEqual({
      ok: false,
      failure: 'below_usage',
      inUse: { prompts: 950, brands: 6 },
      limits: { prompts: 350, brands: 6 },
    });
    // Brands 6 of 6 and prompts within: lowering the tier only is fine.
    usage.prompts = 250;
    await applyAddOnChange({ trackingUnits: 100, extraBrands: 2 });
    expect(stripeApi.update).toHaveBeenCalledTimes(1);
  });

  it('for input that isn’t a count', async () => {
    await refused('unavailable', { trackingUnits: -1, extraBrands: 0 });
    await refused('unavailable', { trackingUnits: 100, extraBrands: 1.5 });
  });
});

describe('an AI usage top-up', () => {
  const purchases = () => db.tables.add_on_purchases;

  it('adds its price in full to what’s due today', async () => {
    const preview = await previewAddOnChange({ trackingUnits: 100, extraBrands: 0, topUp: 10 });
    expect(preview).toMatchObject({ ok: true, changed: true, dueTodayCents: 4120 + 6900 });
    // Alone: nothing to prorate, no preview asked of Stripe.
    stripeApi.preview.mockClear();
    await expect(
      previewAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 5 }),
    ).resolves.toMatchObject({ ok: true, changed: true, dueTodayCents: 3900 });
    expect(stripeApi.preview).not.toHaveBeenCalled();
  });

  it('rides on the plan change, one charge, its purchase pending until the webhook', async () => {
    await expect(
      applyAddOnChange({ trackingUnits: 100, extraBrands: 0, topUp: 10 }),
    ).resolves.toMatchObject({ ok: true, changed: true });
    expect(purchases()).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        product_id: 'ai_topup_10x',
        bought_by: 'u_admin',
        status: 'pending',
      }),
    ]);
    const params = stripeApi.update.mock.calls[0][1];
    expect(params.add_invoice_items).toEqual([
      {
        price: 'price_ai_topup_10x',
        metadata: { add_on_purchase_id: purchases()[0].id, organization_id: ORG },
      },
    ]);
    expect(stripeApi.createInvoice).not.toHaveBeenCalled();
  });

  it('alone is a one-line invoice, paid at once from the card on file', async () => {
    await expect(
      applyAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 20 }),
    ).resolves.toMatchObject({ ok: true, changed: true });
    expect(stripeApi.update).not.toHaveBeenCalled();
    const purchaseId = purchases()[0].id;
    expect(stripeApi.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        collection_method: 'charge_automatically',
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        metadata: { add_on_purchase_id: purchaseId, organization_id: ORG },
      }),
      { idempotencyKey: `add-on-invoice-${purchaseId}` },
    );
    expect(stripeApi.createInvoiceItem).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: 'in_topup', pricing: { price: 'price_ai_topup_20x' } }),
      { idempotencyKey: `add-on-item-${purchaseId}` },
    );
    expect(stripeApi.pay).toHaveBeenCalledWith('in_topup');
    expect(purchases()[0]).toMatchObject({ status: 'pending', stripe_invoice_id: 'in_topup' });
  });

  it('from Get more keeps the add-ons Stripe has now, whatever the window read', async () => {
    // The window read no add-ons; another tab has since bought a tier and 2 brands.
    stripeApi.retrieve.mockResolvedValue(
      subscription([
        planItem(),
        addOnItem('si_t', 'tracking_100_month'),
        addOnItem('si_b', 'brand_month', 2),
      ]),
    );
    await expect(
      applyAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 5, topUpOnly: true }),
    ).resolves.toMatchObject({ ok: true, changed: true });
    // Nothing reverted: no subscription change, only the top-up's own invoice.
    expect(stripeApi.update).not.toHaveBeenCalled();
    expect(stripeApi.createInvoiceItem).toHaveBeenCalledWith(
      expect.objectContaining({ pricing: { price: 'price_ai_topup_5x' } }),
      expect.anything(),
    );
    // And it never adds one: a snapshot ahead of Stripe changes nothing either.
    stripeApi.retrieve.mockResolvedValue(subscription([planItem()]));
    await applyAddOnChange({ trackingUnits: 1000, extraBrands: 3, topUp: 5, topUpOnly: true });
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('only, without a top-up, is refused', async () => {
    await expect(
      applyAddOnChange({ trackingUnits: 0, extraBrands: 0, topUpOnly: true }),
    ).resolves.toMatchObject({ ok: false, failure: 'unavailable' });
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('can be bought again: no monthly cap', async () => {
    await applyAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 20 });
    await applyAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 20 });
    expect(purchases()).toHaveLength(2);
    expect(stripeApi.pay).toHaveBeenCalledTimes(2);
  });

  it('declined: the invoice is voided and nothing is bought', async () => {
    stripeApi.pay.mockRejectedValue({
      type: 'StripeCardError',
      statusCode: 402,
      message: 'Your card was declined.',
    });
    await expect(applyAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 5 })).resolves.toEqual(
      { ok: false, failure: 'payment_failed', message: 'Your card was declined.' },
    );
    expect(stripeApi.voidInvoice).toHaveBeenCalledWith('in_topup');
    expect(purchases()[0].status).toBe('failed');
  });

  it('declined with a plan change: nothing changes and the purchase fails', async () => {
    stripeApi.update.mockRejectedValue({ type: 'StripeCardError', message: 'Declined.' });
    await applyAddOnChange({ trackingUnits: 100, extraBrands: 0, topUp: 5 });
    expect(purchases()[0].status).toBe('failed');
  });

  it('isn’t sold when its multiplier isn’t in the catalog, or on Starter', async () => {
    await expect(
      applyAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 7 }),
    ).resolves.toMatchObject({ ok: false, failure: 'unavailable' });
    org().plan = 'starter';
    await expect(
      applyAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 5 }),
    ).resolves.toMatchObject({ ok: false, failure: 'not_growth' });
    expect(purchases()).toEqual([]);
  });
});

describe('what Billing shows', () => {
  it('lists the tiers on the plan’s period, the brand price, the top-ups and what is bought', async () => {
    org().add_on_prompts = 100;
    org().add_on_brands = 2;
    org().subscription_ends_at = '2026-11-29T10:00:00.000Z';
    const read = await readPlanAddOns();
    expect(read).toMatchObject({
      ok: true,
      addOns: {
        state: 'open',
        interval: 'month',
        base: { prompts: 250, brands: 4 },
        current: { trackingUnits: 100, extraBrands: 2 },
        tiers: [
          { units: 100, priceCents: 7500, contactSales: false },
          { units: 1000, priceCents: 75000, contactSales: false },
          { units: 5000, priceCents: 375000, contactSales: true },
        ],
        brandPriceCents: 2500,
        topUps: [
          { multiplier: 5, priceCents: 3900 },
          { multiplier: 10, priceCents: 6900 },
          { multiplier: 20, priceCents: 12900 },
        ],
        renewsOn: '2026-11-29T10:00:00.000Z',
      },
    });
  });

  it('shows yearly prices on a yearly plan', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription([planItem('year')]));
    const read = await readPlanAddOns();
    expect(read.ok && read.addOns.interval).toBe('year');
    expect(read.ok && read.addOns.tiers.map((t) => t.units)).toEqual([1000]);
  });

  it('shows a yearly plan’s prices in its trial too, and monthly when Stripe can’t say', async () => {
    org().subscription_status = 'trialing';
    stripeApi.retrieve.mockResolvedValue(subscription([planItem('year')], { status: 'trialing' }));
    let read = await readPlanAddOns();
    expect(read.ok && [read.addOns.state, read.addOns.interval]).toEqual(['trial', 'year']);
    stripeApi.retrieve.mockRejectedValue(new Error('down'));
    read = await readPlanAddOns();
    expect(read.ok && [read.addOns.state, read.addOns.interval]).toEqual(['trial', 'month']);
  });

  it('says why it can’t be bought', async () => {
    const stateOf = async () => {
      const read = await readPlanAddOns();
      return read.ok ? read.addOns.state : read.failure;
    };
    auth.user = { id: 'u_manager' };
    await expect(stateOf()).resolves.toBe('not_admin');
    auth.user = { id: 'u_admin' };
    org().cancel_at_period_end = true;
    await expect(stateOf()).resolves.toBe('ending');
    org().subscription_status = 'trialing';
    await expect(stateOf()).resolves.toBe('trial');
    org().subscription_status = 'past_due';
    await expect(stateOf()).resolves.toBe('no_plan');
    org().plan = 'starter';
    await expect(stateOf()).resolves.toBe('starter');
    org().plan = 'enterprise';
    await expect(stateOf()).resolves.toBe('enterprise');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await expect(stateOf()).resolves.toBe('not_cloud');
  });
});

describe('tracking slots (00564)', () => {
  const slotRow = (platform: string, cents: number, billing: 'monthly' | 'yearly' = 'monthly') => {
    const stripeId = platform.replace(/-/g, '_');
    const suffix = billing === 'monthly' ? 'month' : 'year';
    return {
      id: `slots_${stripeId}_${suffix}`,
      kind: 'slots',
      price_cents: billing === 'monthly' ? cents : cents * 10,
      currency: 'usd',
      billing,
      grant_prompts: null,
      grant_brands: null,
      platform,
      grant_slots: 100,
      stripe_price_id: `price_slots_${stripeId}_${suffix}`,
      stripe_lookup_key: `addon_slots_${stripeId}_${suffix}`,
      sale: 'self_serve',
      plans: ['growth', 'enterprise'],
      active: true,
    };
  };
  const slotItem = (platform: string, units: number) => {
    const stripeId = platform.replace(/-/g, '_');
    return {
      id: `si_slots_${stripeId}`,
      quantity: units,
      price: {
        id: `price_slots_${stripeId}_month`,
        lookup_key: `addon_slots_${stripeId}_month`,
        unit_amount: 6000,
        product: 'prod_slots',
        recurring: { interval: 'month' },
        metadata: { addon: 'slots', platform: stripeId },
      },
    };
  };

  beforeEach(() => {
    db.tables.add_on_products.push(
      slotRow('claude-web', 6000),
      slotRow('claude-web', 6000, 'yearly'),
      slotRow('naver-web', 1500, 'yearly'),
    );
    stripeApi.retrievePrice.mockResolvedValue({ id: 'price_x', product: 'prod_slots' });
    stripeApi.retrieveCoupon.mockRejectedValue(
      Object.assign(new Error('No such coupon'), { code: 'resource_missing' }),
    );
    stripeApi.createCoupon.mockImplementation(async (params: { id: string }) => params);
  });

  const sentItems = () =>
    (stripeApi.update.mock.calls[0][1] as { items: Record<string, unknown>[] }).items;

  it('prices slots per platform on the plan’s period, with no discount under $500', async () => {
    const preview = await previewAddOnChange({
      trackingUnits: 0,
      extraBrands: 0,
      slots: { 'claude-web': 3 },
    });
    expect(preview).toMatchObject({
      ok: true,
      changed: true,
      slots: { 'claude-web': 300, 'chatgpt-web': 250 },
      slotsPrice: { listCents: 18_000, percentOff: 0, discountCents: 0 },
      totalCents: 24_900 + 18_000,
    });
    const params = stripeApi.preview.mock.calls[0][0];
    expect(params.subscription_details.items).toEqual([
      { price: 'price_slots_claude_web_month', quantity: 3, discounts: '' },
    ]);
    expect(stripeApi.createCoupon).not.toHaveBeenCalled();
  });

  it('puts the marginal volume discount on the slot items as one shared coupon', async () => {
    // 20 × $60 = $1,200: 5% of $500 + 10% of $200 = $45, 3.75%.
    const preview = await previewAddOnChange({
      trackingUnits: 0,
      extraBrands: 0,
      slots: { 'claude-web': 20 },
    });
    expect(preview).toMatchObject({
      ok: true,
      slotsPrice: { listCents: 120_000, percentOff: 3.75, discountCents: 4_500 },
      totalCents: 24_900 + 120_000 - 4_500,
    });
    expect(stripeApi.createCoupon).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'addon_slots_off_0375',
        percent_off: 3.75,
        applies_to: { products: ['prod_slots'] },
      }),
    );
    expect(stripeApi.preview.mock.calls[0][0].subscription_details.items).toEqual([
      {
        price: 'price_slots_claude_web_month',
        quantity: 20,
        discounts: [{ coupon: 'addon_slots_off_0375' }],
      },
    ]);
  });

  it('keeps the plan’s coupon (SAVE50) on the plan alone', async () => {
    stripeApi.retrieve.mockResolvedValue(
      subscription([planItem()], {
        discounts: [discount('di_save50', { id: 'SAVE50', duration: 'forever', percent_off: 50 })],
      }),
    );
    const result = await applyAddOnChange({
      trackingUnits: 0,
      extraBrands: 0,
      slots: { 'claude-web': 20 },
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    const params = stripeApi.update.mock.calls[0][1];
    expect(params.discounts).toBe('');
    expect(sentItems()).toEqual([
      {
        price: 'price_slots_claude_web_month',
        quantity: 20,
        discounts: [{ coupon: 'addon_slots_off_0375' }],
      },
      { id: 'si_plan', discounts: [{ coupon: 'SAVE50' }] },
    ]);
  });

  it('writes the bought slots once applied', async () => {
    await applyAddOnChange({ trackingUnits: 0, extraBrands: 0, slots: { 'claude-web': 3 } });
    expect(org().add_on_slots).toEqual({ 'claude-web': 300 });
  });

  it('sells only the plan’s period: a monthly plan can’t buy yearly slots', async () => {
    expect(
      await previewAddOnChange({ trackingUnits: 0, extraBrands: 0, slots: { 'naver-web': 1 } }),
    ).toMatchObject({ ok: false, failure: 'unavailable' });
  });

  it('refuses a platform slots aren’t sold for', async () => {
    expect(
      await previewAddOnChange({ trackingUnits: 0, extraBrands: 0, slots: { 'deepseek-web': 1 } }),
    ).toMatchObject({ ok: false, failure: 'unavailable' });
  });

  it('lowers a platform’s slots under its use, saying how many locations will wait', async () => {
    org().add_on_slots = { 'claude-web': 300 };
    stripeApi.retrieve.mockResolvedValue(subscription([planItem(), slotItem('claude-web', 3)]));
    usage.slots = new Map([['claude-web', 250]]);
    expect(
      await previewAddOnChange({ trackingUnits: 0, extraBrands: 0, slots: { 'claude-web': 2 } }),
    ).toMatchObject({
      ok: true,
      slots: { 'claude-web': 200 },
      slotsWaiting: [{ platform: 'claude-web', inUse: 250, limit: 200 }],
    });
    usage.slots = new Map([['claude-web', 180]]);
    expect(
      await previewAddOnChange({ trackingUnits: 0, extraBrands: 0, slots: { 'claude-web': 2 } }),
    ).toMatchObject({ ok: true, slotsWaiting: [] });
  });

  it('sets the newest locations past the new slots waiting once paid', async () => {
    org().add_on_slots = { 'claude-web': 300 };
    stripeApi.retrieve.mockResolvedValue(subscription([planItem(), slotItem('claude-web', 3)]));
    await applyAddOnChange({ trackingUnits: 0, extraBrands: 0, slots: { 'claude-web': 2 } });
    expect(capacity.settleSlots).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ 'claude-web': 200, 'chatgpt-web': 250 }),
    );
  });

  it('keeps the slots it has when the cart doesn’t name them', async () => {
    org().add_on_slots = { 'claude-web': 300 };
    stripeApi.retrieve.mockResolvedValue(subscription([planItem(), slotItem('claude-web', 3)]));
    const preview = await previewAddOnChange({ trackingUnits: 0, extraBrands: 2 });
    expect(preview).toMatchObject({ ok: true, slots: { 'claude-web': 300 } });
    const items = stripeApi.preview.mock.calls[0][0].subscription_details.items;
    expect(items.some((i: { id?: string }) => i.id === 'si_slots_claude_web')).toBe(false);
  });

  it('lets Enterprise buy slots, extra brands and top-ups, not tracking tiers', async () => {
    org().plan = 'enterprise';
    expect(
      await previewAddOnChange({ trackingUnits: 0, extraBrands: 0, slots: { 'claude-web': 3 } }),
    ).toMatchObject({ ok: true, slots: { 'claude-web': 300 } });
    expect(
      await previewAddOnChange({ trackingUnits: 0, extraBrands: 1, slots: { 'claude-web': 3 } }),
    ).toMatchObject({ ok: true });
    expect(await previewAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 5 })).toMatchObject({
      ok: true,
      dueTodayCents: 3900,
    });
    expect(await previewAddOnChange({ trackingUnits: 100, extraBrands: 0 })).toMatchObject({
      ok: false,
      failure: 'not_growth',
      plan: 'enterprise',
    });
  });

  it('counts Enterprise’s brands on top of its contract’s limit', async () => {
    org().plan = 'enterprise';
    org().plan_overrides = { maxBrands: 10 };
    const preview = await previewAddOnChange({ trackingUnits: 0, extraBrands: 2 });
    expect(preview).toMatchObject({ ok: true, limits: { brands: 12 } });
    const params = stripeApi.preview.mock.calls[0][0];
    expect(params.subscription_details.items).toEqual([
      { price: 'price_brand_month', quantity: 2 },
    ]);
  });

  it('sells no extra brands to Enterprise with unlimited brands (00548)', async () => {
    org().plan = 'enterprise';
    org().plan_overrides = { maxBrands: -1, maxPrompts: -1 };
    expect(await previewAddOnChange({ trackingUnits: 0, extraBrands: 1 })).toMatchObject({
      ok: false,
      failure: 'unavailable',
    });
    expect(await applyAddOnChange({ trackingUnits: 0, extraBrands: 2 })).toMatchObject({
      ok: false,
      failure: 'unavailable',
    });
    expect(stripeApi.update).not.toHaveBeenCalled();
    // A top-up alone still sells; brands stay unlimited.
    expect(await previewAddOnChange({ trackingUnits: 0, extraBrands: 0, topUp: 5 })).toMatchObject({
      ok: true,
      limits: { brands: -1, prompts: -1 },
    });
  });

  it('lets unlimited Enterprise drop brands it bought before, never below use', async () => {
    org().plan = 'enterprise';
    org().plan_overrides = { maxBrands: -1, maxPrompts: -1 };
    stripeApi.retrieve.mockResolvedValue(
      subscription([planItem(), addOnItem('si_b', 'brand_month', 2)]),
    );
    usage.brands = 40;
    // Keeping them unchanged is no sale either.
    expect(await previewAddOnChange({ trackingUnits: 0, extraBrands: 2 })).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(await previewAddOnChange({ trackingUnits: 0, extraBrands: 3 })).toMatchObject({
      ok: false,
      failure: 'unavailable',
    });
    await expect(applyAddOnChange({ trackingUnits: 0, extraBrands: 0 })).resolves.toMatchObject({
      ok: true,
      changed: true,
      limits: { brands: -1 },
    });
    expect(stripeApi.update).toHaveBeenCalledTimes(1);
  });

  it('offers unlimited Enterprise no extra brands on Billing', async () => {
    org().plan = 'enterprise';
    org().plan_overrides = { maxBrands: -1, maxPrompts: -1 };
    const read = await readPlanAddOns();
    expect(read.ok && read.addOns).toMatchObject({
      state: 'enterprise',
      brandPriceCents: null,
      topUps: [{ multiplier: 5 }, { multiplier: 10 }, { multiplier: 20 }],
    });
  });

  it('shows Enterprise its brand price and top-ups, and no tiers', async () => {
    org().plan = 'enterprise';
    org().plan_overrides = { maxBrands: 10 };
    const read = await readPlanAddOns();
    expect(read.ok && read.addOns).toMatchObject({
      state: 'enterprise',
      buyState: 'open',
      brandPriceCents: 2500,
      topUps: [{ multiplier: 5 }, { multiplier: 10 }, { multiplier: 20 }],
      tiers: [],
      base: { brands: 10 },
    });
  });
  it('shows Billing the slots on sale on the plan’s period, with what is included, bought and used', async () => {
    org().add_on_slots = { 'claude-web': 300 };
    usage.slots = new Map([
      ['chatgpt-web', 120],
      ['claude-web', 280],
    ]);
    const read = await readPlanAddOns();
    expect(read.ok && read.addOns.slots).toEqual({
      state: 'open',
      // Only Claude is on sale monthly here; Naver is yearly only.
      platforms: [
        {
          id: 'claude-web',
          group: 'signed_in',
          unitCents: 6000,
          unitSlots: 100,
          included: 0,
          units: 3,
          inUse: 280,
        },
      ],
    });
  });

  it('shows Enterprise its slots, and Starter none', async () => {
    org().plan = 'enterprise';
    let read = await readPlanAddOns();
    expect(read.ok && [read.addOns.state, read.addOns.slots?.state]).toEqual([
      'enterprise',
      'open',
    ]);
    org().plan = 'starter';
    read = await readPlanAddOns();
    expect(read.ok && read.addOns.slots).toBeNull();
  });

  it('shows no slots while none is on sale', async () => {
    for (const r of db.tables.add_on_products) if (r.kind === 'slots') r.active = false;
    const read = await readPlanAddOns();
    expect(read.ok && read.addOns.slots).toBeNull();
  });
});
