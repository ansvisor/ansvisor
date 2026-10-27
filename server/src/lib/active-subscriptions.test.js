import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which organizations the nightly work may still run for (2026-10-27): on
 * the cloud, those with an active or trialing subscription; self-hosted,
 * every one, without a read.
 */

const reads = [];
let rows = {};
let failWith = null;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const read = { table };
      reads.push(read);
      const chain = {
        select: (columns) => {
          read.columns = columns;
          return chain;
        },
        in: (column, ids) => {
          read.in = [column, ids];
          return chain;
        },
        then: (resolve, reject) =>
          Promise.resolve(
            failWith
              ? { data: null, error: { message: failWith } }
              : {
                  data: (rows[table] ?? []).filter((row) => ids(read).includes(row.id)),
                  error: null,
                },
          ).then(resolve, reject),
      };
      return chain;
    },
  },
}));

const ids = (read) => read.in?.[1] ?? [];

const { ACTIVE_SUBSCRIPTION_STATUSES, activeBrandFilter, activeOrgFilter, isOrgActive } =
  await import('./active-subscriptions.js');
const { isSubscriptionActive } = await import('../config/plans.js');

beforeEach(() => {
  reads.length = 0;
  failWith = null;
  rows = {
    organizations: [
      { id: 'trialing', subscription_status: 'trialing' },
      { id: 'active', subscription_status: 'active' },
      { id: 'canceled', subscription_status: 'canceled' },
      { id: 'past-due', subscription_status: 'past_due' },
      { id: 'incomplete', subscription_status: 'incomplete' },
    ],
    brands: [
      { id: 'b-active', organizations: { subscription_status: 'active' } },
      { id: 'b-trialing', organizations: { subscription_status: 'trialing' } },
      { id: 'b-canceled', organizations: { subscription_status: 'canceled' } },
      { id: 'b-orphan', organizations: null },
    ],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('self-hosted', () => {
  beforeEach(() => vi.stubEnv('IS_CLOUD', 'false'));

  it('lets every organization and brand through without reading anything', async () => {
    const isOrgActive = await activeOrgFilter(['canceled', 'anything']);
    const isBrandActive = await activeBrandFilter(['b-canceled']);

    expect(isOrgActive('canceled')).toBe(true);
    expect(isOrgActive(undefined)).toBe(true);
    expect(isBrandActive('b-canceled')).toBe(true);
    expect(reads).toHaveLength(0);
  });
});

describe('cloud', () => {
  beforeEach(() => vi.stubEnv('IS_CLOUD', 'true'));

  it('lets through only the organizations with an active or trialing subscription', async () => {
    const isActive = await activeOrgFilter([
      'trialing',
      'active',
      'canceled',
      'past-due',
      'incomplete',
      'missing',
      'active',
      null,
    ]);

    expect(
      ['trialing', 'active', 'canceled', 'past-due', 'incomplete', 'missing'].filter(isActive),
    ).toEqual(['trialing', 'active']);
    // One read, each id once.
    expect(reads).toEqual([
      {
        table: 'organizations',
        columns: 'id, subscription_status',
        in: ['id', ['trialing', 'active', 'canceled', 'past-due', 'incomplete', 'missing']],
      },
    ]);
  });

  it('lets through only the brands whose organization has one', async () => {
    const isActive = await activeBrandFilter(['b-active', 'b-trialing', 'b-canceled', 'b-orphan']);

    expect(['b-active', 'b-trialing', 'b-canceled', 'b-orphan'].filter(isActive)).toEqual([
      'b-active',
      'b-trialing',
    ]);
    expect(reads[0]).toMatchObject({
      table: 'brands',
      columns: 'id, organizations(subscription_status)',
    });
  });

  it('reads nothing and lets nothing through for no ids', async () => {
    expect((await activeOrgFilter([]))('active')).toBe(false);
    expect((await activeBrandFilter([null]))('b-active')).toBe(false);
    expect(reads).toHaveLength(0);
  });

  it('throws when it cannot tell, so a sweep runs for nobody', async () => {
    failWith = 'statement timeout';
    await expect(activeOrgFilter(['active'])).rejects.toThrow(
      'organizations read: statement timeout',
    );
    await expect(activeBrandFilter(['b-active'])).rejects.toThrow('brands read: statement timeout');
  });
});

describe('isOrgActive', () => {
  it('tells one organization, on the cloud by its subscription, self-hosted always', async () => {
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await isOrgActive('trialing')).toBe(true);
    expect(await isOrgActive('canceled')).toBe(false);
    vi.stubEnv('IS_CLOUD', 'false');
    reads.length = 0;
    expect(await isOrgActive('canceled')).toBe(true);
    expect(reads).toHaveLength(0);
  });
});

describe('ACTIVE_SUBSCRIPTION_STATUSES', () => {
  it('is what isSubscriptionActive takes as active, for a filter in a query', () => {
    vi.stubEnv('IS_CLOUD', 'true');
    const statuses = [
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused',
      null,
    ];
    expect(statuses.filter((status) => isSubscriptionActive(status))).toEqual(
      ACTIVE_SUBSCRIPTION_STATUSES,
    );
  });
});
