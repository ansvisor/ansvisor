// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The web app's own writes on a read-only workspace (Ansvisor Cloud, plan not
 * active): assertWritable reads the signed-in person's organization and
 * refuses unless its plan is active; setup's writes stay open to an
 * organization that never subscribed; a plan it can't read refuses too.
 * Self-hosted reads nothing.
 */

let user: { id: string } | null;
let profile: { organization_id: string | null } | null;
let profileError: { message: string } | null;
let org: { subscription_status: string | null; stripe_subscription_id: string | null } | null;
let orgError: { message: string } | null;
let reads: string[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      reads.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () =>
          table === 'profiles'
            ? { data: profile, error: profileError }
            : { data: org, error: orgError },
      };
      return query;
    },
  })),
}));

const { assertWritable, SubscriptionInactiveError, writeRefusal } =
  await import('./subscription-guard');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  user = { id: 'user-1' };
  profile = { organization_id: 'org-1' };
  profileError = null;
  org = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
  orgError = null;
  reads = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('assertWritable', () => {
  it('lets an active or trialing plan write', async () => {
    for (const status of ['active', 'trialing']) {
      org = { subscription_status: status, stripe_subscription_id: 'sub_1' };
      await expect(assertWritable()).resolves.toBeUndefined();
    }
  });

  it('refuses a plan that ended, a failed payment and an unfinished first payment', async () => {
    for (const status of ['canceled', 'past_due', 'unpaid', 'incomplete_expired', null]) {
      org = { subscription_status: status, stripe_subscription_id: 'sub_1' };
      await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
      // An ended plan's setup writes are refused too.
      await expect(assertWritable({ onboarding: true })).rejects.toBeInstanceOf(
        SubscriptionInactiveError,
      );
    }
  });

  it("opens setup's writes to an organization that never subscribed, and only those", async () => {
    org = { subscription_status: null, stripe_subscription_id: null };
    await expect(assertWritable({ onboarding: true })).resolves.toBeUndefined();
    await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
  });

  it('opens setup to a person with no organization yet', async () => {
    profile = { organization_id: null };
    await expect(assertWritable({ onboarding: true })).resolves.toBeUndefined();
    await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
    expect(reads).not.toContain('organizations');
  });

  it("refuses when the plan can't be read, without calling it read-only", async () => {
    profileError = { message: 'connection reset' };
    const profileFailure = await assertWritable().catch((err: unknown) => err);
    expect(profileFailure).toBeInstanceOf(Error);
    expect(profileFailure).not.toBeInstanceOf(SubscriptionInactiveError);
    expect((profileFailure as Error).message).toContain('connection reset');

    profileError = null;
    orgError = { message: 'timeout' };
    const orgFailure = await assertWritable({ onboarding: true }).catch((err: unknown) => err);
    expect(orgFailure).toBeInstanceOf(Error);
    expect(orgFailure).not.toBeInstanceOf(SubscriptionInactiveError);
  });

  it('refuses a missing profile or organization, and no one signed in', async () => {
    profile = null;
    await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
    profile = { organization_id: 'org-1' };
    org = null;
    await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
    user = null;
    await expect(assertWritable()).rejects.toThrow('Unauthorized');
  });

  it('never gates self-hosted, and reads nothing there', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    user = null;
    await expect(assertWritable()).resolves.toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("carries the code as its digest, which production keeps of a server action's error", () => {
    const err = new SubscriptionInactiveError();
    expect(err.digest).toBe('subscription_inactive');
    expect(err.code).toBe('subscription_inactive');
  });
});

describe('writeRefusal', () => {
  it('lets an active plan through', async () => {
    org = { subscription_status: 'active', stripe_subscription_id: 'sub_1' };
    expect(await writeRefusal()).toBeNull();
  });

  it('answers 402 subscription_inactive while read-only', async () => {
    const res = await writeRefusal();
    expect(res?.status).toBe(402);
    expect(await res?.json()).toMatchObject({
      error: 'plan_limit',
      code: 'subscription_inactive',
    });
  });

  it("answers 500 when the plan can't be read", async () => {
    orgError = { message: 'timeout' };
    const res = await writeRefusal();
    expect(res?.status).toBe(500);
  });
});
