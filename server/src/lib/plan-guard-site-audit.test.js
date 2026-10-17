import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Site Audit quota counts audits still running as well as completed
 * ones (completed audits are charged when they finish), and a bulk start is
 * checked for every page it asks for at once.
 */

let used;
let running;
let runningQuery;

function query(table) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      filters.push(['eq', col, val]);
      return builder;
    },
    gte: (col, val) => {
      filters.push(['gte', col, val]);
      return builder;
    },
    single: () => builder,
    maybeSingle: () => builder,
    then: (resolve) => {
      if (table === 'organizations') {
        return resolve({ data: { plan: 'starter', subscription_status: 'active' }, error: null });
      }
      if (table === 'site_audit_usage') return resolve({ count: used, error: null });
      if (table === 'site_audits') {
        runningQuery = filters;
        return resolve({ count: running, error: null });
      }
      return resolve({ data: null, error: null });
    },
  };
  return builder;
}

let quota;

beforeEach(async () => {
  vi.resetModules();
  process.env.IS_CLOUD = 'true';
  vi.doMock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  quota = await import('./plan-guard.js');
});

afterEach(() => {
  delete process.env.IS_CLOUD;
  vi.doUnmock('../config/supabase.js');
});

describe('Site Audit quota', () => {
  it("takes running audits out of what's left", async () => {
    used = 90;
    running = 4;
    expect(await quota.getSiteAuditQuotaStatus('org-1')).toEqual({
      used: 90,
      running: 4,
      limit: 100,
      remaining: 6,
    });
    // Running audits of the org's brands, started in the last two hours.
    expect(runningQuery).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'running'],
        ['eq', 'brands.organization_id', 'org-1'],
        ['gte', 'created_at', expect.any(String)],
      ]),
    );
  });

  it('starts a bulk run only when every page fits', async () => {
    used = 90;
    running = 4;
    await expect(quota.enforceSiteAuditQuota('org-1', 6)).resolves.toMatchObject({ remaining: 6 });
    await expect(quota.enforceSiteAuditQuota('org-1', 7)).rejects.toThrow(
      'These 7 audits need more than the 6 left this month on the Starter plan. Select up to 6.',
    );
  });

  it('refuses one more audit when completed and running ones fill the quota', async () => {
    used = 97;
    running = 3;
    await expect(quota.enforceSiteAuditQuota('org-1')).rejects.toMatchObject({
      statusCode: 429,
      message: expect.stringContaining('(100/100, 3 still running)'),
    });

    used = 100;
    running = 0;
    await expect(quota.enforceSiteAuditQuota('org-1')).rejects.toThrow(
      'Monthly Site Audit limit reached (100/100) on the Starter plan.',
    );
  });

  it('never limits a self-hosted install', async () => {
    delete process.env.IS_CLOUD;
    used = 1000;
    running = 50;
    await expect(quota.enforceSiteAuditQuota('org-1', 50)).resolves.toMatchObject({
      remaining: -1,
    });
    expect(await quota.getSiteAuditQuotaStatus('org-1')).toEqual({
      used: 0,
      running: 0,
      limit: -1,
      remaining: -1,
    });
  });
});
