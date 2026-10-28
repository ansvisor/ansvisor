import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/stripe/checkout: a Stripe Checkout for a new subscription, from
 * onboarding's plan step (monthly, back to the step on cancel) or from
 * Billing once a plan has ended (either period, back to Billing on cancel).
 * Admins only, and never beside a subscription that is still there.
 */

let role: string;
let org: Record<string, unknown>;

/** A Supabase query that answers `single()` with the row given. */
const row = (data: unknown) => {
  const query = { select: () => query, eq: () => query, single: async () => ({ data }) };
  return query;
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@example.com' } } }) },
    from: (table: string) => row(table === 'profiles' ? { organization_id: 'org1', role } : org),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: vi.fn() } }));

const stripeApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSubscriptions: vi.fn(),
  annual: true,
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: stripeApi.createSession } },
    subscriptions: { list: stripeApi.listSubscriptions },
    customers: { create: vi.fn() },
  },
  PRICE_IDS: {},
  priceIdFor: (planId: string, interval: string) =>
    interval === 'year' && !stripeApi.annual ? undefined : `price_${planId}_${interval}`,
}));

const { POST } = await import('./route');

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );

/** What Checkout was asked for. */
const session = () => stripeApi.createSession.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  // A plan that ended: Billing starts a new one.
  org = {
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_old',
    subscription_status: 'canceled',
  };
  stripeApi.annual = true;
  stripeApi.createSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/1' });
  // A customer who had a subscription before: no second trial.
  stripeApi.listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_old' }] });
});

describe('POST /api/stripe/checkout', () => {
  it("bills monthly and returns to onboarding's plan step by default", async () => {
    const res = await post({ planId: 'starter', organizationId: 'org1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/1' });
    expect(session().line_items).toEqual([{ price: 'price_starter_month', quantity: 1 }]);
    expect(session().cancel_url).toBe('http://localhost:3000/dashboard/onboarding');
    expect(session().subscription_data.trial_period_days).toBeUndefined();
  });

  it('bills a year up front and returns to Billing, for a plan chosen there', async () => {
    const res = await post({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'year',
      returnTo: 'billing',
    });
    expect(res.status).toBe(200);
    expect(session().line_items).toEqual([{ price: 'price_growth_year', quantity: 1 }]);
    expect(session().cancel_url).toBe('http://localhost:3000/dashboard/settings/billing');
    expect(session().subscription_data.metadata).toEqual({
      organization_id: 'org1',
      plan_id: 'growth',
    });
  });

  it('starts a new account’s first subscription, with no subscription yet', async () => {
    // A customer from an earlier Checkout that was left, and no subscription.
    org = {
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: null,
      subscription_status: 'incomplete',
    };
    stripeApi.listSubscriptions.mockResolvedValue({ data: [] });
    const res = await post({ planId: 'starter', organizationId: 'org1' });
    expect(res.status).toBe(200);
  });

  it("refuses another organization's checkout", async () => {
    const res = await post({ planId: 'starter', organizationId: 'org2' });
    expect(res.status).toBe(403);
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('leaves buying a plan to admins', async () => {
    role = 'manager';
    const res = await post({ planId: 'starter', organizationId: 'org1' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Only admins can change the plan',
      code: 'admin_only',
    });
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('starts no second subscription beside one still there', async () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid']) {
      org = { ...org, subscription_status: status };
      const res = await post({ planId: 'growth', organizationId: 'org1', returnTo: 'billing' });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'subscription_exists' });
    }
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('refuses a period or a return it does not know', async () => {
    expect(
      (await post({ planId: 'growth', organizationId: 'org1', interval: 'week' })).status,
    ).toBe(400);
    expect(
      (await post({ planId: 'growth', organizationId: 'org1', returnTo: 'https://evil.example' }))
        .status,
    ).toBe(400);
    expect((await post({ planId: 'enterprise', organizationId: 'org1' })).status).toBe(400);
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('refuses a year when its price is not set up', async () => {
    stripeApi.annual = false;
    const res = await post({ planId: 'growth', organizationId: 'org1', interval: 'year' });
    expect(res.status).toBe(400);
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });
});
