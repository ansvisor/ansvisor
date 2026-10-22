import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    from: () => ({
      update: (values: unknown) => {
        db.update(values);
        return { eq: db.eq };
      },
      // The plan before an update, to tell a plan change.
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: 'org1', plan: 'starter' } }) }),
      }),
    }),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  align.mockResolvedValue({ promptCount: 0, platforms: [], models: [] });
  db.eq.mockResolvedValue({ error: null });
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
