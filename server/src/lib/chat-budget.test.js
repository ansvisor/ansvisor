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
 * within the budget; own-key rows left out of every sum.
 */

const RUN = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c01';
const STEP = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c02';
// Priced from improve-cost's own table: $1 / $5 per million tokens.
const MODEL = 'anthropic/claude-haiku-4-5';

let org;
let ledger;
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

function query(table) {
  const op = { kind: 'select', filters: [] };
  const matches = (r) =>
    op.filters.every(([kind, col, val]) => (kind === 'in' ? val.includes(r[col]) : r[col] === val));
  const run = () => {
    if (table === 'organizations') return { data: org, error: null };
    if (op.kind === 'update') {
      const hit = ledger.filter(matches);
      hit.forEach((r) => Object.assign(r, op.value));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (op.kind === 'delete') {
      ledger = ledger.filter((r) => !matches(r));
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
  const builder = {
    select: () => builder,
    eq: (col, val) => (op.filters.push(['eq', col, val]), builder),
    in: (col, val) => (op.filters.push(['in', col, val]), builder),
    update: (value) => (Object.assign(op, { kind: 'update', value }), builder),
    delete: () => (Object.assign(op, { kind: 'delete' }), builder),
    maybeSingle: () => builder,
    single: () => builder,
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

  it("prices the prompt cache's reads below the input and its writes above it, and keeps both", async () => {
    const id = await budget.reserveChatStep('o1', step());
    // 2,000 tokens in: 1,500 read from the cache, 300 written to it, 200 plain; 400 out.
    await budget.chargeChatStep('o1', id, {
      modelId: MODEL,
      usage: { inputTokens: 2000, outputTokens: 400, cacheReadTokens: 1500, cacheWriteTokens: 300 },
      latencyMs: 2140,
    });
    // Haiku 4.5: $1 in, $0.10 a cache read, $1.25 a cache write, $5 out (per million).
    const cost = (200 * 1 + 300 * 1.25 + 1500 * 0.1 + 400 * 5) / 1_000_000;
    expect(ledger).toEqual([
      expect.objectContaining({
        id,
        input_tokens: 2000,
        output_tokens: 400,
        cache_read_tokens: 1500,
        cache_write_tokens: 300,
        latency_ms: 2140,
      }),
    ]);
    expect(ledger[0].cost_usd).toBeCloseTo(cost, 12);
    // Below the same step with no cache, which its hold assumed.
    expect(ledger[0].cost_usd).toBeLessThan((2000 * 1 + 400 * 5) / 1_000_000);
  });

  it('never prices a cache read below its cost: an unknown rate is the input rate, and counts are held to the input', async () => {
    const cache = await import('./model-price-cache.js');
    const SONNET = 'anthropic/claude-sonnet-5.5';
    // Synced without a cache-read rate: its reads cost the input price.
    cache.setSyncedPrices([{ model_id: SONNET, input_per_m: 3, output_per_m: 15, overrides: [] }]);
    const id = await budget.reserveChatStep('o1', step({ modelId: SONNET }));
    await budget.chargeChatStep('o1', id, {
      modelId: SONNET,
      usage: { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 1000 },
    });
    expect(ledger.find((r) => r.id === id).cost_usd).toBeCloseTo(0.003, 12);
    // Synced with one: $0.30 a cache read.
    cache.setSyncedPrices([
      { model_id: SONNET, input_per_m: 3, output_per_m: 15, cache_read_per_m: 0.3, overrides: [] },
    ]);
    const second = await budget.reserveChatStep('o1', step({ modelId: SONNET }));
    // A provider's cache count past the input: held to the input.
    await budget.chargeChatStep('o1', second, {
      modelId: SONNET,
      usage: { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 5000, cacheWriteTokens: 50 },
    });
    expect(ledger.find((r) => r.id === second)).toMatchObject({
      cache_read_tokens: 1000,
      cache_write_tokens: 0,
    });
    expect(ledger.find((r) => r.id === second).cost_usd).toBeCloseTo(0.0003, 12);
    cache.setSyncedPrices([]);
  });

  it('keeps the hold when only one of input and output was reported', async () => {
    const id = await budget.reserveChatStep('o1', step());
    await budget.chargeChatStep('o1', id, { modelId: MODEL, usage: { outputTokens: 10 } });
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
