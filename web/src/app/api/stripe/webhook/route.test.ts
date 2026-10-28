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

/** The demo brand's update: what it set, the filters it was made with, and its answer. */
const brands = vi.hoisted(() => ({
  update: vi.fn(),
  filters: [] as [string, string, unknown][],
  answer: { error: null } as { error: { message: string } | null },
}));
const db = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'brands') {
        return {
          update: (values: unknown) => {
            brands.update(values);
            const chain = {
              eq: (column: string, value: unknown) => {
                brands.filters.push(['eq', column, value]);
                return chain;
              },
              is: (column: string, value: unknown) => {
                brands.filters.push(['is', column, value]);
                return chain;
              },
              then: (resolve: (value: unknown) => unknown) => resolve(brands.answer),
            };
            return chain;
          },
        };
      }
      return {
        update: (values: unknown) => {
          db.update(values);
          return { eq: db.eq };
        },
        // The plan before an update, to tell a plan change.
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { id: 'org1', plan: 'starter' } }) }),
        }),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  align.mockResolvedValue({ promptCount: 0, platforms: [], models: [] });
  db.eq.mockResolvedValue({ error: null });
  brands.filters = [];
  brands.answer = { error: null };
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

describe('the demo brand after a purchase', () => {
  const checkout = () =>
    deliver('checkout.session.completed', { customer: 'cus1', subscription: 'sub1' });

  it('hides a shown demo brand when a subscription starts, trial included', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('trialing', 1_800_000_000));
    const res = await checkout();
    expect(res.status).toBe(200);
    expect(brands.update).toHaveBeenCalledTimes(1);
    const [values] = brands.update.mock.calls[0] as [{ demo_hidden_at: string }];
    expect(Date.parse(values.demo_hidden_at)).not.toBeNaN();
    // The organization's demo brand, only while it is shown: never deleted.
    expect(brands.filters).toEqual([
      ['eq', 'organization_id', 'org1'],
      ['eq', 'is_demo', true],
      ['is', 'demo_hidden_at', null],
    ]);
  });

  it('leaves it alone on a later update, so a demo brand shown again stays shown', async () => {
    await deliver('customer.subscription.updated', subscription('active', 1_800_000_000));
    await deliver('invoice.payment_succeeded', { customer: 'cus1' });
    expect(brands.update).not.toHaveBeenCalled();
  });

  it('hides nothing for a subscription whose first payment is still open', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('incomplete'));
    await checkout();
    expect(brands.update).not.toHaveBeenCalled();
  });

  it('answers Stripe as usual when the organization has no demo brand, or the write fails', async () => {
    stripeApi.retrieve.mockResolvedValue(subscription('active'));
    // No demo brand: the update matches no row.
    expect((await checkout()).status).toBe(200);
    brands.answer = { error: { message: 'timeout' } };
    const res = await checkout();
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ plan: 'growth' }));
    expect(align).toHaveBeenCalled();
  });
});
