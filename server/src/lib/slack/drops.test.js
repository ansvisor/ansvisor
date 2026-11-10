import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Drop alerts (#2139, N4): visibility or the citation rate fell beyond
 * normal swing (Why did it move's rule, W2-18), the last 7 complete days
 * against the 7 before, on the prompts tracked in both weeks only; at most
 * one alert per metric per brand per 7 days.
 */

const h = vi.hoisted(() => ({
  brand: null,
  posts: [],
  rpc: { cells: [] },
  rpcArgs: null,
  rpcError: null,
  slack: null,
}));
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        maybeSingle: async () => ({ data: h.brand, error: null }),
        then: (resolve) => resolve({ data: table === 'slack_posts' ? h.posts : [], error: null }),
      };
      return chain;
    },
    rpc: async (name, args) => {
      h.rpcArgs = [name, args];
      return { data: h.rpcError ? null : h.rpc, error: h.rpcError };
    },
  },
}));
vi.mock('./connection.js', () => ({ brandSlack: async () => h.slack }));
vi.mock('./deliver.js', () => ({ deliverToSlack: vi.fn() }));
vi.mock('../pulse/engine.js', () => ({ appUrl: () => 'https://app.test' }));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));

const { COOLDOWN_DAYS, changeSe, dropOf, dropPeriods, runSlackDrops } = await import('./drops.js');

const ALL_ON = { pulse: true, drops: true, suggestion: true, needsYou: true };
const CHANNEL = { id: 'C00000001', name: 'seo-alerts', private: false };
const NOW = Date.parse('2026-11-10T08:00:00Z');

/** chat_why_cells' cells: `visible` of `prompts` prompts in each period, on one engine. */
function cells({ prompts = 20, visibleA, visibleB, runs = 7, platform = 'chatgpt-web' }) {
  const rows = [];
  for (let i = 0; i < prompts; i++) {
    for (const [period, visible] of [
      ['a', visibleA],
      ['b', visibleB],
    ]) {
      rows.push({
        prompt_id: `p${i}`,
        platform,
        model_used: null,
        region: null,
        period,
        runs,
        visible_runs: i < visible ? 2 : 0,
        answers: runs,
        citation_answers: i < visible ? 2 : 0,
      });
    }
  }
  return rows;
}

describe('dropPeriods', () => {
  it('compares the last 7 complete days with the 7 before', () => {
    expect(dropPeriods(NOW)).toEqual({
      a: { from: '2026-10-27', to: '2026-11-02' },
      b: { from: '2026-11-03', to: '2026-11-09' },
    });
  });
});

describe('dropOf', () => {
  it('finds a visibility drop beyond normal swing, in points', () => {
    const drop = dropOf('visibility', cells({ visibleA: 12, visibleB: 4 }));
    expect(drop).toMatchObject({
      metric: 'visibility',
      from: 60,
      to: 20,
      delta: -40,
      prompts: 20,
      platforms: ['chatgpt-web'],
    });
    // √(0.4 × 0.6 × (1/20 + 1/20)) × 100: explain.ts's changeSe on the same parts.
    expect(drop.se).toBeCloseTo(15.4919, 3);
  });

  it('sees no drop within normal swing, nor a rise, nor no change', () => {
    expect(dropOf('visibility', cells({ visibleA: 12, visibleB: 10 }))).toBeNull();
    expect(dropOf('visibility', cells({ visibleA: 4, visibleB: 12 }))).toBeNull();
    expect(dropOf('visibility', cells({ visibleA: 12, visibleB: 12 }))).toBeNull();
  });

  it('counts the citation rate per prompt and engine, answers citing the brand over answers', () => {
    const drop = dropOf('citations', cells({ visibleA: 15, visibleB: 2 }));
    // 15 × 2 of 140 answers, then 2 × 2 of 140.
    expect(drop.from).toBeCloseTo(21.4286, 3);
    expect(drop.to).toBeCloseTo(2.8571, 3);
    expect(drop.se).toBeCloseTo(
      changeSe(
        Array.from({ length: 20 }, (_, i) => ({ num: i < 15 ? 2 : 0, den: 7 })),
        Array.from({ length: 20 }, (_, i) => ({ num: i < 2 ? 2 : 0, den: 7 })),
      ),
      9,
    );
  });

  it('leaves out prompts tracked in one week, or with too few runs, and engines of one week', () => {
    const base = cells({ prompts: 10, visibleA: 6, visibleB: 6 });
    // Ten prompts visible only in the week before, tracked only then: no drop.
    const dropped = cells({ prompts: 10, visibleA: 10, visibleB: 0 })
      .filter((r) => r.period === 'a')
      .map((r) => ({ ...r, prompt_id: `gone-${r.prompt_id}` }));
    expect(dropOf('visibility', [...base, ...dropped])).toBeNull();
    // The same with too few runs in the later week.
    const thin = cells({ prompts: 10, visibleA: 10, visibleB: 0 }).map((r) => ({
      ...r,
      prompt_id: `thin-${r.prompt_id}`,
      runs: r.period === 'b' ? 2 : r.runs,
    }));
    expect(dropOf('visibility', [...base, ...thin])).toBeNull();
    // An engine tracked the week before only (taken off the plan): no drop.
    const offPlan = cells({
      prompts: 10,
      visibleA: 10,
      visibleB: 0,
      platform: 'perplexity-web',
    }).filter((r) => r.period === 'a');
    expect(dropOf('visibility', [...base, ...offPlan])).toBeNull();
    // ChatGPT Shopping isn't counted.
    const shopping = cells({ visibleA: 20, visibleB: 0, platform: 'chatgpt-shopping' });
    expect(dropOf('citations', [...base, ...shopping])).toBeNull();
  });

  it('measures nothing without stable cells', () => {
    expect(dropOf('visibility', [])).toBeNull();
    expect(dropOf('visibility', cells({ visibleA: 12, visibleB: 4, runs: 2 }))).toBeNull();
  });
});

describe('runSlackDrops', () => {
  let deliver;

  beforeEach(() => {
    h.brand = {
      id: 'b1',
      name: 'Northwind',
      organization_id: 'org-1',
      is_active: true,
      is_demo: false,
    };
    h.posts = [];
    h.rpc = { cells: cells({ visibleA: 12, visibleB: 4 }) };
    h.rpcArgs = null;
    h.rpcError = null;
    h.slack = { status: 'connected', settings: { channel: CHANNEL, send: ALL_ON } };
    deliver = vi.fn(async () => ({ status: 'sent', ts: '1.2' }));
    logger.error.mockClear();
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('posts a drop once per metric and week, through the deliverer', async () => {
    await expect(runSlackDrops('b1', { now: NOW, deliver })).resolves.toEqual({
      checked: true,
      posted: 2,
    });
    expect(h.rpcArgs).toEqual([
      'chat_why_cells',
      {
        p_brand_id: 'b1',
        p_a_from: '2026-10-27',
        p_a_to: '2026-11-02',
        p_b_from: '2026-11-03',
        p_b_to: '2026-11-09',
        p_series_from: '2026-11-09',
        p_models: null,
        p_region: null,
        p_topic_id: null,
      },
    ]);
    expect(deliver.mock.calls.map(([input]) => [input.kind, input.dedupeKey])).toEqual([
      ['drop', 'drop:visibility:2026-11-09'],
      ['drop', 'drop:citations:2026-11-09'],
    ]);
    const message = deliver.mock.calls[0][0].message();
    expect(message.text).toBe(
      'Northwind’s visibility fell more than usual: 60% → 20% (−40 pts), the last 7 days against the 7 before',
    );
    expect(JSON.stringify(message.blocks)).toContain('Ask Chat why');
    expect(JSON.stringify(message.blocks)).toContain('before Nov 17');
  });

  it('holds a metric alerted on in the last 7 days', async () => {
    h.posts = [{ dedupe_key: 'drop:visibility:2026-11-05' }];
    await runSlackDrops('b1', { now: NOW, deliver });
    expect(deliver.mock.calls.map(([input]) => input.dedupeKey)).toEqual([
      'drop:citations:2026-11-09',
    ]);
    expect(COOLDOWN_DAYS).toBe(7);
    h.posts = [
      { dedupe_key: 'drop:visibility:2026-11-05' },
      { dedupe_key: 'drop:citations:2026-11-06' },
    ];
    deliver.mockClear();
    h.rpcArgs = null;
    await expect(runSlackDrops('b1', { now: NOW, deliver })).resolves.toEqual({
      checked: false,
      posted: 0,
    });
    expect(h.rpcArgs).toBeNull();
  });

  it.each([
    ['no Slack', () => (h.slack = null)],
    ['a refused workspace', () => (h.slack = { ...h.slack, status: 'auth_failed' })],
    ['no channel', () => (h.slack = { ...h.slack, settings: { channel: null, send: ALL_ON } })],
    [
      'drop alerts off',
      () =>
        (h.slack = {
          ...h.slack,
          settings: { channel: CHANNEL, send: { ...ALL_ON, drops: false } },
        }),
    ],
    ['a demo brand', () => (h.brand = { ...h.brand, is_demo: true })],
    ['a paused brand', () => (h.brand = { ...h.brand, is_active: false })],
  ])('reads nothing for %s', async (_name, arrange) => {
    arrange();
    await expect(runSlackDrops('b1', { now: NOW, deliver })).resolves.toEqual({
      checked: false,
      posted: 0,
    });
    expect(h.rpcArgs).toBeNull();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('links Visibility only while the new Chat is off for the workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', '');
    await runSlackDrops('b1', { now: NOW, deliver });
    const blocks = JSON.stringify(deliver.mock.calls[0][0].message().blocks);
    expect(blocks).not.toContain('Ask Chat why');
    expect(blocks).toContain('Open Visibility');
  });

  it('never throws: a failed read is logged by code', async () => {
    h.rpcError = { message: 'statement timeout', code: '57014' };
    await expect(runSlackDrops('b1', { now: NOW, deliver })).resolves.toEqual({
      checked: false,
      posted: 0,
      error: true,
    });
    expect(logger.error).toHaveBeenCalledWith(
      { brandId: 'b1', err: { name: 'Error', code: null } },
      '[slack] drop check failed',
    );
  });
});
