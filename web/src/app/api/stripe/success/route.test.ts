import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Back from Stripe Checkout: the organization gets its plan, status and
 * period end before the webhook lands, then the dashboard opens.
 */

const stripeApi = vi.hoisted(() => ({ retrieveSession: vi.fn(), retrieve: vi.fn() }));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { retrieve: stripeApi.retrieveSession } },
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
      // No brand yet: nothing to start tracking for.
      select: () => {
        const query = {
          eq: () => query,
          order: () => query,
          limit: () => query,
          single: async () => ({ data: null }),
        };
        return query;
      },
    }),
  },
}));

const align = vi.hoisted(() => vi.fn());
vi.mock('@/lib/plan-engines', () => ({ alignPromptsToPlanForOrg: align }));

const { GET } = await import('./route');

const back = () =>
  GET(new Request('http://localhost/api/stripe/success?session_id=cs_1') as unknown as NextRequest);

/** A Stripe subscription with one item, its period ending at `end` (seconds). */
const subscription = (end?: number) => ({
  id: 'sub1',
  status: 'trialing',
  metadata: { organization_id: 'org1', plan_id: 'starter' },
  items: { data: [end == null ? {} : { current_period_end: end }] },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  align.mockResolvedValue({ promptCount: 0, platforms: [], models: [] });
  db.eq.mockResolvedValue({ error: null });
});

describe('GET /api/stripe/success', () => {
  it('writes the period end with the plan, then opens the dashboard', async () => {
    stripeApi.retrieveSession.mockResolvedValue({
      payment_status: 'no_payment_required',
      status: 'complete',
      customer: 'cus1',
      subscription: subscription(1_800_000_000),
    });

    const res = await back();

    expect(stripeApi.retrieveSession).toHaveBeenCalledWith('cs_1', { expand: ['subscription'] });
    expect(db.update).toHaveBeenCalledWith({
      subscription_status: 'trialing',
      plan: 'starter',
      stripe_customer_id: 'cus1',
      stripe_subscription_id: 'sub1',
      subscription_ends_at: '2027-01-15T08:00:00.000Z',
    });
    expect(db.eq).toHaveBeenCalledWith('id', 'org1');
    expect(align).toHaveBeenCalledWith('org1', 'starter');
    expect(res.headers.get('location')).toMatch(/\/dashboard\/action-center\/actions$/);
  });

  it('reads an unexpanded subscription, and leaves the period end alone without one', async () => {
    stripeApi.retrieveSession.mockResolvedValue({
      payment_status: 'paid',
      status: 'complete',
      customer: 'cus1',
      subscription: 'sub1',
    });
    stripeApi.retrieve.mockResolvedValue(subscription());

    await back();

    expect(stripeApi.retrieve).toHaveBeenCalledWith('sub1');
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update.mock.calls[0][0]).not.toHaveProperty('subscription_ends_at');
  });
});
