import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The daily auto-audit sweep (SA-006): which orgs run, how many pages, which
 * ones, and what the run records and e-mails.
 */

const NOW = new Date('2026-10-10T06:00:00Z');

let quotas;
let brandRows;
let claimed;
let ops;
let auditRows;
let triedRows;
let failCounts;

class PlanLimitError extends Error {}

function query(table) {
  const op = { table, filters: [] };
  const builder = {
    select: (cols, opts) => {
      op.select = cols;
      op.head = opts?.head ?? false;
      return builder;
    },
    upsert: (row, opts) => {
      op.upsert = row;
      op.opts = opts;
      return builder;
    },
    update: (row) => {
      op.update = row;
      return builder;
    },
    eq: (col, val) => {
      op.filters.push(['eq', col, val]);
      return builder;
    },
    in: (col, val) => {
      op.filters.push(['in', col, val]);
      return builder;
    },
    gte: (col, val) => {
      op.filters.push(['gte', col, val]);
      return builder;
    },
    then: (resolve) => {
      ops.push(op);
      if (table === 'site_audit_auto_runs' && op.upsert) {
        return resolve({ data: claimed ? [{ id: 'run-1' }] : [], error: null });
      }
      if (table === 'site_audits') {
        // The pages runs tried in the last 30 days, else the run's own audits.
        return resolve({ data: op.select === 'url' ? triedRows : auditRows, error: null });
      }
      if (table === 'audit_signal_results') {
        const ids = op.filters.find(([, col]) => col === 'audit_id')[2];
        return resolve({ count: ids.reduce((n, id) => n + (failCounts[id] ?? 0), 0), error: null });
      }
      return resolve({ data: null, error: null });
    },
  };
  return builder;
}

const auto = (over = {}) => ({
  enabled: true,
  emailAfterRun: true,
  perRun: 5,
  due: { day: 7 },
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  runs: [
    { day: 1, at: '2026-10-01T00:00:00.000Z', done: true },
    { day: 7, at: '2026-10-07T00:00:00.000Z', done: false },
    { day: 14, at: '2026-10-14T00:00:00.000Z', done: false },
    { day: 21, at: '2026-10-21T00:00:00.000Z', done: false },
    { day: 28, at: '2026-10-28T00:00:00.000Z', done: false },
  ],
  ...over,
});

const row = (path, priority, over = {}) => ({
  key: `acme.com${path}`,
  url: `https://acme.com${path}`,
  path,
  pinned: false,
  running: false,
  priority,
  lastAudit: null,
  ...over,
});

const inboxes = {
  'brand-a': [row('/pinned', 10, { pinned: true }), row('/a-90', 90), row('/a-40', 40)],
  'brand-b': [row('/b-80', 80), row('/b-70', 70), row('/b-20', 20)],
};

let sweep;
let sendAutoAuditEmail;
let readInbox;
let startAudits;

beforeEach(async () => {
  vi.resetModules();
  quotas = { 'org-1': { limit: 100, used: 10, running: 0, auto: auto() } };
  brandRows = [
    { id: 'brand-a', name: 'Acme Coffee', organization_id: 'org-1' },
    { id: 'brand-b', name: 'Acme Tea', organization_id: 'org-1' },
  ];
  claimed = true;
  ops = [];
  auditRows = [];
  triedRows = [];
  failCounts = {};
  sendAutoAuditEmail = vi.fn().mockResolvedValue(true);
  readInbox = vi.fn(async (brandId) => ({ opportunities: inboxes[brandId] ?? [] }));
  startAudits = vi.fn(async (brandId, urls) => ({
    auditIds: urls.map((u) => `${brandId}:${u.slice('https://acme.com'.length)}`),
    done: Promise.resolve(),
  }));

  vi.doMock('../../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  vi.doMock('../rpc-pages.js', () => ({
    readAllRpcRows: async () => ({ data: brandRows, error: null }),
  }));
  vi.doMock('../plan-guard.js', () => ({
    PlanLimitError,
    getSiteAuditQuotaStatus: vi.fn(async (orgId) => {
      const quota = quotas[orgId];
      if (quota instanceof Error) throw quota;
      return quota;
    }),
  }));
  vi.doMock('./auto-audit-email.js', () => ({ sendAutoAuditEmail }));
  ({ sweepAutoAudits: sweep } = await import('./auto-audit-sweep.js'));
});

afterEach(() => {
  vi.doUnmock('../../config/supabase.js');
  vi.doUnmock('../rpc-pages.js');
  vi.doUnmock('../plan-guard.js');
  vi.doUnmock('./auto-audit-email.js');
});

const run = () => sweep({ readInbox, startAudits, now: NOW });
const runOps = () => ops.filter((op) => op.table === 'site_audit_auto_runs');

describe('sweepAutoAudits', () => {
  it("claims the due run, audits the top pages across the org's brands, records and e-mails it", async () => {
    auditRows = [
      { id: 'brand-a:/pinned', brand_id: 'brand-a', status: 'completed' },
      { id: 'brand-a:/a-90', brand_id: 'brand-a', status: 'completed' },
      { id: 'brand-a:/a-40', brand_id: 'brand-a', status: 'failed' },
      { id: 'brand-b:/b-80', brand_id: 'brand-b', status: 'completed' },
      { id: 'brand-b:/b-70', brand_id: 'brand-b', status: 'completed' },
    ];
    failCounts = { 'brand-a:/pinned': 2, 'brand-a:/a-90': 1, 'brand-b:/b-80': 3 };

    expect(await run()).toEqual({ runs: 1 });

    // Five slots: the pinned page, then priority 90, 80, 70, 40.
    expect(startAudits.mock.calls).toEqual([
      [
        'brand-a',
        ['https://acme.com/pinned', 'https://acme.com/a-90', 'https://acme.com/a-40'],
        'org-1',
      ],
      ['brand-b', ['https://acme.com/b-80', 'https://acme.com/b-70'], 'org-1'],
    ]);
    const [claim, ids, done] = runOps();
    expect(claim.upsert).toEqual({
      organization_id: 'org-1',
      period_start: '2026-10-01T00:00:00.000Z',
      run_day: 7,
      slots: 5,
      started_at: NOW.toISOString(),
    });
    expect(claim.opts).toMatchObject({ ignoreDuplicates: true });
    expect(ids.update.audit_ids).toHaveLength(5);
    expect(done.update).toMatchObject({ status: 'completed', finished_at: expect.any(String) });

    expect(sendAutoAuditEmail).toHaveBeenCalledWith('org-1', {
      brands: [
        { name: 'Acme Coffee', pages: 3, completed: 2, criticalIssues: 3 },
        { name: 'Acme Tea', pages: 2, completed: 2, criticalIssues: 3 },
      ],
      nextRunAt: '2026-10-14T00:00:00.000Z',
    });
  });

  it("starts every org's run before any of them finishes", async () => {
    brandRows = [
      { id: 'brand-a', name: 'Acme Coffee', organization_id: 'org-1' },
      { id: 'brand-b', name: 'Beta Beans', organization_id: 'org-2' },
    ];
    quotas['org-2'] = { limit: 500, used: 0, running: 0, auto: auto({ perRun: 25 }) };
    let finishFirst;
    startAudits.mockImplementationOnce(async (brandId, urls) => ({
      auditIds: urls,
      done: new Promise((resolve) => {
        finishFirst = resolve;
      }),
    }));

    const sweeping = run();
    await vi.waitFor(() => expect(startAudits).toHaveBeenCalledTimes(2));
    expect(startAudits.mock.calls.map(([brandId]) => brandId)).toEqual(['brand-a', 'brand-b']);
    finishFirst();
    expect(await sweeping).toEqual({ runs: 2 });
  });

  it("skips the pages the org's runs tried in the last 30 days", async () => {
    triedRows = [{ url: 'https://acme.com/a-90' }, { url: 'https://www.acme.com/b-80/' }];
    await run();
    const tried = ops.find((op) => op.table === 'site_audits' && op.select === 'url');
    expect(tried.filters).toEqual(
      expect.arrayContaining([
        ['in', 'brand_id', ['brand-a', 'brand-b']],
        ['eq', 'source', 'auto'],
      ]),
    );
    expect(startAudits.mock.calls.flatMap(([, urls]) => urls)).toEqual([
      'https://acme.com/pinned',
      'https://acme.com/a-40',
      'https://acme.com/b-70',
      'https://acme.com/b-20',
    ]);
  });

  it('starts nothing when auto-audit is off, no run is due, or another sweep claimed it', async () => {
    quotas['org-1'].auto = auto({ enabled: false });
    await run();
    quotas['org-1'].auto = auto({ due: null });
    await run();
    expect(runOps()).toEqual([]);

    quotas['org-1'].auto = auto();
    claimed = false;
    expect(await run()).toEqual({ runs: 0 });
    expect(readInbox).not.toHaveBeenCalled();
    expect(startAudits).not.toHaveBeenCalled();
  });

  it("caps the run at what's left of the quota, and records an empty run without e-mail", async () => {
    quotas['org-1'].used = 98;
    auditRows = [{ id: 'brand-a:/pinned', brand_id: 'brand-a', status: 'completed' }];
    await run();
    expect(runOps()[0].upsert.slots).toBe(2);
    expect(startAudits.mock.calls.map(([brand, urls]) => [brand, urls.length])).toEqual([
      ['brand-a', 2],
    ]);

    ops = [];
    startAudits.mockClear();
    quotas['org-1'].used = 100;
    await run();
    expect(runOps().map((op) => op.upsert?.slots ?? op.update?.status)).toEqual([0, 'completed']);
    expect(startAudits).not.toHaveBeenCalled();
    expect(sendAutoAuditEmail).toHaveBeenCalledTimes(1);
  });

  it('e-mails only when the org asked, and skips an org without a subscription', async () => {
    quotas['org-1'].auto = auto({ emailAfterRun: false });
    auditRows = [{ id: 'brand-a:/pinned', brand_id: 'brand-a', status: 'completed' }];
    await run();
    expect(runOps().at(-1).update).toMatchObject({ status: 'completed' });
    expect(sendAutoAuditEmail).not.toHaveBeenCalled();

    ops = [];
    quotas['org-1'] = new PlanLimitError('An active subscription or free trial is required.');
    expect(await run()).toEqual({ runs: 0 });
    expect(runOps()).toEqual([]);
  });
});
