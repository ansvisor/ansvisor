import { describe, expect, it, vi } from 'vitest';

import { evaluateSubscriptionAccess } from './subscription-access';

// Minimal Supabase stub: the chained query builder resolves to `ownerRow` at
// `.maybeSingle()`. Only the blocked (non-admin, inactive) path touches it.
function fakeSupabase(ownerRow: { full_name: string | null } | null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: ownerRow, error: null }),
  };
  const from = vi.fn(() => builder);
  // Cast through unknown — the helper only uses .from(...).select()....maybeSingle().
  return { client: { from } as unknown as Parameters<typeof evaluateSubscriptionAccess>[0], from };
}

describe('evaluateSubscriptionAccess', () => {
  it('returns ok for active/trialing regardless of role (no owner lookup)', async () => {
    const { client, from } = fakeSupabase(null);
    expect(await evaluateSubscriptionAccess(client, 'org', 'analyst', 'active')).toEqual({
      state: 'ok',
    });
    expect(await evaluateSubscriptionAccess(client, 'org', 'admin', 'trialing')).toEqual({
      state: 'ok',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('routes admins to the payment flow when the subscription is inactive', async () => {
    const { client, from } = fakeSupabase(null);
    expect(await evaluateSubscriptionAccess(client, 'org', 'admin', 'past_due')).toEqual({
      state: 'needs_payment',
    });
    expect(await evaluateSubscriptionAccess(client, 'org', 'admin', null)).toEqual({
      state: 'needs_payment',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('blocks non-admins when inactive and surfaces the owner name', async () => {
    const { client } = fakeSupabase({ full_name: 'Jane Owner' });
    expect(await evaluateSubscriptionAccess(client, 'org', 'manager', 'canceled')).toEqual({
      state: 'blocked',
      ownerName: 'Jane Owner',
    });
  });

  it('falls back to a null owner name when the lookup returns nothing', async () => {
    const { client } = fakeSupabase(null);
    expect(await evaluateSubscriptionAccess(client, 'org', 'analyst', null)).toEqual({
      state: 'blocked',
      ownerName: null,
    });
  });
});
