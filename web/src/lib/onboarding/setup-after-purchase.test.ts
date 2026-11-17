import { describe, expect, it } from 'vitest';
import {
  canManagePlan,
  canSetUpBrand,
  isSetupDeferred,
  isSetupDeferredValue,
  needsSetupAfterPurchase,
  ownBrandCount,
  planLapsed,
  readSetupProgress,
  SETUP_DEFERRED_COOKIE,
  setupAfterPurchaseMayOpen,
  setupDeferredCookie,
  setupFlowProps,
  setupLanding,
  type SetupProgress,
} from './setup-after-purchase';

/**
 * Setup after purchase: who goes through onboarding's setup steps with a plan
 * active already. Only on the cloud, with the plan active or trialing, for
 * someone who can create a brand, when the organization's data says setup is
 * due (no brand of its own at all: a paused one counts, the demo brand
 * doesn't) or was left part-way (its one brand with no competitor and never
 * tracked). Never from onboarding_completed.
 */

const STATUSES = ['active', 'trialing', 'incomplete', 'canceled', 'past_due', null] as const;
const ROLES = ['admin', 'manager', 'analyst', 'agency_partner'] as const;
const CLOUD = [true, false] as const;

const PROGRESS: SetupProgress[] = ['due', 'unfinished', null];
const progressCases = STATUSES.flatMap((status) =>
  PROGRESS.flatMap((progress) =>
    ROLES.flatMap((role) => CLOUD.map((cloud) => ({ status, progress, role, cloud }))),
  ),
);

describe('needsSetupAfterPurchase', () => {
  it.each(progressCases)(
    'status $status, setup $progress, $role, cloud $cloud',
    ({ status, progress, role, cloud }) => {
      const expected =
        cloud &&
        (status === 'active' || status === 'trialing') &&
        progress !== null &&
        (role === 'admin' || role === 'manager');
      expect(needsSetupAfterPurchase({ cloud, subscriptionStatus: status, role, progress })).toBe(
        expected,
      );
      // The gate alone, before anything is read: the same, whatever the data.
      expect(setupAfterPurchaseMayOpen({ cloud, subscriptionStatus: status, role })).toBe(
        cloud && (status === 'active' || status === 'trialing') && canSetUpBrand(role),
      );
    },
  );

  it.each(['past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'])(
    'never opens setup with a plan %s, due or unfinished: the dashboard opens read-only',
    (status) => {
      for (const progress of ['due', 'unfinished'] as const) {
        expect(
          needsSetupAfterPurchase({
            cloud: true,
            subscriptionStatus: status,
            role: 'admin',
            progress,
          }),
        ).toBe(false);
      }
    },
  );

  it('decides nothing when where setup stands could not be read', () => {
    expect(
      needsSetupAfterPurchase({
        cloud: true,
        subscriptionStatus: 'active',
        role: 'admin',
        progress: null,
      }),
    ).toBe(false);
  });

  it('never sends someone without a role', () => {
    for (const role of [null, undefined, '']) {
      expect(
        needsSetupAfterPurchase({
          cloud: true,
          subscriptionStatus: 'active',
          role,
          progress: 'due',
        }),
      ).toBe(false);
    }
  });
});

describe('planLapsed', () => {
  it.each([
    ['past_due', true],
    ['unpaid', true],
    ['canceled', true],
    ['incomplete', true],
    ['incomplete_expired', true],
    ['paused', true],
    [null, true],
    ['active', false],
    ['trialing', false],
  ] as const)('a plan %s after a subscription: %s', (status, lapsed) => {
    expect(planLapsed({ cloud: true, subscriptionStatus: status, everSubscribed: true })).toBe(
      lapsed,
    );
  });

  it('is never a workspace that never had a subscription (the plan step or the choice), nor self-hosted', () => {
    for (const status of ['incomplete', 'canceled', null]) {
      expect(planLapsed({ cloud: true, subscriptionStatus: status, everSubscribed: false })).toBe(
        false,
      );
      expect(planLapsed({ cloud: false, subscriptionStatus: status, everSubscribed: true })).toBe(
        false,
      );
    }
  });
});

describe('readSetupProgress', () => {
  /** The rows each read finds, or its error; and the reads made, in order. */
  function reader({
    brands = [] as { id: string; is_active?: boolean }[],
    brandsError = null as unknown,
    competitors = [] as unknown[],
    competitorsError = null as unknown,
    runs = [] as unknown[],
    runsError = null as unknown,
    count = 0 as number | null,
  } = {}) {
    const reads: string[] = [];
    const rows: Record<string, { data: unknown[] | null; error: unknown }> = {
      brands: { data: brandsError ? null : brands, error: brandsError },
      competitors: { data: competitorsError ? null : competitors, error: competitorsError },
      tracking_runs: { data: runsError ? null : runs, error: runsError },
    };
    const client = {
      rpc: async (fn: string) => {
        reads.push(fn);
        return count === null
          ? { data: null, error: { code: '57014', message: 'statement timeout' } }
          : { data: count, error: null };
      },
      from: (table: string) => {
        reads.push(table);
        const query = {
          select: () => query,
          eq: () => query,
          limit: () => query,
          then: (resolve: (value: unknown) => unknown) => resolve(rows[table]),
        };
        return query;
      },
    };
    return { client: client as unknown as Parameters<typeof readSetupProgress>[0], reads };
  }

  it('is due with no brand of its own in sight and none in the organization', async () => {
    const { client, reads } = reader({ count: 0 });
    expect(await readSetupProgress(client, 'org1', [{ id: 'demo', isDemo: true }])).toBe('due');
    expect(reads).toEqual(['org_brand_count']);
  });

  it("is nothing when the organization has brands this person doesn't see", async () => {
    const { client } = reader({ count: 2 });
    expect(await readSetupProgress(client, 'org1', [])).toBeNull();
  });

  it('stops at the competitors for an established brand: one read', async () => {
    const { client, reads } = reader({ competitors: [{ id: 'c1' }] });
    expect(await readSetupProgress(client, 'org1', [{ id: 'b1' }])).toBeNull();
    expect(reads).toEqual(['competitors']);
  });

  it('is nothing for a brand tracked already, even with no competitor left', async () => {
    const { client, reads } = reader({ runs: [{ id: 'r1' }] });
    expect(await readSetupProgress(client, 'org1', [{ id: 'b1' }])).toBeNull();
    expect(reads).toEqual(['competitors', 'tracking_runs']);
  });

  it("is unfinished for the organization's one brand, left before Finish and never tracked", async () => {
    const { client, reads } = reader({ count: 1 });
    expect(await readSetupProgress(client, 'org1', [{ id: 'b1' }, { id: 'd', isDemo: true }])).toBe(
      'unfinished',
    );
    expect(reads).toEqual(['competitors', 'tracking_runs', 'org_brand_count']);
  });

  it('is nothing for a new brand beside others this person does not see', async () => {
    const { client } = reader({ count: 2 });
    expect(await readSetupProgress(client, 'org1', [{ id: 'b1' }])).toBeNull();
  });

  it('is nothing with two brands of its own, or a paused one, with no read', async () => {
    const two = reader();
    expect(await readSetupProgress(two.client, 'org1', [{ id: 'b1' }, { id: 'b2' }])).toBeNull();
    expect(two.reads).toEqual([]);
    const paused = reader();
    expect(
      await readSetupProgress(paused.client, 'org1', [{ id: 'b1', isActive: false }]),
    ).toBeNull();
    expect(paused.reads).toEqual([]);
  });

  it('reads the brands this person sees when not handed them', async () => {
    const unfinished = reader({ brands: [{ id: 'b1', is_active: true }], count: 1 });
    expect(await readSetupProgress(unfinished.client, 'org1')).toBe('unfinished');
    expect(unfinished.reads[0]).toBe('brands');
    const due = reader({ brands: [], count: 0 });
    expect(await readSetupProgress(due.client, 'org1')).toBe('due');
  });

  it.each([
    ['the brands', { brandsError: { message: 'timeout' } }, undefined],
    ['the competitors', { competitorsError: { message: 'timeout' } }, [{ id: 'b1' }]],
    ['the runs', { runsError: { message: 'timeout' } }, [{ id: 'b1' }]],
    ['the count', { count: null }, [{ id: 'b1' }]],
    ['the count with none in sight', { count: null }, []],
  ] as const)('decides nothing when %s could not be read', async (_, given, brands) => {
    const { client } = reader(given);
    expect(await readSetupProgress(client, 'org1', brands)).toBeNull();
  });

  it('never throws', async () => {
    const client = {
      from: () => {
        throw new Error('offline');
      },
      rpc: () => {
        throw new Error('offline');
      },
    } as unknown as Parameters<typeof readSetupProgress>[0];
    expect(await readSetupProgress(client, 'org1')).toBeNull();
  });
});

describe('setup put off ("Manage your plan")', () => {
  const due = { cloud: true, subscriptionStatus: 'trialing', progress: 'due' } as const;

  it("lets an admin with the cookie open the dashboard; without it, setup's due", () => {
    expect(needsSetupAfterPurchase({ ...due, role: 'admin', deferred: true })).toBe(false);
    expect(needsSetupAfterPurchase({ ...due, role: 'admin', deferred: false })).toBe(true);
    expect(needsSetupAfterPurchase({ ...due, role: 'admin' })).toBe(true);
  });

  it('is for admins only, who manage the plan: a manager with the cookie still goes to setup', () => {
    expect(needsSetupAfterPurchase({ ...due, role: 'manager', deferred: true })).toBe(true);
  });

  it.each([
    ['an admin, plan trialing, cloud', 'admin', 'trialing', true, true],
    ['an admin, plan active, cloud', 'admin', 'active', true, true],
    ['an admin, plan canceled', 'admin', 'canceled', true, false],
    ['an admin, never subscribed', 'admin', null, true, false],
    ['an admin, self-hosted', 'admin', 'active', false, false],
    ['a manager', 'manager', 'active', true, false],
    ['an analyst', 'analyst', 'active', true, false],
  ] as const)('with the cookie, puts setup off for %s: %s', (_, role, status, cloud, expected) => {
    expect(isSetupDeferred({ cloud, subscriptionStatus: status, role, deferred: true })).toBe(
      expected,
    );
    // Never without the cookie.
    expect(isSetupDeferred({ cloud, subscriptionStatus: status, role, deferred: false })).toBe(
      false,
    );
  });

  it('writes a half-hour cookie for the whole app, and reads only its own value', () => {
    expect(SETUP_DEFERRED_COOKIE).toBe('ansvisor_setup_deferred');
    expect(setupDeferredCookie({ secure: false })).toBe(
      'ansvisor_setup_deferred=1; path=/; max-age=1800; SameSite=Lax',
    );
    expect(setupDeferredCookie({ secure: true })).toBe(
      'ansvisor_setup_deferred=1; path=/; max-age=1800; SameSite=Lax; Secure',
    );
    expect(isSetupDeferredValue('1')).toBe(true);
    for (const value of [undefined, null, '', '0', 'true']) {
      expect(isSetupDeferredValue(value)).toBe(false);
    }
  });
});

describe('canManagePlan', () => {
  it("is Billing's rule: admins only", () => {
    expect(ROLES.filter(canManagePlan)).toEqual(['admin']);
  });
});

describe('canSetUpBrand', () => {
  it('is for the roles that can create a brand: admins and managers', () => {
    expect(ROLES.filter(canSetUpBrand)).toEqual(['admin', 'manager']);
  });
});

describe('ownBrandCount', () => {
  it('counts every brand but the demo brand, a paused one too', () => {
    expect(ownBrandCount([])).toBe(0);
    expect(ownBrandCount([{ isDemo: true }])).toBe(0);
    expect(ownBrandCount([{ isDemo: false }, { isDemo: true }, {}])).toBe(2);
  });
});

describe('setupFlowProps', () => {
  it("adds the property in setup after purchase, and nothing to today's events", () => {
    expect(setupFlowProps(true)).toEqual({ setup_after_purchase: true });
    expect(setupFlowProps(false)).toEqual({});
  });
});

describe('setupLanding', () => {
  it("lands on /dashboard with the first run's job: it opens the person's home with it", () => {
    expect(setupLanding('job 1')).toBe('/dashboard?jobId=job%201');
    expect(setupLanding(null)).toBe('/dashboard');
  });
});
