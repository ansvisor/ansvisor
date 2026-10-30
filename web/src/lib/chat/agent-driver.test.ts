// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chat-fixtures';

/**
 * The agent run driver (CHAT-21 §H, CHAT-27 §E; W2-16), with an in-memory
 * database and a stand-in for the Chat engine: a started run gets a chat of
 * its own (origin agent), acting as the clicking person or, for a trigger,
 * the agent's owner now, after the checks before a run; the agent run then
 * follows its Chat run: Needs you, done, failed, paused at the AI limit,
 * stopped at its own cap or after 7 days; failures in a row pause the
 * agent; a freed slot starts the next run. No model is called.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const fakes = vi.hoisted(() => ({
  usage: vi.fn(),
  drive: vi.fn(),
  endHeld: vi.fn(),
}));
vi.mock('@/lib/mcp/account', () => ({ getAiUsageFor: fakes.usage }));
vi.mock('./key', () => ({ resolveChatModelKey: vi.fn(async () => ({ source: 'ansvisor' })) }));
vi.mock('./agent-shares', () => ({ readAgentShares: vi.fn(async () => null) }));
vi.mock('./engine', () => ({
  APPROVAL_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  validTimezone: (value?: string) => value ?? 'UTC',
  driveRun: fakes.drive,
  endHeldRun: fakes.endHeld,
  sweepChatRuns: vi.fn(async () => ({ expired: 0, lost: 0 })),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const driver = await import('./agent-driver');

const NOW = new Date('2026-11-02T06:00:30.000Z');
const AGENT = 'abababab-0000-4000-8000-000000000001';
const SIGNAL = 'cdcdcdcd-0000-4000-8000-000000000001';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const agentRow = () => db.tables.chat_agents[0];
const runRow = (id: string) => db.tables.chat_agent_runs.find((r) => r.id === id)!;

let started: string[];

/** chat_start_next_agent_run on the fake: the oldest queued under the limit. */
function startNext(args: Record<string, unknown>) {
  const rows = db.tables.chat_agent_runs;
  if (rows.filter((r) => r.status === 'running').length >= (args.p_workspace_limit as number)) {
    return null;
  }
  const next = rows.find((r) => r.status === 'queued');
  if (!next) return null;
  next.status = 'running';
  started.push(next.id as string);
  return next.id;
}

function queueRun(over: Record<string, unknown> = {}): string {
  const id = `eeeeeeee-0000-4000-8000-${String(db.tables.chat_agent_runs.length + 1).padStart(12, '0')}`;
  db.tables.chat_agent_runs.push({
    id,
    organization_id: ORG,
    agent_id: AGENT,
    agent_version: 1,
    brand_id: BRAND,
    trigger_kind: 'schedule',
    trigger_ref: 'schedule:2026-11-02T06:00:00.000Z',
    acting_user_id: PEOPLE.manager,
    status: 'running',
    skipped_reason: null,
    stop_reason: null,
    evidence_json: {
      fires: [
        {
          kind: 'schedule',
          ref: 'schedule:2026-11-02T06:00:00.000Z',
          at: NOW.toISOString(),
          timezone: 'Europe/Istanbul',
        },
      ],
      earlier: [],
    },
    max_share: 0.1,
    usage_share: 0,
    outcome: null,
    queued_at: NOW.toISOString(),
    started_at: NOW.toISOString(),
    finished_at: null,
    ...over,
  });
  return id;
}

/** A chat run in a state, for an agent run that was handed over. */
function chatOf(agentRunId: string, status: string, progress: Record<string, unknown> = {}) {
  const convo = `c${db.tables.chat_conversations.length + 1}`;
  const chatRun = `r${db.tables.chat_runs.length + 1}`;
  db.tables.chat_conversations.push({ id: convo, agent_run_id: agentRunId });
  db.tables.chat_runs.push({
    id: chatRun,
    status,
    conversation_id: convo,
    message_id: `m${chatRun}`,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  seedWorkspace(db);
  started = [];
  fakes.usage.mockResolvedValue({ active_plan: true, unlimited: false, percent_used: 5 });
  fakes.drive.mockResolvedValue(undefined);
  fakes.endHeld.mockImplementation(async (chatRunId: string, from: string, reason: string) => {
    const run = db.tables.chat_runs.find((r) => r.id === chatRunId);
    if (!run || run.status !== from) return false;
    run.status = 'stopped';
    const state = db.tables.chat_run_state.find((s) => s.run_id === chatRunId)!;
    state.progress = { ...(state.progress as object), stoppedFor: reason };
    return true;
  });
  db.unique = { ...db.unique, chat_conversations: [['agent_run_id']] };
  db.tables.brands = [{ id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false }];
  db.tables.chat_agents = [
    {
      id: AGENT,
      organization_id: ORG,
      name: 'Citation win-back',
      status: 'active',
      paused_reason: null,
      owner_id: PEOPLE.admin,
      visibility: 'workspace',
      version: 2,
      fail_count: 0,
      max_run_share: 0.1,
      max_month_share: null,
      created_by: PEOPLE.admin,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
      activated_at: '2026-10-01T00:00:00.000Z',
      archived_at: null,
    },
  ];
  const version = (n: number, over: Record<string, unknown> = {}) => ({
    agent_id: AGENT,
    version: n,
    skill_ids: ['winback', 'faq'],
    instructions: 'Start with the pricing pages.',
    mode: 'auto',
    connections: [],
    model: 'auto',
    effort: 'high',
    scope: { brand_ids: [BRAND] },
    notify_user_ids: [],
    followup_days: 14,
    created_at: '2026-10-01T00:00:00.000Z',
    ...over,
  });
  // Version 2 is the agent's now; a run queued on version 1 keeps it.
  db.tables.chat_agent_versions = [version(1), version(2, { skill_ids: ['refresh'] })];
  db.tables.chat_agent_triggers = [];
  db.tables.chat_agent_runs = [];
  db.tables.chat_conversations = [];
  db.tables.chat_messages = [];
  db.tables.chat_runs = [];
  db.tables.chat_run_state = [];
  db.tables.ship_events = [];
  db.rpcs = { chat_start_next_agent_run: startNext };
});

afterEach(() => vi.unstubAllEnvs());

describe('handing a started run to Chat', () => {
  it('makes a chat of its own, acting as the agent’s owner now for a trigger, with its version', async () => {
    const id = queueRun();
    const opened = await driver.openAgentRun(id, ORG, NOW);

    // Queued as the manager, but the agent is the Admin's now: the owner at run time.
    expect(opened).toMatchObject({
      agentRunId: id,
      organizationId: ORG,
      actor: { userId: PEOPLE.admin, organizationId: ORG },
    });
    expect(runRow(id).acting_user_id).toBe(PEOPLE.admin);
    expect(db.tables.chat_conversations).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        user_id: PEOPLE.admin,
        brand_id: BRAND,
        origin: 'agent',
        agent_run_id: id,
        title: 'Citation win-back · Brand A',
      }),
    ]);
    const [question, answer] = db.tables.chat_messages;
    expect(question.role).toBe('user');
    // Version 1's skills, not the agent's current ones; nobody watching: the background rule.
    expect(question.content_md).toContain('/winback, then /faq');
    expect(question.content_md).toContain('Start with the pricing pages.');
    expect(question.content_md).toContain('It started on its schedule.');
    expect(question.content_md).toContain('recommended option');
    expect(question.content_md).not.toMatch(UUID);
    expect(answer).toMatchObject({ role: 'assistant', timezone: 'Europe/Istanbul' });
    expect(db.tables.chat_runs).toEqual([
      expect.objectContaining({
        id: opened!.chatRunId,
        message_id: answer.id,
        status: 'running',
        effort: 'high',
        model: 'auto',
      }),
    ]);
    const state = db.tables.chat_run_state[0];
    expect(state).toMatchObject({ user_id: PEOPLE.admin, mode: 'auto' });
    const progress = state.progress as {
      brandId: string;
      scope: { context: { chips: unknown[] } };
    };
    expect(progress.brandId).toBe(BRAND);
    expect(progress.scope.context.chips).toContainEqual(
      expect.objectContaining({ key: 'slot', value: 'schedule:2026-11-02T06:00:00.000Z' }),
    );
  });

  it('acts as the person who clicked Run now, and puts a signal’s id in the scope, never the message', async () => {
    const id = queueRun({
      trigger_kind: 'manual',
      acting_user_id: PEOPLE.manager,
      evidence_json: {},
    });
    const opened = await driver.openAgentRun(id, ORG, NOW);
    expect(opened?.actor.userId).toBe(PEOPLE.manager);
    expect(db.tables.chat_messages[0].content_md).toContain('It started with Run now.');
    expect(db.tables.chat_messages[0].content_md).not.toContain('recommended option');

    const signalRun = queueRun({
      brand_id: BRAND,
      agent_version: 1,
      evidence_json: {
        fires: [
          { kind: 'signal', ref: SIGNAL, at: NOW.toISOString(), signalKind: 'lost_citation' },
        ],
        earlier: [],
      },
      trigger_kind: 'signal',
    });
    // One run at a time per agent and brand: the first ended.
    runRow(id).status = 'done';
    await driver.openAgentRun(signalRun, ORG, NOW);
    const message = db.tables.chat_messages.at(-2)!;
    expect(message.content_md).toContain('Action Center found a new signal');
    expect(message.content_md).not.toContain(SIGNAL);
    expect(JSON.stringify(message.context_json)).not.toContain(SIGNAL);
    const state = db.tables.chat_run_state.at(-1)!;
    expect(JSON.stringify(state.progress)).toContain(`lost_citation ${SIGNAL}`);
  });

  it('hands a run over once: a second driver finds its chat and leaves it', async () => {
    const id = queueRun();
    expect(await driver.openAgentRun(id, ORG, NOW)).not.toBeNull();
    expect(await driver.openAgentRun(id, ORG, NOW)).toBeNull();
    expect(db.tables.chat_conversations).toHaveLength(1);
    expect(runRow(id).status).toBe('running');
  });

  it('pauses a triggered agent whose owner can’t own agents any more, and starts nothing', async () => {
    agentRow().owner_id = PEOPLE.analyst;
    const id = queueRun();
    expect(await driver.openAgentRun(id, ORG, NOW)).toBeNull();
    expect(runRow(id)).toMatchObject({ status: 'stopped', stop_reason: null });
    expect(agentRow()).toMatchObject({ status: 'paused', paused_reason: 'owner_role' });
    expect(db.tables.chat_conversations).toEqual([]);
  });

  it('stops a Run now whose person is no longer an Admin or a Manager, and leaves the agent on', async () => {
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.role = 'analyst';
    const id = queueRun({ trigger_kind: 'manual', acting_user_id: PEOPLE.manager });
    expect(await driver.openAgentRun(id, ORG, NOW)).toBeNull();
    expect(runRow(id)).toMatchObject({ status: 'stopped', stop_reason: null });
    // The person changed, not the agent: it stays on for its owner's triggers.
    expect(agentRow()).toMatchObject({ status: 'active', paused_reason: null });
    expect(db.tables.chat_conversations).toEqual([]);

    // A Run agent click on an action is held to the same.
    const action = queueRun({
      trigger_kind: 'action',
      acting_user_id: PEOPLE.manager,
      brand_id: null,
    });
    expect(await driver.openAgentRun(action, ORG, NOW)).toBeNull();
    expect(runRow(action).status).toBe('stopped');
  });

  it('starts nothing in a read-only workspace, and doesn’t pause the agent', async () => {
    db.tables.organizations[0].subscription_status = 'canceled';
    const id = queueRun();
    expect(await driver.openAgentRun(id, ORG, NOW)).toBeNull();
    expect(runRow(id).status).toBe('stopped');
    expect(agentRow().status).toBe('active');
    expect(db.tables.chat_runs).toEqual([]);
  });

  it('pauses a triggered agent at the AI limit (cap) before its run starts', async () => {
    fakes.usage.mockResolvedValue({ active_plan: true, unlimited: false, percent_used: 100 });
    const id = queueRun();
    expect(await driver.openAgentRun(id, ORG, NOW)).toBeNull();
    expect(agentRow()).toMatchObject({ status: 'paused', paused_reason: 'cap' });
    expect(runRow(id).status).toBe('stopped');
  });

  it('stops a run whose brand left its scope, and with Chat off starts nothing', async () => {
    db.tables.chat_agent_versions[0].scope = { brand_ids: [] };
    const id = queueRun();
    expect(await driver.openAgentRun(id, ORG, NOW)).toBeNull();
    expect(runRow(id)).toMatchObject({ status: 'stopped', stop_reason: 'brand_gone' });
    expect(agentRow()).toMatchObject({ status: 'paused', paused_reason: 'brand_gone' });

    vi.stubEnv('CHAT_AGENTIC', 'false');
    const off = queueRun({ brand_id: null });
    expect(await driver.openAgentRun(off, ORG, NOW)).toBeNull();
    expect(runRow(off).status).toBe('stopped');
    expect(db.tables.chat_conversations).toEqual([]);
  });
});

describe('keeping the agent run in step with its Chat run', () => {
  it('is Needs you while its card waits, Done when it ends, and clears failures in a row', async () => {
    agentRow().fail_count = 2;
    const id = queueRun();
    const chat = chatOf(id, 'waiting');
    expect(await driver.settleAgentRun(id, { now: NOW })).toBe('needs_you');
    // An approval in its chat carries it on.
    db.tables.chat_runs.find((r) => r.id === chat)!.status = 'running';
    expect(await driver.settleAgentRun(id, { now: NOW })).toBe('running');
    const queued = queueRun({ status: 'queued', brand_id: null });
    db.tables.chat_runs.find((r) => r.id === chat)!.status = 'done';
    expect(await driver.settleAgentRun(id, { now: NOW })).toBe('done');
    expect(runRow(id).finished_at).toBe(NOW.toISOString());
    expect(agentRow().fail_count).toBe(0);
    // Its end frees a slot, but the next run waits for the minute tick (agent-sweep.ts):
    // never started in what is left of this request's time.
    expect(started).toEqual([]);
    expect(runRow(queued).status).toBe('queued');
    expect(db.log.filter(([name]) => name === 'chat_start_next_agent_run')).toEqual([]);
    // Settled once: again changes nothing.
    expect(await driver.settleAgentRun(id, { now: NOW })).toBe('done');
  });

  it('pauses the agent after 3 failed runs in a row', async () => {
    for (let i = 0; i < 3; i++) {
      const id = queueRun();
      chatOf(id, 'error');
      expect(await driver.settleAgentRun(id, { now: NOW })).toBe('failed');
    }
    expect(agentRow()).toMatchObject({
      fail_count: 3,
      status: 'paused',
      paused_reason: 'failures',
    });
  });

  it('stops a triggered run at its own cap, "Stopped at its limit", in its owner’s chat', async () => {
    const id = queueRun();
    const chat = chatOf(id, 'paused_cap', { capHit: 'run' });
    expect(await driver.settleAgentRun(id, { now: NOW })).toBe('stopped');
    expect(fakes.endHeld).toHaveBeenCalledWith(chat, 'paused_cap', 'limit');
    expect(runRow(id)).toMatchObject({ status: 'stopped', stop_reason: 'run_cap' });
    // Its own cap isn't the month's limit: the agent stays on.
    expect(agentRow().status).toBe('active');
  });

  it('keeps a Run now run paused at its cap for a person, and pauses the agent at the month’s limit', async () => {
    const manual = queueRun({ trigger_kind: 'manual' });
    chatOf(manual, 'paused_cap', { capHit: 'run' });
    expect(await driver.settleAgentRun(manual, { now: NOW })).toBe('paused_cap');
    expect(fakes.endHeld).not.toHaveBeenCalled();
    expect(agentRow().status).toBe('active');

    const triggered = queueRun({ brand_id: null });
    chatOf(triggered, 'paused_cap', { capHit: 'month' });
    expect(await driver.settleAgentRun(triggered, { now: NOW })).toBe('paused_cap');
    expect(agentRow()).toMatchObject({ status: 'paused', paused_reason: 'cap' });
  });

  it('stops a run left 7 days on a card ("No answer in 7 days"), and one held at its cap at its limit', async () => {
    const waited = queueRun();
    chatOf(waited, 'stopped', { stoppedFor: 'expired' });
    runRow(waited).status = 'needs_you';
    expect(await driver.settleAgentRun(waited, { now: NOW })).toBe('stopped');
    expect(runRow(waited).stop_reason).toBe('no_answer');

    const held = queueRun({ trigger_kind: 'manual', brand_id: null });
    const heldChat = chatOf(held, 'paused_cap', { capHit: 'run' });
    runRow(held).status = 'paused_cap';
    const later = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(await driver.settleAgentRun(held, { now: later })).toBe('stopped');
    // It stopped at its limit, not for want of an answer.
    expect(fakes.endHeld).toHaveBeenCalledWith(heldChat, 'paused_cap', 'limit');
    expect(runRow(held).stop_reason).toBe('run_cap');

    // So does one held at the month's limit.
    const month = queueRun({ trigger_kind: 'manual', brand_id: null, agent_version: 1 });
    chatOf(month, 'paused_cap', { capHit: 'month' });
    runRow(month).status = 'paused_cap';
    expect(await driver.settleAgentRun(month, { now: later })).toBe('stopped');
    expect(runRow(month).stop_reason).toBe('run_cap');
  });

  it('fails a run whose driver was lost before its chat was made, after 5 minutes', async () => {
    const id = queueRun();
    expect(await driver.settleAgentRun(id, { now: NOW })).toBe('running');
    const later = new Date(NOW.getTime() + driver.HANDOVER_GRACE_MS + 1000);
    expect(await driver.settleAgentRun(id, { now: later })).toBe('failed');
  });

  it('marks a run that shipped something Pending, and one that shipped nothing without an outcome', async () => {
    const shipped = queueRun();
    chatOf(shipped, 'done');
    db.tables.ship_events.push({ id: 's1', agent_run_id: shipped });
    await driver.settleAgentRun(shipped, { now: NOW });
    expect(runRow(shipped).outcome).toBe('pending');

    const nothing = queueRun({ brand_id: null });
    chatOf(nothing, 'done');
    await driver.settleAgentRun(nothing, { now: NOW });
    expect(runRow(nothing).outcome).toBeNull();
  });
});

describe('the driver', () => {
  it('hands the run over, drives it in the background as the person it acts as, then settles it', async () => {
    const tasks: (() => Promise<void>)[] = [];
    const run = driver.createAgentRunDriver({
      background: (task) => tasks.push(task),
      drive: async (actor, chatRunId) => {
        fakes.drive(actor, chatRunId);
        db.tables.chat_runs.find((r) => r.id === chatRunId)!.status = 'done';
      },
      now: () => NOW,
    });
    const id = queueRun();
    await run({ id, organizationId: ORG });
    // Handed over: the drive hasn't run yet.
    expect(fakes.drive).not.toHaveBeenCalled();
    expect(runRow(id).status).toBe('running');
    const waiting = queueRun({ status: 'queued', brand_id: null });
    await tasks[0]();
    expect(fakes.drive).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PEOPLE.admin, organizationId: ORG }),
      db.tables.chat_runs[0].id,
    );
    expect(runRow(id).status).toBe('done');
    // No chain: the waiting run isn't started from this drive's background task.
    expect(tasks).toHaveLength(1);
    expect(runRow(waiting).status).toBe('queued');
  });

  it('settles the run even when the drive throws', async () => {
    const tasks: (() => Promise<void>)[] = [];
    const run = driver.createAgentRunDriver({
      background: (task) => tasks.push(task),
      drive: async (_actor, chatRunId) => {
        db.tables.chat_runs.find((r) => r.id === chatRunId)!.status = 'error';
        throw new Error('boom');
      },
      now: () => NOW,
    });
    const id = queueRun();
    await run({ id, organizationId: ORG });
    await expect(tasks[0]()).rejects.toThrow('boom');
    expect(runRow(id).status).toBe('failed');
    expect(agentRow().fail_count).toBe(1);
  });
});
