import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRIAL_AI_BUDGET_USD } from '../config/plans.js';

/**
 * Chat's model steps on the workspace's one AI budget (CHAT-04 §C, CHAT-16
 * §H): one usage row per step, held at its worst case before it starts and
 * turned into its real cost (1x) after; own-key steps written, never
 * counted; the trial's budget kept over the whole trial.
 *
 * The database is a ledger in memory. reserve_chat_ai_usage and
 * ai_usage_by_feature do what 00405's do (checked against the database in a
 * rolled-back transaction when 00405 was written): one hold at a time per
 * organization, and a step only while spend + holds + its worst case stays
 * within the budget; own-key rows left out of every sum. reserve_ai_usage
 * does what 00243's (as 00405 left it) does: a call while anything is left.
 * The purchased AI credits (00413's ai_credit_grants) are a list beside it.
 */

const RUN = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c01';
const STEP = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c02';
// Priced from improve-cost's own table: $1 / $5 per million tokens.
const MODEL = 'anthropic/claude-haiku-4-5';

let org;
let ledger;
let grants;
let rpcCalls;
let runs;
let nextId;
// The per-organization lock: each hold waits for the one before.
let lock;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 00405's reserve_chat_ai_usage, on the ledger. */
async function reserveChatAiUsage(args) {
  if (!runs.has(args.p_chat_run_id)) {
    return { data: null, error: { code: 'P0002', message: 'chat run not found' } };
  }
  const held = lock.then(async () => {
    if (!args.p_own_key && args.p_budget !== null) {
      const spent = ledger
        .filter((r) => !r.own_key && r.used_at >= args.p_since)
        .reduce((sum, r) => sum + r.cost_usd, 0);
      // The database's time between reading the spend and writing the hold.
      await tick();
      if (spent >= args.p_budget || spent + args.p_cost > args.p_budget + 1e-12) return null;
    }
    const id = `u${nextId++}`;
    ledger.push({
      id,
      organization_id: args.p_organization_id,
      feature: args.p_feature,
      model: args.p_model,
      cost_usd: args.p_cost,
      own_key: args.p_own_key,
      chat_run_id: args.p_chat_run_id,
      chat_run_step_id: args.p_chat_run_step_id,
      used_at: new Date().toISOString(),
    });
    return id;
  });
  lock = held.catch(() => {});
  return { data: await held, error: null };
}

/** 00405's ai_usage_by_feature, on the ledger. */
function aiUsageByFeature(args) {
  const by = new Map();
  for (const r of ledger) {
    if (r.own_key || r.used_at < args.p_since) continue;
    by.set(r.feature ?? 'other', (by.get(r.feature ?? 'other') ?? 0) + r.cost_usd);
  }
  return { data: [...by].map(([feature, cost_usd]) => ({ feature, cost_usd })), error: null };
}

/** 00243's reserve_ai_usage (00405: own-key rows left out), on the ledger. */
function reserveAiUsage(args) {
  const spent = ledger
    .filter((r) => !r.own_key && r.used_at >= args.p_since)
    .reduce((sum, r) => sum + r.cost_usd, 0);
  if (spent >= args.p_budget) return { data: null, error: null };
  const id = `u${nextId++}`;
  ledger.push({
    id,
    organization_id: args.p_organization_id,
    feature: args.p_feature,
    model: args.p_model,
    cost_usd: Math.max(args.p_cost, 0),
    own_key: false,
    used_at: new Date().toISOString(),
  });
  return { data: id, error: null };
}

const tables = () => ({ prompt_improve_usage: ledger, ai_credit_grants: grants });

/** What PostgREST's filters do, on a row's value: numbers by value, times as ISO strings. */
const same = (a, b) => a === b || (typeof a === 'number' && Number(b) === a);
const FILTERS = {
  eq: (a, b) => same(a, b),
  neq: (a, b) => !same(a, b),
  in: (a, b) => b.includes(a),
  gt: (a, b) => a != null && a > b,
  gte: (a, b) => a != null && a >= b,
  is: (a, b) => (b === null ? a == null : a === b),
  notNull: (a) => a != null,
};

function query(table) {
  const op = { kind: 'select', filters: [], orders: [], range: null, one: false };
  const matches = (r) => op.filters.every(([kind, col, val]) => FILTERS[kind](r[col], val));
  const run = () => {
    if (table === 'organizations') return { data: org, error: null };
    const list = tables()[table] ?? [];
    if (op.kind === 'update') {
      const hit = list.filter(matches);
      hit.forEach((r) => Object.assign(r, op.value));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (op.kind === 'delete') {
      ledger = ledger.filter((r) => !matches(r));
      return { data: null, error: null };
    }
    if (op.kind === 'insert') {
      for (const row of [op.value].flat()) list.push({ id: `u${nextId++}`, ...row });
      return { data: null, error: null };
    }
    let found = list.filter(matches);
    for (const [col, ascending] of [...op.orders].reverse()) {
      found = [...found].sort(
        (a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1),
      );
    }
    if (op.range) found = found.slice(op.range[0], op.range[1] + 1);
    found = found.map((r) => ({ ...r }));
    return { data: op.one ? (found[0] ?? null) : found, error: null };
  };
  const filter = (kind) => (col, val) => (op.filters.push([kind, col, val]), builder);
  const builder = {
    select: () => builder,
    eq: filter('eq'),
    neq: filter('neq'),
    in: filter('in'),
    gt: filter('gt'),
    gte: filter('gte'),
    is: filter('is'),
    not: (col) => (op.filters.push(['notNull', col]), builder),
    or: () => builder,
    order: (col, { ascending = true } = {}) => (op.orders.push([col, ascending]), builder),
    limit: () => builder,
    range: (from, to) => ((op.range = [from, to]), builder),
    update: (value) => (Object.assign(op, { kind: 'update', value }), builder),
    insert: (value) => (Object.assign(op, { kind: 'insert', value }), builder),
    delete: () => (Object.assign(op, { kind: 'delete' }), builder),
    maybeSingle: () => ((op.one = true), builder),
    single: () => ((op.one = true), builder),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}

let budget;
let guard;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  // Renews on the 20th: the period runs from the 20th of last month.
  org = {
    plan: 'starter',
    subscription_status: 'active',
    subscription_ends_at: '2026-11-20T09:00:00Z',
  };
  ledger = [];
  grants = [];
  rpcCalls = [];
  runs = new Set([RUN]);
  nextId = 1;
  lock = Promise.resolve();
  vi.doMock('../config/supabase.js', () => ({
    default: {
      from: (t) => query(t),
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (fn === 'reserve_chat_ai_usage') return reserveChatAiUsage(args);
        if (fn === 'reserve_ai_usage') return reserveAiUsage(args);
        if (fn === 'ai_usage_by_feature') return aiUsageByFeature(args);
        return { data: null, error: { message: `no ${fn}` } };
      },
    },
  }));
  vi.doMock('./logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  budget = await import('./chat-budget.js');
  guard = await import('./plan-guard.js');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.doUnmock('../config/supabase.js');
  vi.doUnmock('./logger.js');
});

/** Spend already this period, on another feature. */
const spent = (usd) =>
  ledger.push({
    id: 'prior',
    feature: 'content',
    cost_usd: usd,
    own_key: false,
    used_at: '2026-10-21T00:00:00.000Z',
  });

const nonOwnSpend = () => ledger.filter((r) => !r.own_key).reduce((s, r) => s + r.cost_usd, 0);

const step = (over = {}) => ({
  modelId: MODEL,
  inputTokens: 2000,
  maxOutputTokens: 1000,
  runId: RUN,
  ...over,
});

describe('a Chat step on the AI budget', () => {
  it('holds its worst case, then writes its real cost on the same row: one row a step', async () => {
    const id = await budget.reserveChatStep('o1', step({ stepId: STEP }));
    expect(rpcCalls[0]).toEqual({
      fn: 'reserve_chat_ai_usage',
      args: {
        p_organization_id: 'o1',
        p_chat_run_id: RUN,
        p_chat_run_step_id: STEP,
        p_feature: 'chat',
        p_model: MODEL,
        // 2,000 tokens in at $1/M and 1,000 out at $5/M: every token it may write.
        p_cost: 0.007,
        p_own_key: false,
        // From the period's start, against Starter's $5.
        p_since: '2026-10-20T09:00:00.000Z',
        p_budget: 5,
      },
    });
    expect(ledger).toEqual([
      expect.objectContaining({ id, feature: 'chat', cost_usd: 0.007, chat_run_step_id: STEP }),
    ]);

    await budget.chargeChatStep('o1', id, {
      modelId: MODEL,
      usage: { inputTokens: 1800, outputTokens: 400 },
    });
    // 1x: what the model cost, no margin.
    expect(ledger).toEqual([
      expect.objectContaining({
        id,
        input_tokens: 1800,
        output_tokens: 400,
        cost_usd: 0.0038,
        chat_run_id: RUN,
      }),
    ]);

    // A second step writes its own row.
    const second = await budget.reserveChatStep('o1', step({ stepId: null }));
    await budget.chargeChatStep('o1', second, {
      modelId: MODEL,
      usage: { inputTokens: 100, outputTokens: 100 },
    });
    expect(ledger.map((r) => r.id)).toEqual([id, second]);
    expect(ledger.every((r) => r.chat_run_id === RUN && r.feature === 'chat')).toBe(true);
  });

  it('never lets 20 steps at once pass the cap with 1% of it left', async () => {
    // Starter's $5 with $0.05 left; each step may cost $0.007.
    spent(4.95);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => budget.reserveChatStep('o1', step())),
    );
    const held = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const refused = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
    // 7 × $0.007 = $0.049 fits; an 8th would pass $5.
    expect(held).toHaveLength(7);
    expect(refused).toHaveLength(13);
    expect(refused.every((e) => e.statusCode === 429)).toBe(true);
    expect(nonOwnSpend()).toBeLessThanOrEqual(5);

    // Each charged at what it used (never more than its worst case): still within.
    await Promise.all(
      held.map((id) =>
        budget.chargeChatStep('o1', id, {
          modelId: MODEL,
          usage: { inputTokens: 2000, outputTokens: 1000 },
        }),
      ),
    );
    expect(nonOwnSpend()).toBeLessThanOrEqual(5);
    // Once spent, the next step doesn't start.
    await expect(budget.reserveChatStep('o1', step())).rejects.toMatchObject({ statusCode: 429 });
  });

  it('writes a step on the workspace’s own key, and the meter’s percent doesn’t move', async () => {
    spent(1);
    const before = await guard.getAiUsage('o1');
    expect(before.percentUsed).toBe(20);

    const id = await budget.reserveChatStep('o1', step({ ownKey: true }));
    await budget.chargeChatStep('o1', id, {
      modelId: MODEL,
      usage: { inputTokens: 500_000, outputTokens: 100_000 },
    });
    // The row is there, marked, at its cost…
    expect(ledger).toContainEqual(
      expect.objectContaining({ id, own_key: true, feature: 'chat', cost_usd: 1 }),
    );
    // …and the meter reads as it did, with no Chat row.
    const after = await guard.getAiUsage('o1');
    expect(after.percentUsed).toBe(20);
    expect(after.features).toEqual([{ feature: 'content', percent: 20 }]);

    // Even with the budget spent, an own-key step runs.
    spent(4);
    await expect(budget.reserveChatStep('o1', step({ ownKey: true }))).resolves.toEqual(
      expect.any(String),
    );
  });

  it('shows Ansvisor-key steps in their own Chat row, and says Chat is metered', async () => {
    spent(1);
    const id = await budget.reserveChatStep('o1', step());
    await budget.chargeChatStep('o1', id, {
      modelId: MODEL,
      usage: { inputTokens: 250_000, outputTokens: 50_000 },
    });
    const usage = await guard.getAiUsage('o1');
    expect(usage.chatMetered).toBe(true);
    expect(usage.percentUsed).toBe(30);
    expect(usage.features).toEqual([
      { feature: 'content', percent: 20 },
      { feature: 'chat', percent: 10 },
    ]);
  });

  it('keeps the free trial’s budget over the whole trial: the 1st of the month doesn’t reset it', async () => {
    // A trial that ends on 8 November, read on 2 November.
    org = {
      plan: 'growth',
      subscription_status: 'trialing',
      subscription_ends_at: '2026-11-08T10:00:00Z',
    };
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    ledger.push({
      id: 'october',
      feature: 'improve',
      cost_usd: TRIAL_AI_BUDGET_USD - 0.001,
      own_key: false,
      used_at: '2026-10-25T00:00:00.000Z',
    });

    await expect(budget.reserveChatStep('o1', step())).rejects.toMatchObject({
      statusCode: 429,
      trial: true,
    });
    expect(rpcCalls[0].args).toMatchObject({
      p_budget: TRIAL_AI_BUDGET_USD,
      // From the trial's start, not 1 November: October's spend still counts.
      p_since: '2026-10-08T10:00:00.000Z',
    });
  });

  it('keeps the hold as the cost when the provider reported no usage: over, never under', async () => {
    const id = await budget.reserveChatStep('o1', step());
    await budget.chargeChatStep('o1', id, { modelId: MODEL, usage: {} });
    expect(ledger).toEqual([expect.objectContaining({ id, cost_usd: 0.007 })]);
  });

  it('lets a hold go when the step billed nothing, and never another feature’s row', async () => {
    const id = await budget.reserveChatStep('o1', step());
    ledger.push({
      id: 'other',
      feature: 'content',
      cost_usd: 0.1,
      own_key: false,
      used_at: '2026-10-21',
    });
    await budget.releaseChatStep('o1', id);
    await budget.releaseChatStep('o1', id);
    await budget.releaseChatStep('o1', 'other');
    expect(ledger.map((r) => r.id)).toEqual(['other']);
    // A released row can't be charged.
    await expect(
      budget.chargeChatStep('o1', id, { modelId: MODEL, usage: { inputTokens: 1 } }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
  });

  it('refuses a run that isn’t the workspace’s', async () => {
    await expect(
      budget.reserveChatStep('o1', step({ runId: '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7cff' })),
    ).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
    expect(ledger).toEqual([]);
  });

  it('holds nothing, and meters nothing, while Chat is off for the workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    await expect(budget.reserveChatStep('o1', step())).rejects.toMatchObject({
      statusCode: 403,
      code: 'chat_off',
    });
    expect(rpcCalls).toEqual([]);
    expect(ledger).toEqual([]);
    expect((await guard.getAiUsage('o1')).chatMetered).toBe(false);
  });

  it('prices a step from the synced catalog, but never at a $0 rate for a paid model', async () => {
    const cache = await import('./model-price-cache.js');
    const SONNET = 'anthropic/claude-sonnet-5.5';
    // The synced price is used: $3 / $15 per million tokens.
    cache.setSyncedPrices([{ model_id: SONNET, input_per_m: 3, output_per_m: 15, overrides: [] }]);
    await budget.reserveChatStep('o1', step({ modelId: SONNET }));
    expect(rpcCalls[0].args.p_cost).toBeCloseTo(0.021, 9);
    // Listed at $0: the server's table prices it ($2 / $10), hold and charge alike.
    cache.setSyncedPrices([{ model_id: SONNET, input_per_m: 0, output_per_m: 0, overrides: [] }]);
    const id = await budget.reserveChatStep('o1', step({ modelId: SONNET }));
    expect(rpcCalls[1].args.p_cost).toBeCloseTo(0.014, 9);
    await budget.chargeChatStep('o1', id, {
      modelId: SONNET,
      usage: { inputTokens: 1000, outputTokens: 100 },
    });
    expect(ledger.find((r) => r.id === id).cost_usd).toBeCloseTo(0.003, 9);
    cache.setSyncedPrices([]);
  });

  it('writes each step without a hold where nothing is metered (self-hosted)', async () => {
    vi.stubEnv('IS_CLOUD', 'false');
    spent(100);
    const id = await budget.reserveChatStep('o1', step());
    expect(rpcCalls[0].args).toMatchObject({ p_budget: null, p_since: null });
    expect(ledger).toContainEqual(expect.objectContaining({ id, feature: 'chat' }));
  });
});

describe('with purchased AI credits (CHAT-18 §F)', () => {
  /** A paid pack's grant: dollars of model cost, valid until `expires`. */
  const grant = (id, total, { used = 0, expires = '2027-09-01T00:00:00.000Z' } = {}) =>
    grants.push({
      id,
      organization_id: 'o1',
      usd_total: total,
      usd_used: used,
      expires_at: expires,
      created_at: '2026-09-01T00:00:00.000Z',
    });
  const rowsOf = (grantId) => ledger.filter((r) => (r.grant_id ?? null) === grantId);
  const usedOf = (id) => grants.find((g) => g.id === id).usd_used;
  const charge = (id, inputTokens, outputTokens) =>
    budget.chargeChatStep('o1', id, { modelId: MODEL, usage: { inputTokens, outputTokens } });

  it('starts a step on the credits once the month’s included budget is spent, and draws its cost from them', async () => {
    spent(5);
    grant('g1', 5);
    const id = await budget.reserveChatStep('o1', step());
    // Starter's $5, plus the $5 left on the grant.
    expect(rpcCalls[0].args.p_budget).toBe(10);

    await charge(id, 1800, 400);
    // All of it past the included budget: the row is the grant's.
    expect(ledger.find((r) => r.id === id)).toMatchObject({ cost_usd: 0.0038, grant_id: 'g1' });
    expect(usedOf('g1')).toBeCloseTo(0.0038, 9);
    // The meter shows the included limit used, as before.
    expect((await guard.getAiUsage('o1')).percentUsed).toBe(100);
  });

  it('uses the included budget first, then the grant ending soonest, splitting the step that crosses', async () => {
    spent(4.998);
    grant('late', 5, { expires: '2027-10-01T00:00:00.000Z' });
    grant('soon', 5, { expires: '2027-03-01T00:00:00.000Z' });
    const id = await budget.reserveChatStep('o1', step());
    await charge(id, 1800, 400);

    // $0.0038: $0.002 left on the included budget, the rest on the soonest grant.
    expect(ledger.find((r) => r.id === id)).toMatchObject({
      cost_usd: 0.002,
      input_tokens: 1800,
      chat_run_id: RUN,
    });
    expect(ledger.find((r) => r.id === id).grant_id ?? null).toBeNull();
    expect(rowsOf('soon')).toEqual([
      expect.objectContaining({
        cost_usd: 0.0018,
        feature: 'chat',
        chat_run_id: RUN,
        own_key: false,
      }),
    ]);
    expect(rowsOf('soon')[0].used_at).toBe(ledger.find((r) => r.id === id).used_at);
    expect(usedOf('soon')).toBeCloseTo(0.0018, 9);
    expect(usedOf('late')).toBe(0);
    // What was spent is what the step cost: nothing lost, nothing counted twice.
    expect(nonOwnSpend()).toBeCloseTo(4.998 + 0.0038, 9);
  });

  it('moves on to the next grant when one runs out', async () => {
    spent(5);
    grant('soon', 5, { used: 4.999, expires: '2027-03-01T00:00:00.000Z' });
    grant('late', 5, { expires: '2027-10-01T00:00:00.000Z' });
    const id = await budget.reserveChatStep('o1', step());
    await charge(id, 1800, 400);

    expect(ledger.find((r) => r.id === id)).toMatchObject({ cost_usd: 0.001, grant_id: 'soon' });
    expect(rowsOf('late')).toEqual([expect.objectContaining({ cost_usd: 0.0028 })]);
    expect(usedOf('soon')).toBe(5);
    expect(usedOf('late')).toBeCloseTo(0.0028, 9);
  });

  it('never starts a step the included budget and the credits left can’t cover', async () => {
    spent(5);
    grant('g1', 5, { used: 4.995 });
    // $0.005 left; the step may cost $0.007.
    await expect(budget.reserveChatStep('o1', step())).rejects.toMatchObject({ statusCode: 429 });
    expect(rpcCalls[0].args.p_budget).toBeCloseTo(5.005, 9);
  });

  it('keeps credits through the monthly reset, and leaves out a grant that has ended', async () => {
    // $2 of this grant was used last period; it still has $3.
    grant('g1', 5, { used: 2 });
    ledger.push({
      id: 'september',
      feature: 'chat',
      cost_usd: 2,
      own_key: false,
      grant_id: 'g1',
      used_at: '2026-10-01T00:00:00.000Z',
    });
    grant('ended', 50, { expires: '2026-10-25T00:00:00.000Z' });
    spent(5);
    await budget.reserveChatStep('o1', step());
    // The included $5 and g1's $3: the ended grant adds nothing.
    expect(rpcCalls[0].args.p_budget).toBe(8);
  });

  it('counts this period’s draws back in, so a grant’s use isn’t counted twice', async () => {
    grant('g1', 5);
    spent(5);
    const first = await budget.reserveChatStep('o1', step());
    await charge(first, 2000, 1000);
    const second = await budget.reserveChatStep('o1', step());
    // Spent: $5 included + $0.007 on g1 (+ the hold). The budget: $5 + $4.993 left + $0.007 drawn.
    const holds = rpcCalls.filter((c) => c.fn === 'reserve_chat_ai_usage');
    expect(holds[1].args.p_budget).toBeCloseTo(10, 9);
    await charge(second, 2000, 1000);
    expect(usedOf('g1')).toBeCloseTo(0.014, 9);
    expect(rowsOf('g1')).toHaveLength(2);
  });

  it('never draws a step on the workspace’s own key from the credits', async () => {
    spent(5);
    grant('g1', 5);
    const id = await budget.reserveChatStep('o1', step({ ownKey: true }));
    await charge(id, 1800, 400);
    expect(usedOf('g1')).toBe(0);
    expect(rowsOf('g1')).toEqual([]);
  });

  it('draws the other AI features’ calls past the included budget from the credits too', async () => {
    spent(5);
    grant('g1', 5);
    const meter = await guard.reserveAiBudget('o1', { feature: 'content', modelId: MODEL });
    expect(rpcCalls.find((c) => c.fn === 'reserve_ai_usage').args.p_budget).toBe(10);
    await meter.charge({ inputTokens: 1800, outputTokens: 400 });
    expect(rowsOf('g1')).toEqual([
      expect.objectContaining({ feature: 'content', cost_usd: 0.0038 }),
    ]);
    expect(usedOf('g1')).toBeCloseTo(0.0038, 9);
  });

  it('tells the meter credits are left, and counts them in the Improve tab’s quota', async () => {
    spent(5);
    ledger[0].organization_id = 'o1';
    expect((await guard.getAiUsage('o1')).creditsLeft).toBe(false);
    expect((await guard.getImproveQuotaStatus('o1', MODEL)).remainingUsd).toBe(0);

    grant('g1', 5, { used: 1 });
    const usage = await guard.getAiUsage('o1');
    // The plan's share is used up, but calls still run on the credits.
    expect(usage).toMatchObject({ percentUsed: 100, creditsLeft: true });
    // A boolean only: no dollars reach the page.
    expect(JSON.stringify(usage)).not.toMatch(/"(usd|credit)[a-z]*":\s*\d/i);
    const quota = await guard.getImproveQuotaStatus('o1', MODEL);
    expect(quota.remainingUsd).toBeCloseTo(4, 9);
    expect(quota.percentLeft).toBe(80);

    // Used up, or ended: none left.
    grants[0].usd_used = 5;
    expect((await guard.getAiUsage('o1')).creditsLeft).toBe(false);
    grants[0].usd_used = 1;
    grants[0].expires_at = '2026-10-28T00:00:00.000Z';
    expect((await guard.getAiUsage('o1')).creditsLeft).toBe(false);
  });

  it('reads no credits while Chat is off: the budget is the plan’s', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    spent(5);
    grant('g1', 5);
    await expect(
      guard.reserveAiBudget('o1', { feature: 'content', modelId: MODEL }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(rpcCalls.find((c) => c.fn === 'reserve_ai_usage').args.p_budget).toBe(5);
    expect(usedOf('g1')).toBe(0);
  });
});
