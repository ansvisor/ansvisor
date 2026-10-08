import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ tables: {}, rpc: vi.fn() }));

/** Minimal chainable stand-in for the supabase query builder. */
function query(rows) {
  const result = { data: rows, error: null, count: rows.length };
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    lt: () => chain,
    in: () => chain,
    then: (resolve) => resolve(result),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => query(db.tables[table] ?? []),
    rpc: (...args) => db.rpc(...args),
  },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../email.js', () => ({ sendEmail: vi.fn() }));

const { probeStatus, findIssues, renderHealthEmail, collectHealthReport, PROBES } =
  await import('./report.js');

const NOW = Date.parse('2026-10-06T06:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

beforeEach(() => {
  db.tables = {};
  db.rpc.mockReset();
  process.env.HEALTH_PROBE_BRAND_ID = 'brand-probe';
  process.env.HEALTH_PROBE_USER_ID = 'user-probe';
});

afterEach(() => {
  delete process.env.HEALTH_PROBE_BRAND_ID;
  delete process.env.HEALTH_PROBE_USER_ID;
});

describe('probeStatus', () => {
  it('is green under 4s, yellow from 4s, red from the 8s budget or on error', () => {
    expect(probeStatus(3.99)).toBe('green');
    expect(probeStatus(4)).toBe('yellow');
    expect(probeStatus(7.99)).toBe('yellow');
    expect(probeStatus(8)).toBe('red');
    expect(probeStatus(null)).toBe('red');
  });
});

describe('collectHealthReport', () => {
  it('times every probe as the configured member and brand', async () => {
    db.rpc.mockResolvedValue({ data: 0.5, error: null });
    const report = await collectHealthReport(NOW);

    expect(db.rpc).toHaveBeenCalledTimes(PROBES.length);
    expect(db.rpc).toHaveBeenCalledWith('health_probe', {
      p_user_id: 'user-probe',
      p_brand_id: 'brand-probe',
      p_probe: 'citations_domains_daily',
      p_days: 1,
    });
    expect(report.probes.results.every((r) => r.status === 'green')).toBe(true);
  });

  it('skips the probes when they are not configured', async () => {
    delete process.env.HEALTH_PROBE_BRAND_ID;
    const report = await collectHealthReport(NOW);
    expect(report.probes.skipped).toBeTruthy();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('reports failed, stuck and missing nightly runs, ignoring manual ones', async () => {
    db.rpc.mockResolvedValue({ data: 0.1, error: null });
    db.tables.jobs = [
      // ran last week and last night
      {
        brand_id: 'ok',
        status: 'completed',
        created_at: hoursAgo(30),
        updated_at: hoursAgo(29),
        data: {},
      },
      {
        brand_id: 'ok',
        status: 'completed',
        created_at: hoursAgo(4),
        updated_at: hoursAgo(3),
        data: {},
      },
      // killed by a restart last night
      {
        brand_id: 'killed',
        status: 'completed',
        created_at: hoursAgo(30),
        updated_at: hoursAgo(29),
        data: {},
      },
      {
        brand_id: 'killed',
        status: 'failed',
        failed_reason: 'Server restarted during execution',
        created_at: hoursAgo(4),
        updated_at: hoursAgo(3),
        data: {},
      },
      // waiting since the night began
      {
        brand_id: 'stuck',
        status: 'completed',
        created_at: hoursAgo(30),
        updated_at: hoursAgo(29),
        data: {},
      },
      {
        brand_id: 'stuck',
        status: 'waiting',
        created_at: hoursAgo(4),
        updated_at: hoursAgo(4),
        data: {},
      },
      // a manual run does not count as the night's run
      {
        brand_id: 'manual',
        status: 'completed',
        created_at: hoursAgo(30),
        updated_at: hoursAgo(29),
        data: {},
      },
      {
        brand_id: 'manual',
        status: 'completed',
        created_at: hoursAgo(2),
        updated_at: hoursAgo(1),
        data: { immediate: true },
      },
    ];
    db.tables.brands = [
      { id: 'killed', name: 'Killed Co' },
      { id: 'stuck', name: 'Stuck Co' },
      { id: 'manual', name: 'Manual Co' },
    ];

    const { nightly } = await collectHealthReport(NOW);

    expect(nightly.failed).toEqual([
      { brand: 'Killed Co', reason: 'Server restarted during execution' },
    ]);
    expect(nightly.restartKills).toBe(1);
    expect(nightly.stuck).toEqual([{ brand: 'Stuck Co', status: 'waiting' }]);
    expect(nightly.missing.sort()).toEqual(['Killed Co', 'Manual Co', 'Stuck Co']);
  });

  it('keeps reporting when one check fails', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'statement timeout' } });
    const report = await collectHealthReport(NOW);
    expect(report.probes.results[0]).toMatchObject({ status: 'red', error: 'statement timeout' });
    expect(report.nightly.counts).toEqual({});
  });
});

describe('renderHealthEmail', () => {
  const clean = {
    generatedAt: '2026-10-06T06:00:00.000Z',
    serverUptimeHours: 5,
    probes: { results: [{ probe: 'citations_domains', days: 1, seconds: 0.2, status: 'green' }] },
    nightly: { counts: { completed: 25 }, failed: [], stuck: [], missing: [], restartKills: 0 },
    cloro: { pendingOverAnHour: 0 },
  };

  it('says OK when nothing needs attention', () => {
    const { subject, issues } = renderHealthEmail(clean);
    expect(issues).toEqual([]);
    expect(subject).toBe('[OK] Ansvisor daily health — 2026-10-06');
  });

  it('lists slow reads and nightly problems, and escapes brand names', () => {
    const report = {
      ...clean,
      probes: {
        results: [{ probe: 'citations_domains', days: 30, seconds: 9.1, status: 'red' }],
      },
      nightly: { ...clean.nightly, failed: [{ brand: '<b>Acme</b>', reason: 'x' }] },
      cloro: { pendingOverAnHour: 3 },
    };
    const { subject, html, issues } = renderHealthEmail(report);
    expect(subject.startsWith('[ISSUES]')).toBe(true);
    expect(issues).toEqual([
      'citations_domains (30d) took 9.1s of its 8s budget',
      '1 nightly run(s) failed',
      '3 Cloro task(s) pending for over an hour',
    ]);
    expect(html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(html).not.toContain('<b>Acme</b>');
  });

  it('flags a check that could not run', () => {
    expect(findIssues({ ...clean, nightly: { error: 'boom' } })).toEqual([
      'Nightly runs could not be checked: boom',
    ]);
  });
});
