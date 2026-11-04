// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chat-fixtures';

/**
 * An agent running another saved agent (CHAT-27 phase 2, items 14–18;
 * W4-26): only from an agent's run, only an agent its Can call names and
 * that is on, never a chain (a called run can't call) and at most 3 calls
 * a run; the called agent runs as its own run on the caller's brand, in
 * the stricter of the two modes, with a cap no bigger than what is left of
 * the caller's; its answer comes back as untrusted data; the caller's Stop
 * stops it. The Chat engine and the agent driver are stand-ins.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/mcp/account', () => ({ getAiUsageFor: vi.fn(async () => null) }));
vi.mock('./agent-shares', () => ({ readAgentShares: vi.fn(async () => null) }));
const driver = vi.hoisted(() => ({
  open: vi.fn(),
  settle: vi.fn(async () => null),
}));
vi.mock('./agent-driver', () => ({
  openAgentRun: driver.open,
  settleAgentRun: driver.settle,
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const calls = await import('./agent-calls');

const CALLER = 'abababab-0000-4000-8000-000000000001';
const CALLEE = 'abababab-0000-4000-8000-000000000002';
const OTHER = 'abababab-0000-4000-8000-000000000003';
const CALLER_RUN = 'eeeeeeee-0000-4000-8000-000000000001';
const CALLER_CHAT_RUN = 'r-caller';
const NOW = new Date('2026-11-03T06:00:00.000Z');

function agent(id: string, name: string, over: Record<string, unknown> = {}) {
  db.tables.chat_agents.push({
    id,
    organization_id: ORG,
    name,
    status: 'active',
    paused_reason: null,
    owner_id: PEOPLE.admin,
    visibility: 'workspace',
    version: 1,
    max_run_share: 0.1,
    max_month_share: null,
    created_by: PEOPLE.admin,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    activated_at: '2026-10-01T00:00:00.000Z',
    archived_at: null,
    ...over,
  });
}

function version(agentId: string, over: Record<string, unknown> = {}) {
  db.tables.chat_agent_versions.push({
    agent_id: agentId,
    version: 1,
    skill_ids: ['winback'],
    instructions: null,
    mode: 'full_auto',
    connections: [],
    model: 'auto',
    effort: 'normal',
    scope: { brand_ids: [BRAND] },
    notify_user_ids: [],
    followup_days: 14,
    can_call: [],
    created_at: '2026-10-01T00:00:00.000Z',
    ...over,
  });
}

/** The caller's agent run and its chat, as the driver made them. */
function callerRun(over: Record<string, unknown> = {}) {
  db.tables.chat_agent_runs.push({
    id: CALLER_RUN,
    organization_id: ORG,
    agent_id: CALLER,
    agent_version: 1,
    brand_id: BRAND,
    trigger_kind: 'schedule',
    acting_user_id: PEOPLE.manager,
    called_by_run_id: null,
    status: 'running',
    max_share: 0.1,
    usage_share: 0.03,
    queued_at: NOW.toISOString(),
    ...over,
  });
  db.tables.chat_conversations.push({ id: 'c-caller', agent_run_id: CALLER_RUN });
  db.tables.chat_runs.push({
    id: CALLER_CHAT_RUN,
    conversation_id: 'c-caller',
    status: 'running',
    message_id: 'm-caller',
  });
  db.tables.chat_run_state.push({ run_id: CALLER_CHAT_RUN, heartbeat_at: NOW.toISOString() });
}

const ctx = { userId: PEOPLE.manager, organizationId: ORG, callerChatRunId: CALLER_CHAT_RUN };
const calleeRuns = () => db.tables.chat_agent_runs.filter((r) => r.called_by_run_id === CALLER_RUN);

/** The engine as a stand-in: the called run answers, or waits on its caller's Stop. */
function deps(over: Partial<Parameters<typeof calls.runCalledAgent>[2]> = {}) {
  let clock = NOW.getTime();
  return {
    drive: vi.fn(async (_actor: unknown, chatRunId: string) => {
      const run = db.tables.chat_runs.find((r) => r.id === chatRunId)!;
      run.status = 'done';
      db.tables.chat_messages.push({
        id: run.message_id,
        content_md: 'Drafted the FAQ for /pricing.',
      });
    }),
    stop: vi.fn(async () => ({ ok: true })),
    now: () => new Date(clock),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  seedWorkspace(db);
  db.tables.brands = [{ id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false }];
  db.tables.member_brands = [];
  db.tables.chat_agents = [];
  db.tables.chat_agent_versions = [];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
  db.tables.chat_runs = [];
  db.tables.chat_run_state = [];
  db.tables.chat_messages = [];
  db.unique = { ...db.unique, chat_agent_runs: [] };
  agent(CALLER, 'Weekly report');
  agent(CALLEE, 'FAQ writer', { max_run_share: 0.2 });
  agent(OTHER, 'Rival brief', { status: 'archived' });
  version(CALLER, { mode: 'auto', can_call: [CALLEE, OTHER] });
  version(CALLEE);
  version(OTHER);
  // The driver makes the called run's chat, as openAgentRun does.
  driver.open.mockImplementation(async (runId: string) => {
    db.tables.chat_conversations.push({ id: 'c-callee', agent_run_id: runId });
    db.tables.chat_runs.push({
      id: 'r-callee',
      conversation_id: 'c-callee',
      status: 'running',
      message_id: 'm-callee',
    });
    return {
      agentRunId: runId,
      organizationId: ORG,
      chatRunId: 'r-callee',
      actor: { userId: PEOPLE.manager, email: null, organizationId: ORG },
    };
  });
});

describe('pure rules', () => {
  it('takes the stricter mode, and a cap no bigger than what is left of the caller’s', () => {
    expect(calls.stricterMode('full_auto', 'auto')).toBe('auto');
    expect(calls.stricterMode('ask_first', 'full_auto')).toBe('ask_first');
    expect(calls.calleeShare(0.2, 0.1, 0.03)).toBe(0.07);
    expect(calls.calleeShare(0.05, 0.1, 0.03)).toBe(0.05);
    expect(calls.calleeShare(0.1, 0.1, 0.1)).toBe(0);
    expect(calls.callScopeOf({ call: { agent: 'A', ask: 'Do it', mode: 'oops' } })).toEqual({
      agent: 'A',
      ask: 'Do it',
      mode: 'ask_first',
    });
    expect(calls.callScopeOf({ fires: [] })).toBeNull();
  });
});

describe('callableAgentsOf', () => {
  it('names the agents its Can call lists that are on, never a called run’s', async () => {
    callerRun();
    expect(await calls.callableAgentsOf(CALLER_RUN)).toEqual([{ id: CALLEE, name: 'FAQ writer' }]);
    db.tables.chat_agent_runs[0].called_by_run_id = 'eeeeeeee-0000-4000-8000-000000000009';
    expect(await calls.callableAgentsOf(CALLER_RUN)).toEqual([]);
  });
});

describe('runCalledAgent', () => {
  it('runs the agent as its own run, on the caller’s brand, stricter mode, a slice of the caller’s cap', async () => {
    callerRun();
    const d = deps();
    const result = await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'Draft the FAQ' }, d);
    expect(result).toMatchObject({
      ok: true,
      agent: 'FAQ writer',
      chat_href: '/dashboard/chat/c-callee',
    });
    // Another agent's words come back as data, never instructions.
    expect((result as { answer: string }).answer).toMatch(
      /^<untrusted_data source="agent:FAQ writer">[\s\S]*Drafted the FAQ for \/pricing\.[\s\S]*<\/untrusted_data>$/,
    );
    const [run] = calleeRuns();
    expect(run).toMatchObject({
      agent_id: CALLEE,
      brand_id: BRAND,
      trigger_kind: 'agent',
      acting_user_id: PEOPLE.manager,
      status: 'running',
      // 0.1 of the caller's cap, 0.03 used: 0.07 is left, under the callee's own 0.2.
      max_share: 0.07,
      evidence_json: { call: { agent: 'Weekly report', mode: 'auto', ask: 'Draft the FAQ' } },
    });
    expect(driver.open).toHaveBeenCalledWith(run.id, ORG, expect.any(Date));
    expect(d.drive).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PEOPLE.manager }),
      'r-callee',
    );
    expect(driver.settle).toHaveBeenCalledWith(run.id, expect.anything());
  });

  it('refuses a person’s own chat, a chain, an agent not in Can call or off, and a fourth call', async () => {
    const d = deps();
    // Not an agent's run.
    db.tables.chat_runs.push({ id: 'r-own', conversation_id: 'c-own', status: 'running' });
    db.tables.chat_conversations.push({ id: 'c-own', agent_run_id: null });
    expect(
      await calls.runCalledAgent(
        { ...ctx, callerChatRunId: 'r-own' },
        { agent: CALLEE, ask: 'x' },
        d,
      ),
    ).toMatchObject({ ok: false, reason: 'invalid' });

    callerRun();
    expect(await calls.runCalledAgent(ctx, { agent: OTHER, ask: 'x' }, d)).toMatchObject({
      ok: false,
      reason: 'not_found',
      message: expect.stringContaining(`FAQ writer (${CALLEE})`),
    });
    for (let i = 0; i < 3; i++) {
      db.tables.chat_agent_runs.push({
        id: `eeeeeeee-0000-4000-8000-00000000010${i}`,
        organization_id: ORG,
        agent_id: CALLEE,
        called_by_run_id: CALLER_RUN,
        trigger_kind: 'agent',
        status: 'done',
      });
    }
    expect(await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, d)).toMatchObject({
      ok: false,
      reason: 'quota_exceeded',
    });

    // A called run can't call further.
    db.tables.chat_agent_runs = db.tables.chat_agent_runs.filter((r) => r.id === CALLER_RUN);
    db.tables.chat_agent_runs[0].called_by_run_id = 'eeeeeeee-0000-4000-8000-000000000009';
    expect(await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, d)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(d.drive).not.toHaveBeenCalled();
  });

  it('refuses when the caller’s cap has no room, or the called agent doesn’t cover the brand', async () => {
    callerRun({ usage_share: 0.095 });
    const d = deps();
    expect(await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, d)).toMatchObject({
      ok: false,
      reason: 'quota_exceeded',
    });
    db.tables.chat_agent_runs[0].usage_share = 0;
    db.tables.chat_agent_versions.find((v) => v.agent_id === CALLEE)!.scope = {
      brand_ids: ['22222222-2222-4222-8222-999999999999'],
    };
    expect(await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, d)).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    expect(calleeRuns()).toEqual([]);
  });

  it('takes what the agents it ran before used out of the caller’s cap', async () => {
    callerRun({ usage_share: 0.01 });
    db.tables.chat_agent_runs.push({
      id: 'eeeeeeee-0000-4000-8000-000000000100',
      organization_id: ORG,
      agent_id: OTHER,
      called_by_run_id: CALLER_RUN,
      trigger_kind: 'agent',
      status: 'done',
      usage_share: 0.06,
    });
    await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, deps());
    // 0.1 of the caller's cap: 0.01 it used, 0.06 the agent it ran before used.
    expect(calleeRuns().find((r) => r.agent_id === CALLEE)).toMatchObject({ max_share: 0.03 });
  });

  it('refuses an agent the person the caller acts as can’t see or run', async () => {
    callerRun();
    // An Admin's private agent, in Can call; the caller acts as a Manager.
    db.tables.chat_agents.find((a) => a.id === CALLEE)!.visibility = 'private';
    const d = deps();
    expect(await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, d)).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    expect(calleeRuns()).toEqual([]);
    expect(driver.open).not.toHaveBeenCalled();
  });

  it('refuses anyone but the person the caller acts as, and a role or plan that can’t run agents', async () => {
    callerRun();
    const d = deps();
    expect(
      await calls.runCalledAgent(
        { ...ctx, userId: PEOPLE.analyst },
        { agent: CALLEE, ask: 'x' },
        d,
      ),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.role = 'analyst';
    expect(await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, d)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.role = 'manager';
    db.tables.organizations.find((o) => o.id === ORG)!.plan = 'starter';
    expect(await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, d)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(calleeRuns()).toEqual([]);
  });

  it('stops the called agent when the caller is stopped, and after 4 minutes', async () => {
    callerRun();
    let release: () => void = () => {};
    const hanging = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    const stopOnCaller = deps({
      drive: vi.fn(hanging),
      stop: vi.fn(async () => {
        release();
        return { ok: true };
      }),
      sleep: vi.fn(async () => {
        db.tables.chat_runs.find((r) => r.id === CALLER_CHAT_RUN)!.status = 'stopped';
      }),
    });
    await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, stopOnCaller);
    expect(stopOnCaller.stop).toHaveBeenCalledWith(expect.anything(), 'r-callee');

    // Long enough: it is stopped at 4 minutes, and says so.
    db.tables.chat_runs.find((r) => r.id === CALLER_CHAT_RUN)!.status = 'running';
    db.tables.chat_agent_runs = db.tables.chat_agent_runs.filter((r) => r.id === CALLER_RUN);
    db.tables.chat_conversations = db.tables.chat_conversations.filter((c) => c.id === 'c-caller');
    db.tables.chat_runs = db.tables.chat_runs.filter((r) => r.id === CALLER_CHAT_RUN);
    let clock = NOW.getTime();
    const slow = deps({
      drive: vi.fn(hanging),
      stop: vi.fn(async () => {
        release();
        return { ok: true };
      }),
      now: () => new Date(clock),
      sleep: vi.fn(async (ms: number) => {
        clock += ms * 20;
      }),
    });
    const result = await calls.runCalledAgent(ctx, { agent: CALLEE, ask: 'x' }, slow);
    expect(result).toMatchObject({ ok: true, status: 'timed_out' });
    // Meanwhile the caller's run stayed alive for the sweep.
    expect(
      Date.parse(
        db.tables.chat_run_state.find((s) => s.run_id === CALLER_CHAT_RUN)!.heartbeat_at as string,
      ),
    ).toBeGreaterThan(NOW.getTime());
  });
});
