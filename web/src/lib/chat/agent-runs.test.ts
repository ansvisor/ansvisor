// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chat-fixtures';

/**
 * Run now (CHAT-21 §E Manual, §H, §M): one queued run per brand of the
 * agent's scope, acting as the person who clicked; a second click within a
 * minute is the first, past 3 waiting a click joins the last. A slot is
 * tried with the plan's runs at once only when a driver can run what
 * starts; without one, the runs wait queued.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/mcp/account', () => ({
  getAiUsageFor: vi.fn(async () => ({ active_plan: true, unlimited: false, percent_used: 5 })),
}));
vi.mock('./key', () => ({ resolveChatModelKey: vi.fn(async () => ({ source: 'ansvisor' })) }));
vi.mock('./agent-shares', () => ({ readAgentShares: vi.fn(async () => null) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const agents = await import('./agents');
const runs = await import('./agent-runs');
const { createAgentInput } = await import('./agent-rules');

const NOW = new Date('2026-10-29T12:00:00.000Z');
const BRAND_2 = '33333333-3333-4333-8333-333333333333';
const DEMO = '66666666-6666-4666-8666-666666666666';

const ctxOf = async (userId: string) =>
  (await agents.readAgentContext({ userId, email: null, organizationId: ORG }))!;

async function agentOf(userId: string, over: Record<string, unknown> = {}) {
  const result = await agents.createAgent(
    await ctxOf(userId),
    createAgentInput.parse({
      name: `Agent ${Math.random()}`,
      skills: ['winback'],
      scope: { all_brands: true },
      ...over,
    }),
    NOW,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.value.id;
}

const runRows = () => db.tables.chat_agent_runs ?? [];

/** chat_start_next_agent_run on the fake: the oldest queued, manual first, under the limit. */
function startNext(args: Record<string, unknown>) {
  const running = runRows().filter((r) => r.status === 'running').length;
  if (running >= (args.p_workspace_limit as number)) return null;
  const queued = runRows()
    .filter((r) => r.status === 'queued')
    .sort((a, b) => Number(b.trigger_kind === 'manual') - Number(a.trigger_kind === 'manual'));
  if (!queued[0]) return null;
  queued[0].status = 'running';
  return queued[0].id;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  db.unique = { ...db.unique, chat_agents: [['organization_id', 'name']] };
  const iso = () => NOW.toISOString();
  db.defaults = {
    ...db.defaults,
    chat_agents: () => ({
      created_at: iso(),
      updated_at: iso(),
      activated_at: null,
      archived_at: null,
      paused_reason: null,
    }),
    chat_agent_triggers: () => ({ created_at: iso(), last_fired_at: null }),
  };
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false },
    { id: BRAND_2, organization_id: ORG, name: 'Brand B', is_demo: false },
    { id: DEMO, organization_id: ORG, name: 'Demo', is_demo: true },
  ];
  db.tables.chat_agents = [];
  db.tables.chat_agent_versions = [];
  db.tables.chat_agent_triggers = [];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
  db.rpcs = { chat_start_next_agent_run: startNext };
});

afterEach(() => vi.unstubAllEnvs());

describe('Run now', () => {
  it('queues a run per brand of its scope, as the person, never on the demo brand', async () => {
    const id = await agentOf(PEOPLE.manager, { maxRunShare: 0.2 });
    const result = await runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, null);
    expect(result).toEqual({
      ok: true,
      value: {
        runs: [
          { brand: 'Brand A', status: 'queued', repeated: false, coalesced: false },
          { brand: 'Brand B', status: 'queued', repeated: false, coalesced: false },
        ],
      },
    });
    expect(runRows()).toEqual([
      expect.objectContaining({
        agent_id: id,
        agent_version: 1,
        brand_id: BRAND,
        trigger_kind: 'manual',
        acting_user_id: PEOPLE.manager,
        status: 'queued',
        max_share: 0.2,
      }),
      expect.objectContaining({ brand_id: BRAND_2 }),
    ]);
    // No driver yet: nothing is started, so no run holds a slot it can't use.
    expect(db.log.filter(([name]) => name === 'chat_start_next_agent_run')).toEqual([]);
    const logged = db.tables.chat_activity_log.filter((r) => r.summary_key === 'agentRunQueued');
    expect(logged.map((r) => [r.agent_id, r.agent_run_id, r.brand_id])).toEqual([
      [id, runRows()[0].id, BRAND],
      [id, runRows()[1].id, BRAND_2],
    ]);
  });

  it('runs a draft or paused agent by hand, one brand when named, never one outside its scope', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const ctx = await ctxOf(PEOPLE.manager);
    expect(await runs.runAgentNow(ctx, id, { brandId: BRAND_2 }, NOW, null)).toMatchObject({
      ok: false,
      refusal: { code: 'brand_not_found' },
    });
    const one = await runs.runAgentNow(ctx, id, { brandId: BRAND }, NOW, null);
    expect(one).toMatchObject({ ok: true, value: { runs: [{ brand: 'Brand A' }] } });
  });

  it('starts it in a free slot when a driver can take it, with the plan’s runs at once', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const driver = vi.fn(async () => {});
    const result = await runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, driver);
    expect(result).toMatchObject({ ok: true, value: { runs: [{ status: 'running' }] } });
    const started = runRows()[0];
    expect(driver).toHaveBeenCalledWith({ id: started.id, organizationId: ORG });
    // Growth: 5 agent runs at once.
    expect(db.log.filter(([name]) => name === 'chat_start_next_agent_run').length).toBeGreaterThan(
      0,
    );
  });

  it('keeps the plan’s runs at once: the trial’s one slot, the rest wait', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    const id = await agentOf(PEOPLE.manager);
    const calls: unknown[] = [];
    db.rpcs.chat_start_next_agent_run = (args) => {
      calls.push(args.p_workspace_limit);
      return startNext(args);
    };
    const result = await runs.runAgentNow(
      await ctxOf(PEOPLE.manager),
      id,
      {},
      NOW,
      vi.fn(async () => {}),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { runs: [{ status: 'running' }, { status: 'queued' }] },
    });
    expect(calls).toEqual([1]);
  });

  it('fails a run the driver can’t take, which frees its place', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const result = await runs.runAgentNow(
      await ctxOf(PEOPLE.manager),
      id,
      {},
      NOW,
      vi.fn(async () => {
        throw new Error('engine down');
      }),
    );
    expect(result).toMatchObject({ ok: true, value: { runs: [{ status: 'failed' }] } });
  });

  it('answers a second click within a minute with the first run, and joins a fourth to the last', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const ctx = await ctxOf(PEOPLE.manager);
    await runs.runAgentNow(ctx, id, {}, NOW, null);
    const again = await runs.runAgentNow(ctx, id, {}, new Date(NOW.getTime() + 30_000), null);
    expect(again).toMatchObject({ ok: true, value: { runs: [{ repeated: true }] } });
    expect(runRows()).toHaveLength(1);

    // An Admin's clicks, a minute apart: three wait, the fourth joins the last.
    const admin = await ctxOf(PEOPLE.admin);
    for (let i = 1; i <= 3; i++) {
      await runs.runAgentNow(admin, id, {}, new Date(NOW.getTime() + i * 61_000), null);
    }
    expect(runRows()).toHaveLength(3);
    const joined = await runs.runAgentNow(admin, id, {}, new Date(NOW.getTime() + 300_000), null);
    expect(joined).toMatchObject({ ok: true, value: { runs: [{ coalesced: true }] } });
    expect(runRows()).toHaveLength(3);
  });

  it('queues one run for two clicks at once by the same person', async () => {
    const id = await agentOf(PEOPLE.manager, { scope: { brand_ids: [BRAND] } });
    const ctx = await ctxOf(PEOPLE.manager);
    const [a, b] = await Promise.all([
      runs.runAgentNow(ctx, id, {}, NOW, null),
      runs.runAgentNow(ctx, id, {}, NOW, null),
    ]);
    expect(runRows()).toHaveLength(1);
    expect([a, b].map((r) => (r.ok ? r.value.runs[0].repeated : null)).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      db.tables.chat_activity_log.filter((r) => r.summary_key === 'agentRunQueued'),
    ).toHaveLength(1);
  });

  it('keeps 3 waiting when two people click at once on a queue of 2', async () => {
    const id = await agentOf(PEOPLE.admin, {
      visibility: 'workspace',
      scope: { brand_ids: [BRAND] },
    });
    for (const [n, person] of [PEOPLE.admin, PEOPLE.otherManager].entries()) {
      db.tables.chat_agent_runs.push({
        id: `00000000-0000-4000-8000-00000000000${n}`,
        agent_id: id,
        brand_id: BRAND,
        trigger_kind: 'schedule',
        acting_user_id: person,
        status: 'queued',
        queued_at: '2026-10-29T11:00:00.000Z',
      });
    }
    const [a, b] = await Promise.all([
      runs.runAgentNow(await ctxOf(PEOPLE.manager), id, {}, NOW, null),
      runs.runAgentNow(await ctxOf(PEOPLE.admin), id, {}, NOW, null),
    ]);
    expect(runRows().filter((r) => r.status === 'queued')).toHaveLength(3);
    const results = [a, b].map((r) => (r.ok ? r.value.runs[0] : null));
    expect(results.filter((r) => r?.coalesced)).toHaveLength(1);
    // Only the run that stayed is in the log.
    expect(
      db.tables.chat_activity_log.filter((r) => r.summary_key === 'agentRunQueued'),
    ).toHaveLength(1);
  });

  it('refuses Analysts, a teammate’s private agent, and an archived agent', async () => {
    const id = await agentOf(PEOPLE.manager, { visibility: 'workspace' });
    expect(await runs.runAgentNow(await ctxOf(PEOPLE.analyst), id, {}, NOW, null)).toMatchObject({
      ok: false,
      refusal: {
        kind: 'denied',
        status: 403,
        code: 'forbidden_role',
        denial: { asked: 'You asked: Run an agent now.' },
      },
    });
    // A workspace agent: any Manager may run it.
    expect((await runs.runAgentNow(await ctxOf(PEOPLE.otherManager), id, {}, NOW, null)).ok).toBe(
      true,
    );
    const priv = await agentOf(PEOPLE.manager);
    expect(
      await runs.runAgentNow(await ctxOf(PEOPLE.otherManager), priv, {}, NOW, null),
    ).toMatchObject({ ok: false, refusal: { status: 404 } });
    const ctx = await ctxOf(PEOPLE.manager);
    await agents.changeAgentState(ctx, priv, 'archive');
    expect(await runs.runAgentNow(ctx, priv, {}, NOW, null)).toMatchObject({
      ok: false,
      refusal: { status: 409, code: 'archived' },
    });
  });

  it('refuses a Full auto agent on a plan without it, before anything is queued', async () => {
    const id = await agentOf(PEOPLE.admin, { mode: 'full_auto' });
    db.tables.organizations[0].plan = 'starter';
    expect(await runs.runAgentNow(await ctxOf(PEOPLE.admin), id, {}, NOW, null)).toMatchObject({
      ok: false,
      refusal: { kind: 'denied', code: 'plan_locked' },
    });
    expect(runRows()).toEqual([]);
  });
});

describe('starting queued runs', () => {
  it('starts nothing without a driver, and stops at the first empty answer', async () => {
    expect(await runs.startQueuedAgentRuns(ORG, 5, null)).toEqual([]);
    expect(db.log).toEqual([]);
    db.tables.chat_agent_runs = [
      { id: 'r1', status: 'queued', trigger_kind: 'schedule' },
      { id: 'r2', status: 'queued', trigger_kind: 'manual' },
    ];
    const driver = vi.fn(async () => {});
    expect(await runs.startQueuedAgentRuns(ORG, 5, driver)).toEqual(['r2', 'r1']);
    expect(driver).toHaveBeenCalledTimes(2);
  });
});
