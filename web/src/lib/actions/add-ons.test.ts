// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Buying a pack: Admins of a paid, active plan only, with Chat on; AI credits
 * open a Stripe Checkout in payment mode, storage joins the plan's
 * subscription as a monthly item. A pack with no Stripe price isn't sold.
 * Nothing here grants anything: the purchase waits for the webhook. Stripe
 * is mocked; nothing reaches it.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const auth = vi.hoisted(() => ({ user: { id: 'u_admin', email: 'a@example.com' } as unknown }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }) } }),
}));

const stripeApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  retrieveSubscription: vi.fn(),
  createItem: vi.fn(),
  createCustomer: vi.fn(),
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: stripeApi.createSession } },
    subscriptions: { retrieve: stripeApi.retrieveSubscription },
    subscriptionItems: { create: stripeApi.createItem },
    customers: { create: stripeApi.createCustomer },
  },
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { startAddOnPurchase } = await import('./add-ons');

const ORG = '11111111-1111-4111-8111-111111111111';

const pack = (id: string, kind: 'ai' | 'storage', price: string | null, over = {}) => ({
  id,
  kind,
  name: id,
  price_cents: kind === 'ai' ? 5000 : 500,
  currency: 'usd',
  billing: kind === 'ai' ? 'one_time' : 'monthly',
  grant_ai_usd: kind === 'ai' ? 25 : null,
  grant_bytes: kind === 'storage' ? 26843545600 : null,
  valid_months: kind === 'ai' ? 12 : null,
  stripe_price_id: price,
  active: true,
  highlight: false,
  sort: 1,
  ...over,
});

/** The plan's subscription, billed monthly unless said otherwise. */
const subscription = (interval = 'month') => ({
  id: 'sub_1',
  items: {
    data: [{ id: 'si_plan', metadata: {}, price: { id: 'price_growth', recurring: { interval } } }],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
  // A deployment with Stripe (the mock above); add-ons-without-stripe.test.ts has none.
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  auth.user = { id: 'u_admin', email: 'a@example.com' };
  db.failures = {};
  db.log = [];
  db.unique = {};
  db.defaults = {};
  db.tables = {
    profiles: [
      { id: 'u_admin', organization_id: ORG, role: 'admin' },
      { id: 'u_manager', organization_id: ORG, role: 'manager' },
    ],
    organizations: [
      {
        id: ORG,
        subscription_status: 'active',
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
      },
    ],
    add_on_products: [
      pack('ai_50', 'ai', 'price_ai50'),
      pack('ai_10', 'ai', null),
      pack('storage_25', 'storage', 'price_st25'),
      pack('storage_100', 'storage', 'price_st100', { active: false }),
    ],
    add_on_purchases: [],
  };
  stripeApi.createSession.mockResolvedValue({
    id: 'cs_test_1',
    url: 'https://checkout.stripe.com/c/1',
  });
  stripeApi.retrieveSubscription.mockResolvedValue(subscription());
  stripeApi.createItem.mockResolvedValue({ id: 'si_pack' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const purchases = () => db.tables.add_on_purchases;
const stripeCalled = () =>
  [stripeApi.createSession, stripeApi.createItem, stripeApi.createCustomer].some(
    (fn) => fn.mock.calls.length > 0,
  );

describe('AI credits', () => {
  it('open a Stripe Checkout in payment mode, the purchase waiting for the webhook', async () => {
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({
      ok: true,
      next: 'checkout',
      url: 'https://checkout.stripe.com/c/1',
    });

    expect(purchases()).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        product_id: 'ai_50',
        bought_by: 'u_admin',
        status: 'pending',
        stripe_checkout_session_id: 'cs_test_1',
      }),
    ]);
    const id = purchases()[0].id;
    const metadata = { add_on_purchase_id: id, organization_id: ORG, product_id: 'ai_50' };
    const [params, options] = stripeApi.createSession.mock.calls[0];
    expect(params).toMatchObject({
      mode: 'payment',
      customer: 'cus_1',
      line_items: [{ price: 'price_ai50', quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      invoice_creation: { enabled: true, invoice_data: { metadata } },
      success_url: 'https://app.example.com/dashboard/settings/billing?add_on=paid#add-ons',
      cancel_url: 'https://app.example.com/dashboard/settings/billing#add-ons',
    });
    expect(options).toEqual({ idempotencyKey: `add-on-${id}` });
    // Nothing granted here.
    expect(db.tables.ai_credit_grants ?? []).toEqual([]);
  });
});

describe('storage', () => {
  it('joins the plan’s subscription as a monthly item, invoiced at once for this period', async () => {
    await expect(startAddOnPurchase('storage_25')).resolves.toEqual({ ok: true, next: 'added' });

    const id = purchases()[0].id;
    expect(stripeApi.createItem).toHaveBeenCalledWith(
      {
        subscription: 'sub_1',
        price: 'price_st25',
        quantity: 1,
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        metadata: { add_on_purchase_id: id, organization_id: ORG, product_id: 'storage_25' },
      },
      { idempotencyKey: `add-on-${id}` },
    );
    expect(purchases()[0]).toMatchObject({
      status: 'pending',
      stripe_subscription_item_id: 'si_pack',
    });
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('fails with Stripe’s words when the card on file is declined, and nothing is added', async () => {
    stripeApi.createItem.mockRejectedValue(
      Object.assign(new Error('Your card was declined.'), {
        type: 'StripeCardError',
        statusCode: 402,
      }),
    );
    await expect(startAddOnPurchase('storage_25')).resolves.toEqual({
      ok: false,
      failure: 'payment_failed',
      message: 'Your card was declined.',
    });
    expect(purchases()[0].status).toBe('failed');
  });

  it('isn’t sold on a plan billed yearly: a monthly item can’t join it', async () => {
    stripeApi.retrieveSubscription.mockResolvedValue(subscription('year'));
    await expect(startAddOnPurchase('storage_25')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    expect(purchases()).toEqual([]);
    expect(stripeApi.createItem).not.toHaveBeenCalled();
  });

  it('leaves the purchase pending when Stripe didn’t answer: the webhook settles it', async () => {
    stripeApi.createItem.mockRejectedValue(new Error('socket hang up'));
    await expect(startAddOnPurchase('storage_25')).resolves.toEqual({
      ok: false,
      failure: 'failed',
    });
    expect(purchases()[0].status).toBe('pending');
  });
});

describe('is refused', () => {
  it('for a pack without a Stripe price, or switched off: it isn’t sold', async () => {
    await expect(startAddOnPurchase('ai_10')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    await expect(startAddOnPurchase('storage_100')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    await expect(startAddOnPurchase('nope')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    expect(purchases()).toEqual([]);
    expect(stripeCalled()).toBe(false);
  });

  it('to everyone but Admins', async () => {
    auth.user = { id: 'u_manager', email: 'm@example.com' };
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({
      ok: false,
      failure: 'admin_only',
    });
    expect(purchases()).toEqual([]);
    expect(stripeCalled()).toBe(false);
  });

  it('in the free trial, and without an active plan', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'trial' });
    db.tables.organizations[0].subscription_status = 'past_due';
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'no_plan' });
    expect(stripeCalled()).toBe(false);
  });

  it('while Chat is off for the workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'chat_off' });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '22222222-2222-4222-8222-222222222222');
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'chat_off' });
    expect(stripeCalled()).toBe(false);
  });

  it('without throwing when the database fails', async () => {
    db.failures = { add_on_purchases: { message: 'down' } };
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'failed' });
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });
});
