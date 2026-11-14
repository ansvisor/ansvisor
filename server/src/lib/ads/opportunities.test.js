import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ads' Opportunities (ADS-01 §2, §3.2, §8): each buying-intent prompt's
 * standing from the rollups' answers, the rule's decision and a person's
 * over it, Starter's three rows, and one snapshot a week. A fake database
 * that applies each read's filters, so a row of another brand or
 * organization shows only if a read forgets one.
 */

let db;
const writes = [];
const rpcs = [];
const logAdsActivity = vi.fn();
/** Whether a write (op, table) fails, as the database would answer it. */
let failing = () => false;
const at = (row, path) => path.split('.').reduce((v, k) => v?.[k], row);
function from(table) {
  let rows = db[table] ?? [];
  let one = false;
  let write = null;
  const filters = [];
  const q = {
    select: () => q,
    order: () => q,
    range: () => q,
    eq: (col, v) => (filters.push([col, v]), (rows = rows.filter((r) => at(r, col) === v)), q),
    in: (col, vs) => ((rows = rows.filter((r) => vs.includes(at(r, col)))), q),
    maybeSingle: () => ((one = true), q),
    upsert: (row, options) => ((write = ['upsert', table, row, options]), q),
    delete: () => ((write = ['delete', table]), q),
    then: (resolve, reject) => {
      if (write) writes.push(write[0] === 'delete' ? [...write, filters] : write);
      const error = write && failing(write[0], table) ? { message: 'write failed' } : null;
      const data = write ? null : one ? (rows[0] ?? null) : rows;
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
  };
  return q;
}
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => from(table),
    rpc: async (name, params) => (rpcs.push([name, params]), { data: db.rpcs[name], error: null }),
  },
}));
vi.mock('./activity.js', () => ({ logAdsActivity: (...args) => logAdsActivity(...args) }));

const { isDemoPrompt, isoWeek, readOpportunities, saveAdsSettings, setDecision } =
  await import('./opportunities.js');
const { readStanding } = await import('./standing.js');
const { logger } = await import('../logger.js');

const NOW = new Date('2026-11-13T12:00:00Z');
const BRAND = { id: 'b1', organization_id: 'o1', is_demo: false };
const prompt = (id, text, over = {}) => ({
  id,
  text,
  topic_id: 't1',
  platforms: ['chatgpt-web', 'google-aio'],
  regions: ['us'],
  is_active: true,
  prompt_sets: { brand_id: 'b1', brands: { organization_id: 'o1' } },
  ...over,
});
const volume = (prompt_id, intent, total_google_volume, fetched_at = '2026-11-01') => ({
  prompt_id,
  intent,
  total_google_volume,
  fetched_at,
});

beforeEach(() => {
  vi.stubEnv('IS_CLOUD', 'true');
  writes.length = 0;
  rpcs.length = 0;
  failing = () => false;
  logAdsActivity.mockReset().mockResolvedValue({ id: 'a1' });
  db = {
    brands: [BRAND, { id: 'b2', organization_id: 'o2' }],
    organizations: [{ id: 'o1', plan: 'growth', subscription_status: 'active' }],
    prompts: [
      prompt('p1', 'best crm'),
      prompt('p2', 'acme vs rival'),
      prompt('p3', 'how to export contacts'),
      prompt('p4', 'top crm tools'),
      prompt('p5', 'crm for startups', { platforms: ['claude'] }),
      prompt('p6', 'best crm', {
        prompt_sets: { brand_id: 'b2', brands: { organization_id: 'o2' } },
      }),
      prompt('p7', 'crm pricing', { is_active: false }),
      prompt('p8', 'crm comparison', { topic_id: null }),
    ],
    topics: [{ id: 't1', brand_id: 'b1', name: 'CRM' }],
    competitors: [
      { id: 'c1', brand_id: 'b1', name: 'Rival' },
      { id: 'c2', brand_id: 'b1', name: 'Other' },
      { id: 'c9', brand_id: 'b2', name: 'Not ours' },
    ],
    prompt_volumes: [
      volume('p1', 'best-top', 1200, '2026-11-10'),
      volume('p1', 'how-to', 800, '2026-10-01'),
      volume('p2', 'vs-review', 5000),
      volume('p3', 'how-to', 900),
      volume('p5', 'recommendation', 200),
      volume('p6', 'best-top', 9999),
      volume('p7', 'comparison', 700),
      volume('p8', 'comparison', 50),
    ],
    ads_settings: [],
    ads_decision_overrides: [],
    rpcs: {
      ae_prompt_stats: [
        { prompt_id: 'p1', cur_mention_days: 5, cur_citation_days: 3, cur_answers: 20 },
        { prompt_id: 'p2', cur_mention_days: 2, cur_citation_days: 0, cur_answers: 20 },
        { prompt_id: 'p5', cur_mention_days: 0, cur_citation_days: 0, cur_answers: 8 },
      ],
      ae_competitor_prompt_stats: [
        { prompt_id: 'p2', competitor_id: 'c1', cur_answers: 9 },
        { prompt_id: 'p5', competitor_id: 'c2', cur_answers: 4 },
        { prompt_id: 'p5', competitor_id: 'c1', cur_answers: 1 },
      ],
      ae_competitor_positions: [
        { competitor_id: 'c1', prompt_id: 'p2', competitor_now: 1, brand_now: 3 },
        { competitor_id: 'c2', prompt_id: 'p2', competitor_now: 2, brand_now: 3 },
        { competitor_id: 'c1', prompt_id: 'p1', competitor_now: 2, brand_now: 2 },
      ],
    },
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('readStanding', () => {
  it("composes each buying-intent prompt's standing from the rollups, and runs the rule", async () => {
    const { rows, notAnalysed } = await readStanding({ brandId: 'b1', orgId: 'o1', now: NOW });
    expect(rows.map((r) => r.promptId)).toEqual(['p1', 'p2', 'p5', 'p8']);
    expect(notAnalysed).toBe(1);
    const [p1, p2, p5, p8] = rows;
    // Cited and level with Rival: we lead; the newest intent, the largest volume.
    expect(p1).toMatchObject({ intent: 'best-top', topic: { id: 't1', name: 'CRM' } });
    expect(p1.standing).toMatchObject({
      weCited: true,
      ourPosition: 2,
      leader: 'us',
      volume: 1200,
    });
    expect(p1).toMatchObject({ decision: 'earn', rule: 'protect', paidMeasured: false });
    // Rival named first, with volume: earn + pay, on the prompt's ad channels.
    expect(p2.standing).toMatchObject({ weCited: false, ourPosition: 3, leader: 'c1' });
    expect(p2).toMatchObject({ leaderName: 'Rival', decision: 'earn_pay', rule: 'rival_leads' });
    expect(p2.channels).toEqual(['chatgpt', 'google']);
    // Not named; Other is named most: it leads, below the volume threshold.
    expect(p5.standing).toMatchObject({ ourPosition: null, leader: 'c2', volume: 200 });
    expect(p5).toMatchObject({ leaderName: 'Other', decision: 'earn', rule: 'rival_leads' });
    expect(p8).toMatchObject({ topic: null, decision: 'earn', rule: 'open' });
    expect(p8.reasons).toContainEqual({ code: 'paid_not_measured', rivalPays: true, wePay: true });
  });

  it('reads only the brand of the organization, over the period', async () => {
    await readStanding({ brandId: 'b1', orgId: 'o1', period: '7d', now: NOW });
    const window = {
      p_brand_id: 'b1',
      p_cur_from: '2026-11-07',
      p_cur_to: '2026-11-13',
      p_prev_from: '2026-10-31',
      p_prev_to: '2026-11-06',
    };
    expect(rpcs).toContainEqual(['ae_prompt_stats', window]);
    expect(rpcs).toContainEqual(['ae_competitor_prompt_stats', window]);
    const positions = rpcs.find(([name]) => name === 'ae_competitor_positions')[1];
    expect(positions).toMatchObject({ ...window, p_competitor_ids: ['c1', 'c2'] });

    rpcs.length = 0;
    for (const [brandId, orgId] of [
      ['b2', 'o1'],
      ['b1', 'o2'],
    ]) {
      await expect(readStanding({ brandId, orgId, now: NOW })).rejects.toMatchObject({
        status: 404,
      });
    }
    expect(rpcs).toEqual([]);
  });
});

describe('readOpportunities', () => {
  const read = (over = {}) =>
    readOpportunities({ brand: BRAND, orgId: 'o1', period: '30d', now: NOW, ...over });

  it('gives Growth every row, the most searched first, with the thresholds that apply', async () => {
    const page = await read();
    expect(page.rows.map((r) => r.promptId)).toEqual(['p2', 'p1', 'p5', 'p8']);
    expect(page).toMatchObject({ total: 4, locked: 0, notAnalysed: 1, week: '2026-W46' });
    expect(page.thresholds).toEqual({
      minIntentWeight: 0.85,
      leadPosition: 1,
      minPaidVolume: 1000,
    });

    db.ads_settings = [{ organization_id: 'o1', thresholds: { minPaidVolume: 6000 } }];
    expect((await read()).rows[0]).toMatchObject({ promptId: 'p2', decision: 'earn' });
  });

  it('gives Starter and the free trial the first 3 rows and a locked count, decided here', async () => {
    for (const org of [
      { plan: 'starter', subscription_status: 'active' },
      { plan: 'growth', subscription_status: 'trialing' },
      { plan: 'starter', subscription_status: 'canceled' },
    ]) {
      db.organizations = [{ id: 'o1', ...org }];
      const page = await read();
      expect(
        page.rows.map((r) => r.promptId),
        JSON.stringify(org),
      ).toEqual(['p2', 'p1', 'p5']);
      expect(page).toMatchObject({ total: 4, locked: 1 });
    }
    for (const org of [
      { plan: 'enterprise', subscription_status: 'trialing' },
      { plan: 'growth', subscription_status: 'canceled' },
    ]) {
      db.organizations = [{ id: 'o1', ...org }];
      expect((await read()).locked, JSON.stringify(org)).toBe(0);
    }
    db.organizations = [{ id: 'o1', plan: 'starter', subscription_status: 'active' }];
    expect((await read({ brand: { ...BRAND, is_demo: true } })).locked).toBe(0);
    vi.stubEnv('IS_CLOUD', undefined);
    expect((await read()).locked).toBe(0);
  });

  it("lets a person's decision beat the rule's, and keeps the rule's beside it", async () => {
    db.ads_decision_overrides = [
      { prompt_id: 'p1', brand_id: 'b1', decision: 'pay', set_by: 'u1', set_at: 'T' },
      { prompt_id: 'p6', brand_id: 'b2', decision: 'pay', set_by: 'u9', set_at: 'T' },
    ];
    const rows = (await read()).rows;
    expect(rows.find((r) => r.promptId === 'p1')).toMatchObject({
      decision: 'pay',
      recommended: 'earn',
      override: { decision: 'pay', setBy: 'u1', setAt: 'T' },
    });
    expect(rows.filter((r) => r.override).map((r) => r.promptId)).toEqual(['p1']);
  });

  it("writes the week's snapshot of the rule's decisions, once a week", async () => {
    db.ads_decision_overrides = [{ prompt_id: 'p1', brand_id: 'b1', decision: 'pay' }];
    await read();
    const [[op, table, rows, options]] = writes;
    expect([op, table, options]).toEqual([
      'upsert',
      'ads_opportunity_snapshots',
      { onConflict: 'prompt_id,iso_week', ignoreDuplicates: true },
    ]);
    expect(rows.map((r) => [r.prompt_id, r.iso_week, r.decision])).toEqual([
      ['p1', '2026-W46', 'earn'],
      ['p2', '2026-W46', 'earn_pay'],
      ['p5', '2026-W46', 'earn'],
      ['p8', '2026-W46', 'earn'],
    ]);
    expect(rows[1].inputs).toMatchObject({ leader: 'c1', volume: 5000, period: '30d' });
    // Another period, or the demo brand: no snapshot.
    writes.length = 0;
    await read({ period: '7d' });
    await read({ brand: { ...BRAND, is_demo: true } });
    expect(writes).toEqual([]);
    expect(['2026-11-13', '2021-01-01', '2024-12-30'].map((d) => isoWeek(new Date(d)))).toEqual([
      '2026-W46',
      '2020-W53',
      '2025-W01',
    ]);
  });
});

describe('setDecision', () => {
  const set = (over = {}) =>
    setDecision({
      orgId: 'o1',
      brandId: 'b1',
      promptId: 'p2',
      decision: 'pay',
      userId: 'u1',
      ...over,
    });

  it('sets it, logged with what it was, and takes it back to the rule', async () => {
    expect(await set()).toMatchObject({ decision: 'pay', setBy: 'u1' });
    expect(writes[0].slice(0, 3)).toMatchObject([
      'upsert',
      'ads_decision_overrides',
      { prompt_id: 'p2', brand_id: 'b1', decision: 'pay', set_by: 'u1' },
    ]);
    expect(logAdsActivity).toHaveBeenLastCalledWith({
      orgId: 'o1',
      brandId: 'b1',
      actor: { userId: 'u1' },
      event: 'decision.set',
      target: { promptId: 'p2' },
      before: { decision: null },
      after: { decision: 'pay' },
    });
    db.ads_decision_overrides = [{ prompt_id: 'p2', brand_id: 'b1', decision: 'pay' }];
    expect(await set({ decision: null })).toBeNull();
    expect(writes[1].slice(0, 2)).toEqual(['delete', 'ads_decision_overrides']);
    expect(logAdsActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ event: 'decision.cleared', before: { decision: 'pay' } }),
    );
  });

  it("reads another brand's or organization's prompt as not found, writing nothing", async () => {
    for (const over of [{ promptId: 'p6' }, { brandId: 'b2', promptId: 'p6' }, { orgId: 'o2' }]) {
      await expect(set(over), JSON.stringify(over)).rejects.toMatchObject({ status: 404 });
    }
    expect(writes).toEqual([]);
    expect(logAdsActivity).not.toHaveBeenCalled();
  });

  it("puts the decision back when the log can't hold the change", async () => {
    logAdsActivity.mockRejectedValue(new Error('ads activity write failed'));
    await expect(set()).rejects.toThrow('ads activity write failed');
    expect(writes.map((w) => w.slice(0, 2))).toEqual([
      ['upsert', 'ads_decision_overrides'],
      ['delete', 'ads_decision_overrides'],
    ]);
  });
});

describe('isDemoPrompt', () => {
  it("finds the organization's demo brand's prompt, and nothing of another organization", async () => {
    const demo = (organization_id) => ({
      brand_id: 'bd',
      brands: { organization_id, is_demo: true },
    });
    db.prompts.push(
      prompt('pd', 'best crm', { prompt_sets: demo('o1') }),
      prompt('px', 'best crm', { prompt_sets: demo('o2') }),
    );
    expect(await isDemoPrompt('o1', 'pd')).toBe(true);
    expect(await isDemoPrompt('o1', 'p1')).toBe(false);
    // Another organization's, or none: not found here, and setDecision answers 404.
    expect(await isDemoPrompt('o1', 'px')).toBe(false);
    expect(await isDemoPrompt('o1', 'nope')).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe('saveAdsSettings', () => {
  it("lays the changes over the workspace's thresholds, logged", async () => {
    db.ads_settings = [
      { organization_id: 'o1', thresholds: { minPaidVolume: 500, leadPosition: 2 } },
    ];
    const saved = await saveAdsSettings('o1', 'u1', { minPaidVolume: 2000, leadPosition: null });
    expect(saved.thresholds).toEqual({ minPaidVolume: 2000 });
    expect(writes[0].slice(0, 3)).toMatchObject([
      'upsert',
      'ads_settings',
      { organization_id: 'o1', updated_by: 'u1' },
    ]);
    expect(logAdsActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'settings.changed',
        before: { minPaidVolume: 500, leadPosition: 2 },
        after: { minPaidVolume: 2000 },
      }),
    );
  });

  it("puts the thresholds back when the log can't hold the change, and fails", async () => {
    const was = {
      organization_id: 'o1',
      thresholds: { minPaidVolume: 500 },
      updated_by: 'u0',
      updated_at: 'T0',
    };
    db.ads_settings = [was];
    logAdsActivity.mockRejectedValue(new Error('ads activity write failed'));
    await expect(saveAdsSettings('o1', 'u1', { minPaidVolume: 2000 })).rejects.toThrow(
      'ads activity write failed',
    );
    expect(writes.map((w) => w.slice(0, 3))).toEqual([
      [
        'upsert',
        'ads_settings',
        expect.objectContaining({ thresholds: { minPaidVolume: 2000 }, updated_by: 'u1' }),
      ],
      ['upsert', 'ads_settings', was],
    ]);

    // A workspace on the defaults until now goes back to none of its own.
    writes.length = 0;
    db.ads_settings = [];
    await expect(saveAdsSettings('o1', 'u1', { leadPosition: 2 })).rejects.toThrow(
      'ads activity write failed',
    );
    expect(writes.map((w) => w.slice(0, 2))).toEqual([
      ['upsert', 'ads_settings'],
      ['delete', 'ads_settings'],
    ]);
    expect(writes[1][2]).toEqual([['organization_id', 'o1']]);
  });

  it("logs a put-back that fails too, and still fails with the log's error", async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    logAdsActivity.mockRejectedValue(new Error('ads activity write failed'));
    failing = (op) => op === 'delete';
    await expect(saveAdsSettings('o1', 'u1', { leadPosition: 2 })).rejects.toThrow(
      'ads activity write failed',
    );
    expect(error).toHaveBeenCalledWith({ err: 'write failed' }, '[ads] settings put-back failed');
  });
});
