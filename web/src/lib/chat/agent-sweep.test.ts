// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chat-fixtures';

/**
 * The agents' sweep (CHAT-21 §G, §H, §M; W2-16), with an in-memory
 * database: Chat's own sweep first; agent runs follow their Chat runs; runs
 * queued too long stop; 3 failures in a row pause an agent; an agent paused
 * for the AI limit resumes once there is room, and its triggered runs held
 * at the limit stop; each workspace starts what it has room for. With Chat
 * off for a workspace, nothing of it is touched.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const fakes = vi.hoisted(() => ({
  usage: vi.fn(),
  shares: vi.fn(),
  chatSweep: vi.fn(),
  endHeld: vi.fn(),
  onOwnKey: vi.fn(async () => false),
}));
vi.mock('@/lib/mcp/account', () => ({ getAiUsageFor: fakes.usage }));
vi.mock('./key', () => ({
  resolveChatModelKey: vi.fn(async () => ({ source: 'ansvisor' })),
  failingOwnKey: vi.fn(async () => null),
  chatRunsOnOwnKey: fakes.onOwnKey,
}));
vi.mock('./agent-shares', () => ({ readAgentShares: fakes.shares }));
vi.mock('./engine', () => ({
  APPROVAL_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  validTimezone: (value?: string) => value ?? 'UTC',
  driveRun: vi.fn(),
  endHeldRun: fakes.endHeld,
  sweepChatRuns: fakes.chatSweep,
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { sweepAgents, STALE_QUEUE_MS } = await import('./agent-sweep');

const NOW = new Date('2026-11-02T12:00:00.000Z');
const AGENT = 'abababab-0000-4000-8000-000000000001';
const OTHER_AGENT = 'abababab-0000-4000-8000-000000000002';

const runRow = (id: string) => db.tables.chat_agent_runs.find((r) => r.id === id)!;
const agentRow = (id = AGENT) => db.tables.chat_agents.find((a) => a.id === id)!;

let driver: ReturnType<typeof vi.fn>;

function run(id: string, over: Record<string, unknown> = {}) {
  db.tables.chat_agent_runs.push({
    id,
    organization_id: ORG,
    agent_id: AGENT,
    agent_version: 1,
    brand_id: BRAND,
    trigger_kind: 'schedule',
    trigger_ref: null,
    acting_user_id: PEOPLE.manager,
    status: 'running',
    skipped_reason: null,
    stop_reason: null,
    evidence_json: {},
    max_share: 0.1,
    outcome: null,
    queued_at: NOW.toISOString(),
    started_at: NOW.toISOString(),
    finished_at: null,
    ...over,
  });
}

function chatOf(agentRunId: string, status: string, progress: Record<string, unknown> = {}) {
  const convo = `c-${agentRunId}`;
  const chatRun = `r-${agentRunId}`;
  db.tables.chat_conversations.push({ id: convo, agent_run_id: agentRunId });
  db.tables.chat_runs.push({
    id: chatRun,
    status,
    conversation_id: convo,
    message_id: `m-${agentRunId}`,
    effort: 'normal',
    created_at: NOW.toISOString(),
  });
  db.tables.chat_run_state.push({
    run_id: chatRun,
    organization_id: ORG,
    user_id: PEOPLE.manager,
    mode: 'auto',
    messages: [],
    pending: null,
    progress: { text: '', ...progress },
    working_ms: 0,
    last_seq: 0,
    waiting_since: null,
    heartbeat_at: NOW.toISOString(),
  });
  return chatRun;
}

function startNext(args: Record<string, unknown>) {
  const rows = db.tables.chat_agent_runs;
  if (rows.filter((r) => r.status === 'running').length >= (args.p_workspace_limit as number)) {
    return null;
  }
  const next = rows.find((r) => r.status === 'queued');
  if (!next) return null;
  next.status = 'running';
  return next.id;
}

const agent = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  name: id,
  status: 'active',
  paused_reason: null,
  owner_id: PEOPLE.manager,
  version: 1,
  fail_count: 0,
  max_run_share: 0.1,
  max_month_share: null,
  activated_at: '2026-10-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  seedWorkspace(db);
  driver = vi.fn(async () => {});
  fakes.chatSweep.mockResolvedValue({ expired: 1, lost: 2 });
  fakes.usage.mockResolvedValue({ active_plan: true, unlimited: false, percent_used: 40 });
  fakes.shares.mockResolvedValue(null);
  fakes.endHeld.mockImplementation(async (chatRunId: string, from: string) => {
    const chat = db.tables.chat_runs.find((r) => r.id === chatRunId);
    if (!chat || chat.status !== from) return false;
    chat.status = 'stopped';
    return true;
  });
  db.tables.chat_agents = [agent(AGENT)];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
  db.tables.chat_runs = [];
  db.tables.chat_run_state = [];
  db.tables.ship_events = [];
  db.rpcs = { chat_start_next_agent_run: startNext };
});

afterEach(() => vi.unstubAllEnvs());

describe('the agents’ sweep', () => {
  it('runs Chat’s own sweep first, then brings each agent run in step with its Chat run', async () => {
    run('done-run');
    chatOf('done-run', 'done');
    run('lost-run', { brand_id: null });
    chatOf('lost-run', 'error');
    run('waiting-run', { brand_id: null, status: 'needs_you' });
    chatOf('waiting-run', 'running');
    const counts = await sweepAgents(NOW, driver);
    expect(fakes.chatSweep).toHaveBeenCalledWith(NOW);
    expect(counts).toMatchObject({ expired: 1, lost: 2, settled: 3 });
    expect(runRow('done-run').status).toBe('done');
    expect(runRow('lost-run').status).toBe('failed');
    expect(runRow('waiting-run').status).toBe('running');
    expect(agentRow().fail_count).toBe(1);
  });

  it('stops runs queued too long, and starts each workspace’s waiting runs', async () => {
    run('old', {
      status: 'queued',
      started_at: null,
      queued_at: new Date(NOW.getTime() - STALE_QUEUE_MS - 1000).toISOString(),
    });
    run('fresh', { status: 'queued', started_at: null, brand_id: null });
    const counts = await sweepAgents(NOW, driver);
    expect(runRow('old')).toMatchObject({ status: 'stopped', stop_reason: null });
    expect(runRow('fresh').status).toBe('running');
    expect(counts).toMatchObject({ staleQueued: 1, started: 1 });
    expect(driver).toHaveBeenCalledWith({ id: 'fresh', organizationId: ORG });
  });

  it('pauses an active agent with 3 failed runs in a row', async () => {
    db.tables.chat_agents = [
      agent(AGENT, { fail_count: 3 }),
      agent(OTHER_AGENT, { fail_count: 2 }),
    ];
    expect((await sweepAgents(NOW, driver)).pausedForFailures).toBe(1);
    expect(agentRow()).toMatchObject({ status: 'paused', paused_reason: 'failures' });
    expect(agentRow(OTHER_AGENT).status).toBe('active');
  });

  it('resumes an agent paused for the AI limit once there is room, and stops its triggered runs held there', async () => {
    db.tables.chat_agents = [
      agent(AGENT, { status: 'paused', paused_reason: 'cap' }),
      agent(OTHER_AGENT, { status: 'paused', paused_reason: 'manual' }),
    ];
    run('held', { status: 'paused_cap' });
    const heldChat = chatOf('held', 'paused_cap', { capHit: 'month' });
    run('held-manual', { status: 'paused_cap', trigger_kind: 'manual', brand_id: null });
    chatOf('held-manual', 'paused_cap', { capHit: 'month' });

    fakes.usage.mockResolvedValueOnce({ active_plan: true, unlimited: false, percent_used: 100 });
    expect((await sweepAgents(NOW, driver)).resumed).toBe(0);
    expect(agentRow().status).toBe('paused');

    expect((await sweepAgents(NOW, driver)).resumed).toBe(1);
    expect(agentRow()).toMatchObject({
      status: 'active',
      paused_reason: null,
      activated_at: NOW.toISOString(),
    });
    // A person's pause stays.
    expect(agentRow(OTHER_AGENT).status).toBe('paused');
    // The next trigger runs, not the stopped run (edge case 10); a Run now run waits for its person.
    expect(runRow('held')).toMatchObject({ status: 'stopped', stop_reason: null });
    expect(fakes.endHeld).toHaveBeenCalledWith(heldChat, 'paused_cap', 'limit');
    expect(runRow('held-manual').status).toBe('paused_cap');
  });

  it('resumes agents paused for the own key once it works, or Chat no longer runs on it (AGENT-OWN-KEY §5.4)', async () => {
    db.tables.chat_agents = [
      agent(AGENT, { status: 'paused', paused_reason: 'own_key' }),
      agent(OTHER_AGENT, { status: 'paused', paused_reason: 'manual' }),
    ];
    db.tables.organization_ai_keys = [
      {
        organization_id: ORG,
        provider: 'openai',
        active: true,
        failing_since: '2026-11-02T10:00:00.000Z',
        failure_class: 'no_credit',
        failure_status: 429,
      },
    ];
    // Still failing on the key Chat runs on: stays paused.
    fakes.onOwnKey.mockResolvedValue(true);
    expect((await sweepAgents(NOW, driver)).failed).toEqual([]);
    expect(agentRow().status).toBe('paused');

    // The key works again.
    db.tables.organization_ai_keys[0].failing_since = null;
    db.tables.organization_ai_keys[0].failure_class = null;
    expect((await sweepAgents(NOW, driver)).resumed).toBe(1);
    expect(agentRow()).toMatchObject({ status: 'active', paused_reason: null });
    expect(agentRow(OTHER_AGENT).status).toBe('paused');

    // Chat no longer runs on the key (removed, or a plan without own keys).
    Object.assign(agentRow(), { status: 'paused', paused_reason: 'own_key' });
    db.tables.organization_ai_keys[0].failing_since = '2026-11-02T10:00:00.000Z';
    db.tables.organization_ai_keys[0].failure_class = 'no_credit';
    fakes.onOwnKey.mockResolvedValue(false);
    expect((await sweepAgents(NOW, driver)).resumed).toBe(1);
    expect(agentRow().status).toBe('active');
  });

  it('keeps an agent paused while its own monthly cap is used', async () => {
    db.tables.chat_agents = [
      agent(AGENT, { status: 'paused', paused_reason: 'cap', max_month_share: 0.2 }),
    ];
    fakes.shares.mockResolvedValue({
      unlimited: false,
      byAgent: new Map([[AGENT, { share: 0.2, ownKeyShare: 0, runs: 5 }]]),
    });
    expect((await sweepAgents(NOW, driver)).resumed).toBe(0);
    // 0.18 + 0.02 is a hair under 0.2 in floating point: still at the cap.
    fakes.shares.mockResolvedValue({
      unlimited: false,
      byAgent: new Map([[AGENT, { share: 0.18, ownKeyShare: 0.02, runs: 5 }]]),
    });
    expect((await sweepAgents(NOW, driver)).resumed).toBe(0);
    fakes.shares.mockResolvedValue({
      unlimited: false,
      byAgent: new Map([[AGENT, { share: 0.05, ownKeyShare: 0, runs: 1 }]]),
    });
    expect((await sweepAgents(NOW, driver)).resumed).toBe(1);
  });

  it('runs every part when one fails, and names the one that did', async () => {
    fakes.chatSweep.mockRejectedValue(new Error('chat sweep down'));
    run('old', {
      status: 'queued',
      started_at: null,
      queued_at: new Date(NOW.getTime() - STALE_QUEUE_MS - 1000).toISOString(),
    });
    run('fresh', { status: 'queued', started_at: null, brand_id: null });
    const counts = await sweepAgents(NOW, driver);
    expect(counts.failed).toEqual(['chat']);
    expect(counts).toMatchObject({ staleQueued: 1, started: 1 });
    expect(runRow('fresh').status).toBe('running');
  });

  it('touches nothing of a workspace where Chat is off', async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'ffffffff-0000-4000-8000-000000000000');
    db.tables.chat_agents = [agent(AGENT, { fail_count: 3 })];
    run('done-run');
    chatOf('done-run', 'done');
    run('fresh', { status: 'queued', started_at: null, brand_id: null });
    await sweepAgents(NOW, driver);
    expect(runRow('done-run').status).toBe('running');
    expect(runRow('fresh').status).toBe('queued');
    expect(agentRow().status).toBe('active');
    expect(driver).not.toHaveBeenCalled();
  });
});
