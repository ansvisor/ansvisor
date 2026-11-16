import { describe, expect, it } from 'vitest';
import {
  canManagePlan,
  canSetUpBrand,
  isSetupDeferred,
  isSetupDeferredValue,
  needsSetupAfterPurchase,
  ownBrandCount,
  SETUP_DEFERRED_COOKIE,
  setupDeferredCookie,
  setupFlowProps,
  setupLanding,
} from './setup-after-purchase';

/**
 * Setup after purchase: who goes through onboarding's setup steps with a plan
 * active already. Only on the cloud, with the plan active or trialing, no
 * brand of the organization's own at all (a paused one counts, the demo brand
 * doesn't), for someone who can create a brand.
 */

const STATUSES = ['active', 'trialing', 'incomplete', 'canceled', null] as const;
const OWN = {
  none: [],
  active: [{ isDemo: false, isActive: true }],
  paused: [{ isDemo: false, isActive: false }],
} as const;
const DEMO = { yes: [{ isDemo: true, isActive: true }], no: [] } as const;
const ROLES = ['admin', 'manager', 'analyst', 'agency_partner'] as const;
const CLOUD = [true, false] as const;

const cases = STATUSES.flatMap((status) =>
  (Object.keys(OWN) as (keyof typeof OWN)[]).flatMap((own) =>
    (Object.keys(DEMO) as (keyof typeof DEMO)[]).flatMap((demo) =>
      ROLES.flatMap((role) => CLOUD.map((cloud) => ({ status, own, demo, role, cloud }))),
    ),
  ),
);

describe('needsSetupAfterPurchase', () => {
  it.each(cases)(
    'status $status, own brand $own, demo brand $demo, $role, cloud $cloud',
    ({ status, own, demo, role, cloud }) => {
      const brands = [...OWN[own], ...DEMO[demo]];
      const expected =
        cloud &&
        (status === 'active' || status === 'trialing') &&
        own === 'none' &&
        (role === 'admin' || role === 'manager');
      expect(
        needsSetupAfterPurchase({
          cloud,
          subscriptionStatus: status,
          role,
          ownBrands: ownBrandCount(brands),
        }),
      ).toBe(expected);
    },
  );

  it('sends an admin of a trialing organization with only the demo brand to setup', () => {
    expect(
      needsSetupAfterPurchase({
        cloud: true,
        subscriptionStatus: 'trialing',
        role: 'admin',
        ownBrands: ownBrandCount([{ isDemo: true }]),
      }),
    ).toBe(true);
  });

  it('decides nothing when the brands could not be counted', () => {
    expect(
      needsSetupAfterPurchase({
        cloud: true,
        subscriptionStatus: 'active',
        role: 'admin',
        ownBrands: null,
      }),
    ).toBe(false);
  });

  it('never sends someone without a role', () => {
    for (const role of [null, undefined, '']) {
      expect(
        needsSetupAfterPurchase({ cloud: true, subscriptionStatus: 'active', role, ownBrands: 0 }),
      ).toBe(false);
    }
  });
});

describe('setup put off ("Manage your plan")', () => {
  const due = { cloud: true, subscriptionStatus: 'trialing', ownBrands: 0 } as const;

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
  it("lands on the dashboard's home with the first run's job, as the Stripe return page", () => {
    expect(setupLanding('job 1')).toBe('/dashboard/action-center/today?jobId=job%201');
    expect(setupLanding(null)).toBe('/dashboard/action-center/today');
  });
});
