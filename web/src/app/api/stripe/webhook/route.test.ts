import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Stripe webhook keeps the organization's plan, status and period end in
 * step with Stripe: from the checkout on, not only from the first update.
 */

const stripeApi = vi.hoisted(() => ({ constructEvent: vi.fn(), retrieve: vi.fn() }));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: stripeApi.constructEvent },
    subscriptions: { retrieve: stripeApi.retrieve },
  },
}));

const db = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      // The plan before an update, to tell a plan change; the organization's
      // first brand, for its first run.
      const row = table === 'brands' ? { id: 'brand1' } : { id: 'org1', plan: 'starter' };
      const query = {
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: row }),
      };
      return {
        update: (values: unknown) => {
          db.update(values);
          return { eq: db.eq };
        },
        select: () => query,
      };
    },
  },
}));

const align = vi.hoisted(() => vi.fn());
vi.mock('@/lib/plan-engines', () => ({ alignPromptsToPlanForOrg: align }));

const { POST } = await import('./route');

const deliver = (type: string, object: unknown) => {
  stripeApi.constructEvent.mockReturnValue({ type, data: { object } });
  return POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 'sig' },
    }) as unknown as NextRequest,
  );
};

/** A Stripe subscription with one item, its period ending at `end` (seconds). */
const subscription = (status: string, end?: number) => ({
  id: 'sub1',
  status,
  customer: 'cus1',
  metadata: { organization_id: 'org1', plan_id: 'growth' },
  items: { data: [end == null ? {} : { current_period_end: end }] },
});

// The API the first run is asked of.
const api = vi.fn();
const apiPaths = () => api.mock.calls.map(([url]) => new URL(String(url)).pathname);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  align.mockResolvedValue({ promptCount: 0, platforms: [], models: [] });
  db.eq.mockResolvedValue({ error: null });
  api.mockReset().mockImplementation(async () => Response.json({ jobId: 'job1', created: true }));
  vi.stubGlobal('fetch', api);
  vi.stubEnv('CRON_SECRET', 'secret');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('checkout.session.completed', () => {
  it('writes the period end with the plan, so a new trial has one', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing', 1_800_000_000));
    const res = await deliver('checkout.session.completed', {
      customer: 'cus1',
      subscription: 'sub1',
    });

    expect(res.status).toBe(200);
    expect(stripeApi.retrieve).toHaveBeenCalledWith('sub1');
    expect(db.update).toHaveBeenCalledWith({
      subscription_status: 'trialing',
      plan: 'growth',
      stripe_customer_id: 'cus1',
      stripe_subscription_id: 'sub1',
      subscription_ends_at: '2027-01-15T08:00:00.000Z',
    });
    expect(db.eq).toHaveBeenCalledWith('id', 'org1');
    expect(align).toHaveBeenCalledWith('org1', 'growth');
  });

  it('leaves the period end alone when Stripe gives none', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));
    await deliver('checkout.session.completed', { customer: 'cus1', subscription: 'sub1' });
    expect(db.update.mock.calls[0][0]).not.toHaveProperty('subscription_ends_at');
  });
});

/**
 * The first run starts from the webhook too, as the return page may never
 * load; the API keeps it to one run per checkout.
 */
describe('checkout.session.completed, the first run', () => {
  const checkout = { customer: 'cus1', subscription: 'sub1', created: 1_800_000_000 };

  it('starts the first run on its own, after the alignment, with when the checkout began', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing'));
    const res = await deliver('checkout.session.completed', checkout);

    expect(res.status).toBe(200);
    expect(apiPaths()).toEqual(['/api/internal/trigger-tracking', '/api/internal/analyze-volumes']);
    expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({
      brandId: 'brand1',
      since: '2027-01-15T08:00:00.000Z',
    });
    expect(align.mock.invocationCallOrder[0]).toBeLessThan(api.mock.invocationCallOrder[0]);
  });

  it('starts nothing for a subscription whose payment was not made', async () => {
    for (const status of ['incomplete', 'incomplete_expired']) {
      stripeApi.retrieve.mockResolvedValue(subscription(status));
      const res = await deliver('checkout.session.completed', checkout);
      expect(res.status).toBe(200);
    }
    expect(api).not.toHaveBeenCalled();
  });

  it('starts nothing when the organization could not be written', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));
    db.eq.mockResolvedValue({ error: { message: 'timeout' } });
    await deliver('checkout.session.completed', checkout);
    expect(api).not.toHaveBeenCalled();
  });

  it('still answers Stripe 200 when the API is down', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));
    api.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await deliver('checkout.session.completed', checkout);
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('starts nothing on a later update or a failed payment', async () => {
    await deliver('customer.subscription.updated', subscription('active'));
    await deliver('invoice.payment_failed', { customer: 'cus1' });
    expect(api).not.toHaveBeenCalled();
  });
});

describe('customer.subscription.updated', () => {
  it('still writes the new period end, and leaves it alone without one', async () => {
    await deliver('customer.subscription.updated', subscription('active', 1_800_000_000));
    expect(db.update).toHaveBeenCalledWith({
      subscription_status: 'active',
      subscription_ends_at: '2027-01-15T08:00:00.000Z',
      plan: 'growth',
    });
    expect(db.eq).toHaveBeenCalledWith('stripe_customer_id', 'cus1');

    db.update.mockClear();
    await deliver('customer.subscription.updated', subscription('past_due'));
    expect(db.update).toHaveBeenCalledWith({ subscription_status: 'past_due', plan: 'growth' });
  });
});
