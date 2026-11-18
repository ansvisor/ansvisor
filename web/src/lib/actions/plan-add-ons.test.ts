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

const usage = vi.hoisted(() => ({ prompts: 150, brands: 3 }));
vi.mock('@/lib/prompt-locations', () => ({
  getOrgLocationUsage: async () => ({ total: usage.prompts, byBrand: {} }),
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
    prices: { list: stripeApi.listPrices },
  },
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { SubscriptionInactiveError } = await import('@/lib/subscription-guard');
const { applyAddOnChange, previewAddOnChange } = await import('./plan-add-ons');

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
  plans: ['growth'],
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
      row('brand_month', 'brand', null),
      row('brand_year', 'brand', null),
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
      limits: { prompts: 1200, brands: 7 },
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
    ).resolves.toEqual({ ok: true, changed: true, limits: { prompts: 300, brands: 6 } });
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
      limits: { prompts: 300, brands: 4 },
    });
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('moves the subscription’s discount onto the plan’s item, so add-ons are charged in full', async () => {
    stripeApi.retrieve.mockResolvedValue(
      subscription([planItem()], { discounts: ['di_teknopark'] }),
    );
    await applyAddOnChange({ trackingUnits: 100, extraBrands: 0 });
    const params = stripeApi.update.mock.calls[0][1];
    expect(params.discounts).toBe('');
    expect(params.items).toEqual([
      { price: 'price_tracking_100_month' },
      { id: 'si_plan', discounts: [{ discount: 'di_teknopark' }] },
    ]);
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
      limits: { prompts: 300, brands: 6 },
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
