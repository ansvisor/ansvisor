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

const { probeStatus, findIssues, renderHealthEmail, collectHealthReport, fanoutDropped, PROBES } =
  await import('./report.js');

/** The read probes' calls, without the fan-out check's. */
const probeCalls = () => db.rpc.mock.calls.filter(([name]) => name === 'health_probe');

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

    expect(probeCalls()).toHaveLength(PROBES.length);
    expect(db.rpc).toHaveBeenCalledWith('health_probe', {
      p_user_id: 'user-probe',
      p_brand_id: 'brand-probe',
      p_probe: 'citations_domains_daily',
      p_days: 1,
    });
    expect(report.probes.results.every((r) => r.status === 'green')).toBe(true);
  });

  it("times the Topics tab's own reads first: its 24 hours and 90 days", () => {
    expect(PROBES.slice(0, 2)).toEqual([
      { probe: 'topics_overview_window', days: 1 },
      { probe: 'topics_overview_window', days: 90 },
    ]);
    expect(PROBES.some((p) => p.probe === 'topics_overview_aggregates')).toBe(false);
  });

  it("times the Mentions & Sentiment tabs' reads last, at 30 and 90 days", () => {
    expect(PROBES.slice(-6)).toEqual([
      { probe: 'mentions_list', days: 30 },
      { probe: 'mentions_list', days: 90 },
      { probe: 'mentions_perception', days: 30 },
      { probe: 'mentions_perception', days: 90 },
      // Perception's live read too (00241): what a filtered view still costs.
      { probe: 'mentions_perception_live', days: 30 },
      { probe: 'mentions_perception_live', days: 90 },
    ]);
  });

  it('skips the probes when they are not configured', async () => {
    delete process.env.HEALTH_PROBE_BRAND_ID;
    const report = await collectHealthReport(NOW);
    expect(report.probes.skipped).toBeTruthy();
    expect(probeCalls()).toHaveLength(0);
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

describe('query fan-out', () => {
  const coverage = (recent, before) => (name, args) => {
    if (name !== 'fanout_coverage_by_platform') return Promise.resolve({ data: 0.1, error: null });
    const rows = args.p_until === new Date(NOW).toISOString() ? recent : before;
    return Promise.resolve({ data: rows, error: null });
  };

  it("compares each platform's share of answers with fan-out to the week before", async () => {
    db.rpc.mockImplementation(
      coverage(
        [
          { platform: 'chatgpt-web', answers: 200, answers_with_fanout: 0 },
          { platform: 'copilot-web', answers: 200, answers_with_fanout: 40 },
          { platform: 'gemini-web', answers: 200, answers_with_fanout: 0 },
        ],
        [
          { platform: 'chatgpt-web', answers: 1400, answers_with_fanout: 350 },
          { platform: 'copilot-web', answers: 1400, answers_with_fanout: 280 },
          { platform: 'gemini-web', answers: 1400, answers_with_fanout: 0 },
        ],
      ),
    );
    const report = await collectHealthReport(NOW);

    expect(db.rpc).toHaveBeenCalledWith('fanout_coverage_by_platform', {
      p_since: hoursAgo(24),
      p_until: new Date(NOW).toISOString(),
    });
    expect(db.rpc).toHaveBeenCalledWith('fanout_coverage_by_platform', {
      p_since: hoursAgo(24 * 4),
      p_until: hoursAgo(24),
    });
    expect(report.fanout.platforms).toEqual([
      expect.objectContaining({ platform: 'chatgpt-web', rate: 0, baselineRate: 0.25 }),
      expect.objectContaining({ platform: 'copilot-web', rate: 0.2, baselineRate: 0.2 }),
      expect.objectContaining({ platform: 'gemini-web', rate: 0, baselineRate: 0 }),
    ]);
    // ChatGPT stopped; Copilot held; Gemini never fans out, so it isn't news.
    expect(findIssues(report).filter((i) => i.includes('fan-out'))).toEqual([
      'chatgpt-web returned no query fan-out on any of its 200 answers in the last 24h (25% the days before) — check what Cloro returns',
    ]);
    expect(renderHealthEmail(report).html).toContain('Query fan-out');
  });

  it('flags a partial collapse too, but not a platform with too few answers to judge', () => {
    const base = { platform: 'x', withFanout: 5, baselineAnswers: 500 };
    expect(fanoutDropped({ ...base, answers: 100, rate: 0.05, baselineRate: 0.3 })).toBe(true);
    expect(fanoutDropped({ ...base, answers: 100, rate: 0.2, baselineRate: 0.3 })).toBe(false);
    expect(fanoutDropped({ ...base, answers: 5, rate: 0, baselineRate: 0.3 })).toBe(false);
    expect(fanoutDropped({ ...base, answers: 100, rate: 0, baselineRate: 0.02 })).toBe(false);
  });

  it('keeps flagging an engine that should fan out, however long it has been silent', () => {
    // Nothing for two weeks, so the days before are empty too.
    const silent = {
      platform: 'copilot-web',
      answers: 400,
      withFanout: 0,
      rate: 0,
      baselineAnswers: 1200,
      baselineRate: 0,
    };
    expect(fanoutDropped(silent)).toBe(true);
    // Gemini documents no fan-out, so a silent day is normal for it.
    expect(fanoutDropped({ ...silent, platform: 'gemini-web' })).toBe(false);
    // Nor is it news on ChatGPT, whose default interface carries none (#1119).
    expect(fanoutDropped({ ...silent, platform: 'chatgpt-web' })).toBe(false);
  });

  it('says so when the check cannot run', async () => {
    db.rpc.mockImplementation((name) =>
      Promise.resolve(
        name === 'fanout_coverage_by_platform'
          ? { data: null, error: { message: 'timeout' } }
          : { data: 0.1, error: null },
      ),
    );
    const report = await collectHealthReport(NOW);
    expect(findIssues(report)).toContain('Query fan-out could not be checked: timeout');
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
