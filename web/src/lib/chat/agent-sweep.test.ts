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
  notify: vi.fn(async () => true),
}));
vi.mock('./key-notice', () => ({ notifyOwnKeyFailure: fakes.notify }));
vi.mock('@/lib/mcp/account', () => ({ getAiUsageFor: fakes.usage }));
const keyCap = vi.hoisted(() => ({
  reached: null as { reached: boolean; renewsAt: string | null } | null,
  read: null as { reached: boolean; renewsAt: string | null } | null,
}));
vi.mock('./own-key-cap', () => ({
  ownKeyCapReached: vi.fn(async () => keyCap.reached),
  readOwnKeyCap: vi.fn(async () => keyCap.read),
}));
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
const { sweepAgents, OWN_KEY_REMINDER_MS, STALE_QUEUE_MS } = await import('./agent-sweep');

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
  keyCap.reached = null;
  keyCap.read = null;
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
  db.tables.organization_ai_keys = [];
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
    // The tick has no one's session: the run's changes ask first.
    expect(driver).toHaveBeenCalledWith({ id: 'fresh', organizationId: ORG, sessionUserId: null });
  });

  it('leaves the demo brand’s sample agents and their runs as they are (00475)', async () => {
    const DEMO_BRAND = '66666666-6666-4666-8666-666666666666';
    db.tables.brands.push({ id: DEMO_BRAND, organization_id: ORG, is_demo: true });
    db.tables.chat_agents = [
      agent(AGENT, { fail_count: 3, demo_brand_id: DEMO_BRAND }),
      agent(OTHER_AGENT),
    ];
    // Its waiting run has no Chat run state: settled as any other, it would fail.
    run('demo-run', { brand_id: DEMO_BRAND, status: 'needs_you' });
    // Older than a real one: the settle pass still leaves it out, and settles the real one.
    runRow('demo-run').queued_at = new Date(NOW.getTime() - 86_400_000).toISOString();
    run('real-run', { brand_id: null, agent_id: OTHER_AGENT });
    chatOf('real-run', 'done');
    const counts = await sweepAgents(NOW, driver);
    expect(runRow('demo-run').status).toBe('needs_you');
    expect(runRow('real-run').status).toBe('done');
    expect(counts.settled).toBe(1);
    expect(counts.pausedForFailures).toBe(0);
    expect(agentRow()).toMatchObject({ status: 'active', fail_count: 3 });
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

  it('resumes agents paused at the own key’s monthly limit once there is room again (AGENT-OWN-KEY §4.2)', async () => {
    fakes.onOwnKey.mockResolvedValue(true);
    db.tables.chat_agents = [
      agent(AGENT, { status: 'paused', paused_reason: 'own_key_cap' }),
      agent(OTHER_AGENT, { status: 'paused', paused_reason: 'manual' }),
    ];
    // Still reached, or not read: they wait.
    keyCap.read = { reached: true, renewsAt: '2026-11-20T09:00:00.000Z' };
    expect((await sweepAgents(NOW, driver)).resumed).toBe(0);
    keyCap.read = null;
    expect((await sweepAgents(NOW, driver)).resumed).toBe(0);
    expect(agentRow().status).toBe('paused');

    // The period renewed, or an Admin raised the limit.
    keyCap.read = { reached: false, renewsAt: '2026-12-20T09:00:00.000Z' };
    expect((await sweepAgents(NOW, driver)).resumed).toBe(1);
    expect(agentRow()).toMatchObject({
      status: 'active',
      paused_reason: null,
      activated_at: NOW.toISOString(),
    });
    expect(agentRow(OTHER_AGENT).status).toBe('paused');

    // Chat no longer runs on the key: it resumes on the AI limit, unread.
    Object.assign(agentRow(), { status: 'paused', paused_reason: 'own_key_cap' });
    fakes.onOwnKey.mockResolvedValue(false);
    keyCap.read = null;
    expect((await sweepAgents(NOW, driver)).resumed).toBe(1);
    expect(agentRow().status).toBe('active');
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

  it('reminds the Admins once of an own key still failing 3 days in (AGENT-OWN-KEY §5.3)', async () => {
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const due = ago(OWN_KEY_REMINDER_MS + 60_000);
    db.tables.organization_ai_keys = [
      // Told as it began: its reminder is due.
      { organization_id: ORG, provider: 'openai', failing_since: due, notified_at: due },
      // Not 3 days yet.
      {
        organization_id: ORG,
        provider: 'anthropic',
        failing_since: ago(OWN_KEY_REMINDER_MS - 60_000),
        notified_at: null,
      },
      // Reminded already.
      {
        organization_id: ORG,
        provider: 'google',
        failing_since: ago(OWN_KEY_REMINDER_MS + 120_000),
        notified_at: ago(30_000),
      },
      // Works.
      { organization_id: ORG, provider: 'azure', failing_since: null, notified_at: null },
    ];
    expect((await sweepAgents(NOW, driver)).reminded).toBe(1);
    expect(fakes.notify).toHaveBeenCalledTimes(1);
    expect(fakes.notify).toHaveBeenCalledWith(ORG, 'openai', due, { reminder: true });

    // Chat off for the workspace: no one is reminded.
    fakes.notify.mockClear();
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'ffffffff-0000-4000-8000-000000000000');
    expect((await sweepAgents(NOW, driver)).reminded).toBe(0);
    expect(fakes.notify).not.toHaveBeenCalled();
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

// ─── An AEO Operator's plan at the end of its day (AEO Operator plan §4.2 step 8) ─

describe('an AEO Operator’s unanswered plan', () => {
  const PLAN = 'f0f0f0f0-0000-4000-8000-000000000001';
  const zoned = (timezone: string) => ({
    fires: [{ kind: 'schedule', ref: 's', at: '2026-11-02T04:00:00.000Z', timezone }],
    earlier: [],
  });

  beforeEach(() => {
    db.tables.chat_agents = [agent(AGENT, { kind: 'operator' })];
    fakes.endHeld.mockImplementation(async (chatRunId: string, from: string, reason: string) => {
      const chat = db.tables.chat_runs.find((r) => r.id === chatRunId);
      if (!chat || chat.status !== from) return false;
      chat.status = 'stopped';
      const state = db.tables.chat_run_state.find((s) => s.run_id === chatRunId)!;
      state.progress = { ...(state.progress as object), stoppedFor: reason };
      return true;
    });
    db.tables.chat_agent_plans = [
      {
        id: PLAN,
        organization_id: ORG,
        agent_id: AGENT,
        run_id: 'run-op',
        brand_id: BRAND,
        plan_day: '2026-11-02',
        status: 'proposed',
        budget_share: 0.05,
        planned_share: 0.04,
        items: [],
        passed: [],
        decided_at: null,
        created_at: '2026-11-02T04:00:00.000Z',
      },
    ];
  });

  it('expires at the end of its local day: its card stops, its run with no answer', async () => {
    // 21:00 UTC: midnight in Istanbul, the plan's zone.
    run('run-op', { status: 'needs_you', evidence_json: zoned('Europe/Istanbul') });
    const chat = chatOf('run-op', 'waiting');
    const counts = await sweepAgents(new Date('2026-11-02T21:00:00.000Z'), driver);
    expect(counts.plansExpired).toBe(1);
    expect(fakes.endHeld).toHaveBeenCalledWith(chat, 'waiting', 'expired');
    expect(runRow('run-op')).toMatchObject({ status: 'stopped', stop_reason: 'no_answer' });
    expect(db.tables.chat_agent_plans[0].status).toBe('expired');
    expect(counts.failed).toEqual([]);
  });

  it('waits while its day lasts in its zone, and leaves a plan already decided as it is', async () => {
    // 21:00 UTC is still Nov 2 in New York.
    run('run-op', { status: 'needs_you', evidence_json: zoned('America/New_York') });
    chatOf('run-op', 'waiting');
    let counts = await sweepAgents(new Date('2026-11-02T21:00:00.000Z'), driver);
    expect(counts.plansExpired).toBe(0);
    expect(runRow('run-op').status).toBe('needs_you');
    expect(db.tables.chat_agent_plans[0].status).toBe('proposed');
    // Approved and started: no longer proposed, never expired.
    db.tables.chat_agent_plans[0].status = 'dispatched';
    counts = await sweepAgents(new Date('2026-11-04T12:00:00.000Z'), driver);
    expect(counts.plansExpired).toBe(0);
    expect(db.tables.chat_agent_plans[0].status).toBe('dispatched');
  });

  it('expires a plan whose run ended some other way, and touches nothing with Chat off', async () => {
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'someone-else');
    run('run-op', { status: 'failed', evidence_json: zoned('UTC') });
    expect((await sweepAgents(new Date('2026-11-03T01:00:00.000Z'), driver)).plansExpired).toBe(0);
    expect(db.tables.chat_agent_plans[0].status).toBe('proposed');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    expect((await sweepAgents(new Date('2026-11-03T01:00:00.000Z'), driver)).plansExpired).toBe(1);
    expect(db.tables.chat_agent_plans[0].status).toBe('expired');
    expect(fakes.endHeld).not.toHaveBeenCalled();
  });
  it('isn’t held back by a page of plans from workspaces Chat is off for', async () => {
    run('run-op', { status: 'failed', evidence_json: zoned('UTC') });
    const own = db.tables.chat_agent_plans[0];
    // A whole page of older plans, from a workspace off the list.
    db.tables.chat_agent_plans = [
      ...Array.from({ length: 500 }, (_, i) => ({
        ...own,
        id: `f0f0f0f0-0000-4000-8000-1${String(i).padStart(11, '0')}`,
        organization_id: 'ffffffff-0000-4000-8000-000000000000',
        plan_day: '2026-10-01',
      })),
      own,
    ];
    vi.stubEnv('CHAT_AGENTIC_ORGS', ORG);
    expect((await sweepAgents(new Date('2026-11-03T01:00:00.000Z'), driver)).plansExpired).toBe(1);
    expect(db.tables.chat_agent_plans.find((p) => p.id === own.id)?.status).toBe('expired');
  });
});

// ─── An AEO Operator's summary once its agents are done (AEO Operator plan §4.2 step 7) ─

describe('an AEO Operator’s summary', () => {
  const PLAN = 'f0f0f0f0-0000-4000-8000-000000000002';
  const OPERATOR = 'abababab-0000-4000-8000-0000000000ff';
  const OP_CHAT = 'eeeeeeee-0000-4000-8000-0000000000ff';
  const DISPATCHED = '2026-11-02T08:00:00.000Z';
  const HOUR = 60 * 60_000;
  const at = (hours: number) => new Date(Date.parse(DISPATCHED) + hours * HOUR);
  let fetchMock: ReturnType<typeof vi.fn>;
  const serverCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/notices/agent-plan'));
  const plan = () => db.tables.chat_agent_plans[0];

  /** A run the Operator's run started, on its brand. */
  const child = (id: string, status: string, agentId = AGENT) =>
    run(id, {
      agent_id: agentId,
      status,
      trigger_kind: 'agent',
      called_by_run_id: 'run-op',
      usage_share: 0.004,
      max_share: 0.01,
      queued_at: DISPATCHED,
      started_at: DISPATCHED,
    });

  beforeEach(() => {
    vi.stubEnv('CHAT_OPERATOR', 'true');
    vi.stubEnv('CRON_SECRET', 'shh');
    fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.tables.chat_agents = [
      agent(OPERATOR, { kind: 'operator', name: 'AEO Operator' }),
      agent(AGENT, { name: 'Citation Win-back' }),
      agent(OTHER_AGENT, { name: 'Competitor Watch' }),
    ];
    run('run-op', {
      agent_id: OPERATOR,
      status: 'done',
      usage_share: 0.002,
      max_share: 0.05,
      queued_at: '2026-11-02T07:00:00.000Z',
    });
    db.tables.chat_conversations.push({
      id: OP_CHAT,
      organization_id: ORG,
      user_id: PEOPLE.manager,
      agent_run_id: 'run-op',
    });
    db.tables.chat_messages = [];
    db.tables.chat_notices = [];
    db.tables.chat_activity_log = [];
    db.tables.chat_agent_plans = [
      {
        id: PLAN,
        organization_id: ORG,
        agent_id: OPERATOR,
        run_id: 'run-op',
        brand_id: BRAND,
        plan_day: '2026-11-02',
        status: 'dispatched',
        budget_share: 0.05,
        planned_share: 0.02,
        items: [
          { agent_id: AGENT, share: 0.01, cost: 0.01, value: 3, reasons: [], child_run_id: 'c-1' },
          {
            agent_id: OTHER_AGENT,
            share: 0.01,
            cost: 0.01,
            value: 2,
            reasons: [],
            child_run_id: 'c-2',
          },
        ],
        passed: [],
        decided_at: '2026-11-02T07:59:00.000Z',
        dispatched_at: DISPATCHED,
        summarized_at: null,
        summary_json: null,
        created_at: '2026-11-02T07:00:00.000Z',
      },
    ];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is sent once every agent has ended or waits for its person: in its chat, by the server, once', async () => {
    child('c-1', 'done');
    child('c-2', 'needs_you', OTHER_AGENT);
    chatOf('c-2', 'waiting');
    const counts = await sweepAgents(at(1), driver);
    expect(counts.plansSummarized).toBe(1);
    expect(counts.failed).toEqual([]);
    expect(plan()).toMatchObject({ status: 'summarized', summarized_at: at(1).toISOString() });
    expect(plan().summary_json).toMatchObject({
      v: 1,
      why: 'done',
      waiting: 1,
      children: [
        { agent_id: AGENT, name: 'Citation Win-back', state: 'done' },
        { agent_id: OTHER_AGENT, name: 'Competitor Watch', state: 'waiting' },
      ],
    });
    expect(db.tables.chat_messages).toEqual([
      expect.objectContaining({ conversation_id: OP_CHAT, role: 'assistant' }),
    ]);
    expect(serverCalls()).toHaveLength(1);
    expect(JSON.parse((serverCalls()[0][1] as RequestInit).body as string)).toEqual({
      orgId: ORG,
      planId: PLAN,
    });
    // Sent: the next sweep sends nothing.
    expect((await sweepAgents(at(2), driver)).plansSummarized).toBe(0);
    expect(db.tables.chat_messages).toHaveLength(1);
    expect(serverCalls()).toHaveLength(1);
  });

  it('waits while an agent works, then is sent at the 8-hour deadline', async () => {
    child('c-1', 'done');
    child('c-2', 'running', OTHER_AGENT);
    chatOf('c-2', 'running');
    expect((await sweepAgents(at(7.9), driver)).plansSummarized).toBe(0);
    expect(plan().status).toBe('dispatched');
    expect(db.tables.chat_messages).toEqual([]);
    expect((await sweepAgents(at(8), driver)).plansSummarized).toBe(1);
    expect(plan().summary_json).toMatchObject({
      why: 'deadline',
      children: [{ state: 'done' }, { state: 'working' }],
    });
    expect(db.tables.chat_messages[0].content_md).toContain('Some of its agents are still working');
  });

  it('is summarized anyway 48 hours on when it can’t be read in full', async () => {
    child('c-1', 'done');
    child('c-2', 'running', OTHER_AGENT);
    chatOf('c-2', 'running');
    db.failures = { chat_activity_log: { message: 'down' } };
    // Due at the deadline, but unread: it waits for the next sweep.
    expect((await sweepAgents(at(9), driver)).plansSummarized).toBe(0);
    expect(plan().status).toBe('dispatched');
    expect((await sweepAgents(at(47.9), driver)).plansSummarized).toBe(0);
    expect((await sweepAgents(at(48), driver)).plansSummarized).toBe(1);
    expect(plan().status).toBe('summarized');
    expect(plan().summary_json).toMatchObject({
      partial: true,
      budget: null,
      children: [
        { agent_id: null, name: null, state: 'done' },
        { agent_id: null, name: null, state: 'working' },
      ],
    });
    expect(db.tables.chat_messages[0].content_md).toContain('couldn’t be read');
    expect(serverCalls()).toHaveLength(1);
  });

  it('is sent exactly once when two sweeps run at once', async () => {
    child('c-1', 'done');
    child('c-2', 'failed', OTHER_AGENT);
    const [one, two] = await Promise.all([sweepAgents(at(1), driver), sweepAgents(at(1), driver)]);
    expect(one.plansSummarized + two.plansSummarized).toBe(1);
    expect(plan().status).toBe('summarized');
    expect(db.tables.chat_messages).toHaveLength(1);
    expect(serverCalls()).toHaveLength(1);
  });

  it('does nothing for a declined or an expired plan, nor with the AEO Operator off', async () => {
    child('c-1', 'done');
    child('c-2', 'done', OTHER_AGENT);
    for (const status of ['declined', 'expired']) {
      plan().status = status;
      expect((await sweepAgents(at(49), driver)).plansSummarized).toBe(0);
      expect(plan()).toMatchObject({ status, summary_json: null });
    }
    plan().status = 'dispatched';
    vi.stubEnv('CHAT_OPERATOR', '');
    expect((await sweepAgents(at(49), driver)).plansSummarized).toBe(0);
    expect(plan().status).toBe('dispatched');
    vi.stubEnv('CHAT_OPERATOR', 'true');
    vi.stubEnv('CHAT_OPERATOR_ORGS', 'ffffffff-0000-4000-8000-000000000000');
    expect((await sweepAgents(at(49), driver)).plansSummarized).toBe(0);
    expect(db.tables.chat_messages).toEqual([]);
    expect(serverCalls()).toEqual([]);
  });

  it('isn’t held back by a page of plans from workspaces the AEO Operator is off for', async () => {
    child('c-1', 'done');
    child('c-2', 'done', OTHER_AGENT);
    const own = plan();
    // A whole page of plans started earlier, in a workspace off the list.
    db.tables.chat_agent_plans = [
      ...Array.from({ length: 500 }, (_, i) => ({
        ...own,
        id: `f0f0f0f0-0000-4000-8000-2${String(i).padStart(11, '0')}`,
        organization_id: 'ffffffff-0000-4000-8000-000000000000',
        dispatched_at: '2026-10-01T08:00:00.000Z',
      })),
      own,
    ];
    vi.stubEnv('CHAT_OPERATOR_ORGS', ORG);
    expect((await sweepAgents(at(1), driver)).plansSummarized).toBe(1);
    expect(db.tables.chat_agent_plans.find((p) => p.id === own.id)?.status).toBe('summarized');
  });

  it('reads only its own runs: another brand’s run named by its run doesn’t hold it', async () => {
    child('c-1', 'done');
    child('c-2', 'done', OTHER_AGENT);
    // On another brand: not the plan's, never waited for.
    child('c-3', 'running');
    runRow('c-3').brand_id = '22222222-2222-4222-8222-2222222222ff';
    chatOf('c-3', 'running');
    expect((await sweepAgents(at(1), driver)).plansSummarized).toBe(1);
    expect((plan().summary_json as { children: unknown[] }).children).toHaveLength(2);
  });
});
