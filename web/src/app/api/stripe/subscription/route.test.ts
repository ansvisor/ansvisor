import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PATCH /api/stripe/subscription: buy a free trial now on any plan and
 * period (with the first-month code on a monthly plan), or change the plan or
 * billing period of a paid one. DELETE: cancel at the period's end. Both are
 * the admins'.
 */

let org: Record<string, unknown>;
let role: string;

/** A Supabase query that answers `single()` with the row given. */
const row = (data: unknown) => {
  const query = { select: () => query, eq: () => query, single: async () => ({ data }) };
  return query;
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => row(table === 'profiles' ? { organization_id: 'org1', role } : org),
  }),
}));

const db = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  catalog: [] as Record<string, unknown>[],
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      update: (values: unknown) => {
        db.update(values);
        return { eq: db.eq };
      },
      // Growth's add-on catalog (00546), read on a plan change.
      select: () => ({
        in: async () => ({ data: table === 'add_on_products' ? db.catalog : [], error: null }),
      }),
    }),
  },
}));

// The add-ons' sync after a change: its own module, tested on its own.
const sync = vi.hoisted(() => vi.fn());
vi.mock('@/lib/billing/add-on-sync', () => ({ syncAddOns: sync }));

const stripeApi = vi.hoisted(() => ({
  retrieve: vi.fn(),
  update: vi.fn(),
  listCodes: vi.fn(),
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    subscriptions: { retrieve: stripeApi.retrieve, update: stripeApi.update },
    promotionCodes: { list: stripeApi.listCodes },
  },
  priceIdFor: (planId: string, interval: string) =>
    planId === 'growth' && interval === 'year' && !process.env.GROWTH_ANNUAL_SET
      ? undefined
      : `price_${planId}_${interval}`,
}));

const align = vi.hoisted(() => vi.fn());
vi.mock('@/lib/plan-engines', () => ({ alignPromptsToPlanForOrg: align }));

const { DELETE, GET, PATCH } = await import('./route');

const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/stripe/subscription', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );

/** A Stripe subscription with one item, its period ending at `end` (seconds). */
const subscription = (status: string, interval = 'month', amount = 4900, end = 1_800_000_000) => ({
  id: 'sub1',
  status,
  cancel_at_period_end: false,
  metadata: {},
  items: {
    data: [
      {
        id: 'si1',
        current_period_end: end,
        price: { unit_amount: amount, recurring: { interval } },
      },
    ],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  delete process.env.GROWTH_ANNUAL_SET;
  org = { id: 'org1', plan: 'starter', stripe_subscription_id: 'sub1' };
  role = 'admin';
  align.mockResolvedValue({ promptCount: 0, platforms: [], models: [] });
  db.eq.mockResolvedValue({});
});

describe('buying a trial now', () => {
  it('ends the trial today on the plan asked for, with the first-month code', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing'));
    stripeApi.listCodes.mockResolvedValue({ data: [{ id: 'promo_save50' }] });
    // The trial ends today: Stripe starts the first period now, a month long.
    stripeApi.update.mockResolvedValue(subscription('active', 'month', 24900, 1_802_592_000));

    const res = await patch({
      buyNow: true,
      newPlanId: 'growth',
      interval: 'month',
      promoCode: 'SAVE50',
    });

    expect(res.status).toBe(200);
    expect(stripeApi.listCodes).toHaveBeenCalledWith({ code: 'SAVE50', active: true, limit: 1 });
    expect(stripeApi.update).toHaveBeenCalledWith('sub1', {
      items: [{ id: 'si1', price: 'price_growth_month' }],
      trial_end: 'now',
      cancel_at_period_end: false,
      proration_behavior: 'none',
      payment_behavior: 'error_if_incomplete',
      discounts: [{ promotion_code: 'promo_save50' }],
      metadata: { plan_id: 'growth', organization_id: 'org1' },
    });
    // With the new period's end, so the AI usage counts from today: the
    // trial's usage is left behind before the webhook comes. And resumed.
    expect(db.update).toHaveBeenCalledWith({
      plan: 'growth',
      subscription_status: 'active',
      subscription_ends_at: '2027-02-14T08:00:00.000Z',
      cancel_at_period_end: false,
    });
    expect(align).toHaveBeenCalledWith('org1', 'growth');
    expect(await res.json()).toMatchObject({
      planId: 'growth',
      status: 'active',
      priceAmount: 249,
      interval: 'month',
    });
  });

  it('buys a year without a code', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing'));
    stripeApi.update.mockResolvedValue(subscription('active', 'year', 47000));

    const res = await patch({ buyNow: true, interval: 'year', promoCode: 'SAVE50' });

    expect(res.status).toBe(200);
    expect(stripeApi.listCodes).not.toHaveBeenCalled();
    const params = stripeApi.update.mock.calls[0][1];
    expect(params.items).toEqual([{ id: 'si1', price: 'price_starter_year' }]);
    expect(params.discounts).toBeUndefined();
    // Same plan: its engines stay as they are.
    expect(align).not.toHaveBeenCalled();
  });

  it('resumes a trial canceled before it was bought, so the "plan ends" band goes at once', async () => {
    stripeApi.retrieve.mockResolvedValue({
      ...subscription('trialing'),
      cancel_at_period_end: true,
    });
    stripeApi.update.mockResolvedValue(subscription('active'));

    const res = await patch({ buyNow: true });

    expect(res.status).toBe(200);
    expect(stripeApi.update.mock.calls[0][1].cancel_at_period_end).toBe(false);
    expect(db.update.mock.calls[0][0]).toMatchObject({ cancel_at_period_end: false });
  });

  it('refuses an unknown code before charging anything', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing'));
    stripeApi.listCodes.mockResolvedValue({ data: [] });

    const res = await patch({ buyNow: true, promoCode: 'NOPE' });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_promo_code' });
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('reports a declined card and changes nothing', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing'));
    stripeApi.update.mockRejectedValue(new Error('Your card was declined.'));

    const res = await patch({ buyNow: true });

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: 'Your card was declined.',
      code: 'payment_failed',
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('buys without a discount when the code field is left empty', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing'));
    stripeApi.update.mockResolvedValue(subscription('active'));

    const res = await patch({ buyNow: true, promoCode: '' });

    expect(res.status).toBe(200);
    expect(stripeApi.listCodes).not.toHaveBeenCalled();
    expect(stripeApi.update.mock.calls[0][1].discounts).toBeUndefined();
  });

  it('leaves buying to admins, before anything is charged', async () => {
    for (const other of ['manager', 'analyst', 'agency_partner']) {
      role = other;
      const res = await patch({ buyNow: true, newPlanId: 'growth' });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'admin_only' });
    }
    expect(stripeApi.retrieve).not.toHaveBeenCalled();
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('is only for a trial', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));

    const res = await patch({ buyNow: true, newPlanId: 'growth' });

    expect(res.status).toBe(400);
    expect(stripeApi.update).not.toHaveBeenCalled();
  });
});

describe('changing a paid plan', () => {
  it('moves the current plan to annual billing, prorated', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));
    stripeApi.update.mockResolvedValue(subscription('active', 'year', 47000));

    const res = await patch({ interval: 'year' });

    expect(res.status).toBe(200);
    expect(stripeApi.update).toHaveBeenCalledWith('sub1', {
      items: [{ id: 'si1', price: 'price_starter_year' }],
      metadata: { plan_id: 'starter', organization_id: 'org1' },
      proration_behavior: 'create_prorations',
      payment_behavior: 'error_if_incomplete',
    });
    expect(await res.json()).toMatchObject({ planId: 'starter', interval: 'year' });
    // A period change leaves a cancellation as Stripe has it: not written here.
    expect(db.update.mock.calls[0][0]).not.toHaveProperty('cancel_at_period_end');
  });

  it('changes the plan’s item, never a storage pack’s beside it (CHAT-18)', async () => {
    const withPack = (sub: ReturnType<typeof subscription>) => ({
      ...sub,
      items: {
        data: [
          {
            id: 'si_pack',
            current_period_end: 1_800_000_000,
            metadata: { add_on_purchase_id: 'a0000000-0000-4000-8000-000000000001' },
            price: { unit_amount: 500, recurring: { interval: 'month' } },
          },
          ...sub.items.data,
        ],
      },
    });
    stripeApi.retrieve.mockResolvedValue(withPack(subscription('active')));
    stripeApi.update.mockResolvedValue(withPack(subscription('active', 'month', 24900)));

    const res = await patch({ newPlanId: 'growth', interval: 'month' });

    expect(res.status).toBe(200);
    expect(stripeApi.update.mock.calls[0][1].items).toEqual([
      { id: 'si1', price: 'price_growth_month' },
    ]);
    expect(await res.json()).toMatchObject({ planId: 'growth', priceAmount: 249 });
  });

  it('keeps the plan as it was when the new period’s invoice is declined', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));
    stripeApi.update.mockRejectedValue(new Error('Your card was declined.'));

    const res = await patch({ interval: 'year' });

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: 'Your card was declined.',
      code: 'payment_failed',
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('says so when an annual price is not set up in Stripe', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));

    const res = await patch({ newPlanId: 'growth', interval: 'year' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Price not configured' });
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('refuses the plan and period it already has, or a malformed request', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));

    expect((await patch({ newPlanId: 'starter', interval: 'month' })).status).toBe(400);
    expect((await patch({ newPlanId: 'enterprise' })).status).toBe(400);
    expect(stripeApi.update).not.toHaveBeenCalled();
  });
});

describe('cancelling', () => {
  it('cancels at the period’s end for an admin, and for no one else', async () => {
    org = { stripe_subscription_id: 'sub_1' };
    stripeApi.update.mockReset().mockResolvedValue({
      items: { data: [{ current_period_end: 1_800_000_000 }] },
    });
    for (const other of ['manager', 'analyst', 'agency_partner']) {
      role = other;
      const res = await DELETE();
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'admin_only' });
    }
    expect(stripeApi.update).not.toHaveBeenCalled();

    expect(db.update).not.toHaveBeenCalled();

    role = 'admin';
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(stripeApi.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    // Every page says when the plan ends at once, before the webhook (00386).
    expect(db.update).toHaveBeenCalledWith({
      cancel_at_period_end: true,
      subscription_ends_at: '2027-01-15T08:00:00.000Z',
    });
  });

  it('keeps the plan again, and the band goes at once', async () => {
    stripeApi.update.mockReset().mockResolvedValue(subscription('active'));
    const res = await patch({ reactivate: true });
    expect(res.status).toBe(200);
    expect(stripeApi.update).toHaveBeenCalledWith('sub1', { cancel_at_period_end: false });
    expect(db.update).toHaveBeenCalledWith({ cancel_at_period_end: false });
    expect(db.eq).toHaveBeenCalledWith('id', 'org1');
  });
});

describe('Growth add-ons through a plan change (00546)', () => {
  const addOnRow = (id: string, kind: string, billing: string, units: number | null) => ({
    id,
    kind,
    billing,
    active: true,
    price_cents: 100,
    currency: 'usd',
    grant_prompts: units,
    grant_brands: kind === 'brand' ? 1 : null,
    stripe_price_id: `price_${id}`,
    stripe_lookup_key: `addon_${id}`,
  });
  const withAddOns = (sub: ReturnType<typeof subscription>, interval = 'month') => ({
    ...sub,
    items: {
      data: [
        ...sub.items.data,
        {
          id: 'si_t',
          current_period_end: 1_800_000_000,
          metadata: {},
          price: {
            id: `price_tracking_100_${interval}`,
            lookup_key: `addon_tracking_100_${interval}`,
            metadata: { addon: 'tracking' },
            recurring: { interval },
          },
        },
        {
          id: 'si_b',
          quantity: 2,
          current_period_end: 1_800_000_000,
          metadata: {},
          price: {
            id: `price_brand_${interval}`,
            lookup_key: `addon_brand_${interval}`,
            metadata: { addon: 'brand' },
            recurring: { interval },
          },
        },
      ],
    },
  });

  beforeEach(() => {
    org.plan = 'growth';
    sync.mockResolvedValue(undefined);
    db.catalog = [
      addOnRow('tracking_100_month', 'tracking', 'monthly', 100),
      addOnRow('tracking_100_year', 'tracking', 'yearly', 100),
      addOnRow('brand_month', 'brand', 'monthly', null),
      addOnRow('brand_year', 'brand', 'yearly', null),
    ];
  });

  it('move to the new period’s prices in the same update, then sync', async () => {
    process.env.GROWTH_ANNUAL_SET = '1';
    stripeApi.retrieve.mockResolvedValue(withAddOns(subscription('active', 'month', 24900)));
    stripeApi.update.mockResolvedValue(withAddOns(subscription('active', 'year', 239000), 'year'));
    const res = await patch({ interval: 'year' });
    delete process.env.GROWTH_ANNUAL_SET;
    expect(res.status).toBe(200);
    expect(stripeApi.update.mock.calls[0][1].items).toEqual([
      { id: 'si1', price: 'price_growth_year' },
      { id: 'si_t', price: 'price_tracking_100_year' },
      { id: 'si_b', price: 'price_brand_year' },
    ]);
    expect(sync).toHaveBeenCalledWith('sub1');
  });

  it('end with Growth: removed on Starter, their unused time credited', async () => {
    stripeApi.retrieve.mockResolvedValue(withAddOns(subscription('active', 'month', 24900)));
    stripeApi.update.mockResolvedValue(subscription('active', 'month', 4900));
    const res = await patch({ newPlanId: 'starter', interval: 'month' });
    expect(res.status).toBe(200);
    expect(stripeApi.update.mock.calls[0][1]).toMatchObject({
      items: [
        { id: 'si1', price: 'price_starter_month' },
        { id: 'si_t', deleted: true },
        { id: 'si_b', deleted: true },
      ],
      proration_behavior: 'create_prorations',
    });
  });

  it('stop the change, before any charge, when one has no price on the new period', async () => {
    process.env.GROWTH_ANNUAL_SET = '1';
    db.catalog = db.catalog.filter((r) => r.id !== 'tracking_100_year');
    stripeApi.retrieve.mockResolvedValue(withAddOns(subscription('active', 'month', 24900)));
    const res = await patch({ interval: 'year' });
    delete process.env.GROWTH_ANNUAL_SET;
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'add_ons_unavailable' });
    expect(stripeApi.update).not.toHaveBeenCalled();
  });

  it('are shown by GET, for the plan switcher to say what a change does', async () => {
    org.add_on_prompts = 1000;
    org.add_on_brands = 3;
    stripeApi.retrieve.mockResolvedValue(subscription('active', 'month', 24900));
    const res = await GET();
    expect(await res.json()).toMatchObject({ addOns: { prompts: 1000, brands: 3 } });
  });
});
