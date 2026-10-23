import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A call's share of the workspace's AI budget is held before it runs
 * (reserve_ai_usage, 00243), so calls at once can't pass a nearly spent
 * budget; the hold becomes the call's real cost, or goes when nothing was
 * charged.
 */

let org;
let reserved;
let rpcCalls;
let ops;
// The org's recent calls this period, newest first (what a hold is sized on).
let recent;

function query(table) {
  const op = { table, kind: 'select', filters: [] };
  const builder = {
    select: () => builder,
    eq: (col, val) => (op.filters.push([col, val]), builder),
    gte: (col, val) => (op.filters.push([col, val]), builder),
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => builder,
    single: () => builder,
    insert: (value) => (Object.assign(op, { kind: 'insert', value }), ops.push(op), builder),
    update: (value) => (Object.assign(op, { kind: 'update', value }), ops.push(op), builder),
    delete: () => (Object.assign(op, { kind: 'delete' }), ops.push(op), builder),
    then: (resolve) =>
      resolve(
        table === 'prompt_improve_usage' && op.kind === 'select'
          ? recent
          : { data: table === 'organizations' ? org : null, error: null },
      ),
  };
  return builder;
}

let guard;

beforeEach(async () => {
  vi.resetModules();
  process.env.IS_CLOUD = 'true';
  org = { plan: 'starter', subscription_status: 'active', subscription_ends_at: null };
  reserved = 'u1';
  recent = { data: [], error: null };
  rpcCalls = [];
  ops = [];
  vi.doMock('../config/supabase.js', () => ({
    default: {
      from: (t) => query(t),
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        return { data: reserved, error: null };
      },
    },
  }));
  vi.doMock('./logger.js', () => ({ logger: { error: vi.fn() } }));
  guard = await import('./plan-guard.js');
});

afterEach(() => {
  delete process.env.IS_CLOUD;
  vi.doUnmock('../config/supabase.js');
  vi.doUnmock('./logger.js');
});

const usage = { inputTokens: 7000, outputTokens: 2000 };

describe('reserveAiBudget', () => {
  it('holds the org’s recent median cost when calls run above the model’s estimate', async () => {
    recent = {
      data: [0.05, 0.021, 0.02, 0.019, 0.004].map((cost_usd) => ({ cost_usd })),
      error: null,
    };
    await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
    });
    expect(rpcCalls[0].args.p_cost).toBe(0.02);
    // Never less than the model's typical cost, nor when the read fails.
    rpcCalls = [];
    recent = { data: [{ cost_usd: 0.001 }], error: null };
    await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
    });
    recent = { data: null, error: { message: 'timeout' } };
    await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
    });
    expect(rpcCalls.map((c) => c.args.p_cost)).toEqual([0.0095, 0.0095]);
  });

  it('holds the estimate on the period’s budget, then turns it into the real cost', async () => {
    const budget = await guard.reserveAiBudget('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
      draftId: 'd1',
    });
    expect(rpcCalls).toEqual([
      {
        fn: 'reserve_ai_usage',
        args: expect.objectContaining({
          p_organization_id: 'o1',
          // Starter's $1, from the period's start.
          p_budget: 1,
          p_since: expect.any(String),
          p_cost: 0.0095,
          p_feature: 'content',
          p_model: 'google/gemini-3-flash-preview',
          p_prompt_id: null,
          p_action_id: null,
          p_content_draft_id: 'd1',
        }),
      },
    ]);

    await budget.charge({ inputTokens: 1000, outputTokens: 500 });
    // The first charge is the hold, at the call's real cost…
    expect(ops).toEqual([
      expect.objectContaining({
        table: 'prompt_improve_usage',
        kind: 'update',
        value: expect.objectContaining({ input_tokens: 1000, cost_usd: 0.002 }),
        filters: [['id', 'u1']],
      }),
    ]);
    // …a retry adds its own row, and nothing is left to release.
    await budget.charge(usage);
    await budget.release();
    expect(ops.map((op) => op.kind)).toEqual(['update', 'insert']);
    expect(ops[1].value).toMatchObject({
      organization_id: 'o1',
      feature: 'content',
      content_draft_id: 'd1',
      input_tokens: 7000,
    });
  });

  it('lets the hold go when nothing was charged', async () => {
    const budget = await guard.reserveAiBudget('o1', {
      feature: 'improve',
      modelId: 'm',
      promptId: 'p1',
    });
    await budget.release();
    await budget.release();
    expect(ops).toEqual([expect.objectContaining({ kind: 'delete', filters: [['id', 'u1']] })]);
  });

  it('refuses once the budget is spent, as the quota did', async () => {
    reserved = null;
    await expect(
      guard.reserveAiBudget('o1', { feature: 'improve', modelId: 'm', promptId: 'p1' }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(ops).toEqual([]);
  });

  it('holds nothing on an unlimited budget, and still writes each charge', async () => {
    delete process.env.IS_CLOUD;
    vi.resetModules();
    guard = await import('./plan-guard.js');
    const budget = await guard.reserveAiBudget('o1', {
      feature: 'action_center',
      modelId: 'm',
      actionId: 'a1',
    });
    expect(rpcCalls).toEqual([]);
    await budget.charge(usage);
    await budget.release();
    expect(ops).toEqual([
      expect.objectContaining({
        kind: 'insert',
        value: expect.objectContaining({ feature: 'action_center', action_id: 'a1' }),
      }),
    ]);
  });
});
