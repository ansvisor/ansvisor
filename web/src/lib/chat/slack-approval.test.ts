// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Approve and Reject from Slack (#2139, N7): the card read only within the
 * post's workspace, brand and agent run; only the run's person decides it,
 * through the app's own prepareResume and driveRun, with no session; the
 * role, brand access, read-only workspace, demo brand and a card already
 * decided or changed each refuse before anything moves.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '11111111-1111-4111-8111-999999999999';
const BRAND = '22222222-2222-4222-8222-222222222222';
const OTHER_BRAND = '22222222-2222-4222-8222-999999999999';
const AGENT_RUN = '33333333-3333-4333-8333-333333333333';
const CHAT = '44444444-4444-4444-8444-444444444444';
const RUN = '55555555-5555-4555-8555-555555555555';
const STEP = '66666666-6666-4666-8666-666666666666';
const SAM = '77777777-7777-4777-8777-777777777777';
const ZOE = '77777777-7777-4777-8777-888888888888';
const DIGEST = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock('@/lib/supabase/admin', () => {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const rows = () => (db.tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => (filters.push((r) => r[column] === value), chain),
      is: (column: string, value: unknown) => (
        filters.push((r) => (r[column] ?? null) === value),
        chain
      ),
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null }),
    };
    return chain;
  };
  return { supabaseAdmin: { from } };
});

const fakes = vi.hoisted(() => ({
  loadRun: vi.fn(),
  prepareResume: vi.fn(),
  driveRun: vi.fn(),
  decideForEngine: vi.fn(),
  readPrecedenceContext: vi.fn(),
  readToolCall: vi.fn(),
  readBrandIsDemo: vi.fn(),
  settleAgentRun: vi.fn(),
  chatAgenticEnabled: vi.fn(),
  runsWithoutSession: vi.fn(),
}));
vi.mock('./engine-store', () => ({ loadRun: fakes.loadRun }));
vi.mock('./engine', () => ({
  prepareResume: fakes.prepareResume,
  driveRun: fakes.driveRun,
  decideForEngine: fakes.decideForEngine,
}));
vi.mock('./precedence-context', () => ({
  readPrecedenceContext: fakes.readPrecedenceContext,
  readToolCall: fakes.readToolCall,
  readBrandIsDemo: fakes.readBrandIsDemo,
}));
vi.mock('./agent-driver', () => ({ settleAgentRun: fakes.settleAgentRun }));
vi.mock('./flag', () => ({ chatAgenticEnabled: fakes.chatAgenticEnabled }));
vi.mock('./registry/define-tool', () => ({ runsWithoutSession: fakes.runsWithoutSession }));
vi.mock('./registry/tools', () => ({
  chatTool: (name: string) =>
    name === 'create_draft'
      ? { name, class: 'write', inputSchema: z.object({ title: z.string() }) }
      : undefined,
}));

const { decideFromSlack, readSlackCard } = await import('./slack-approval');

const REF = { organizationId: ORG, brandId: BRAND, agentRunId: AGENT_RUN };
const APPROVE = { userId: SAM, decision: 'approve' as const, n: 3, digest: DIGEST };
const pending = {
  calls: [{ toolCallId: 'w1', toolName: 'create_draft', input: { title: 'Pricing FAQ' } }],
  index: 0,
  results: [],
  stepId: STEP,
  n: 3,
  digest: DIGEST,
  kind: 'ask',
  offerDontAskAgain: true,
};
const waitingRun = (over: Row = {}) => ({
  id: RUN,
  status: 'waiting',
  organizationId: ORG,
  userId: SAM,
  mode: 'ask_first',
  pending,
  progress: { writes: {}, tainted: false },
  ...over,
});
const writable = { plan: { writable: true }, brandAccess: 'all' };

let tasks: (() => Promise<void>)[];
const background = (task: () => Promise<void>) => void tasks.push(task);

beforeEach(() => {
  vi.clearAllMocks();
  tasks = [];
  db.tables = {
    chat_agent_runs: [{ id: AGENT_RUN, organization_id: ORG, brand_id: BRAND, agent_id: 'ag1' }],
    chat_conversations: [
      { id: CHAT, agent_run_id: AGENT_RUN, organization_id: ORG, brand_id: BRAND },
    ],
    chat_runs: [{ id: RUN, conversation_id: CHAT, parent_run_id: null }],
    chat_run_steps: [
      {
        id: STEP,
        run_id: RUN,
        position: 3,
        status: 'waiting',
        label: 'Save drafts in Content',
        detail: '“Pricing FAQ” on Northwind',
        finished_at: null,
      },
    ],
    chat_agents: [{ id: 'ag1', name: 'Content Writer' }],
    profiles: [{ id: SAM, full_name: 'Sam Lee' }],
    chat_activity_log: [],
  };
  fakes.loadRun.mockResolvedValue(waitingRun());
  fakes.chatAgenticEnabled.mockReturnValue(true);
  fakes.runsWithoutSession.mockReturnValue(true);
  fakes.readBrandIsDemo.mockResolvedValue(false);
  fakes.readPrecedenceContext.mockResolvedValue(writable);
  fakes.readToolCall.mockResolvedValue({ brandId: BRAND, brandIsDemo: false, tainted: false });
  fakes.decideForEngine.mockReturnValue({ kind: 'ask', reason: 'mode', offerDontAskAgain: true });
  fakes.prepareResume.mockImplementation(async (_a, _r, kind) => ({
    ok: true,
    resume: kind === 'approve' ? { kind: 'approve', dontAskAgain: false } : { kind: 'skip' },
  }));
  fakes.driveRun.mockResolvedValue(undefined);
  fakes.settleAgentRun.mockResolvedValue('running');
});

describe('readSlackCard', () => {
  it('reads the card the run waits on, in its step’s words', async () => {
    expect(await readSlackCard(REF)).toEqual({
      state: 'waiting',
      kind: 'ask',
      n: 3,
      digest: DIGEST,
      title: 'Save drafts in Content',
      target: '“Pricing FAQ” on Northwind',
      fromSlack: true,
      agent: 'Content Writer',
      person: 'Sam Lee',
      conversationId: CHAT,
      decided: null,
    });
  });

  it('works from Slack only for a change that runs without its person’s session', async () => {
    fakes.runsWithoutSession.mockReturnValue(false);
    expect((await readSlackCard(REF))?.fromSlack).toBe(false);
    fakes.runsWithoutSession.mockReturnValue(true);
    fakes.loadRun.mockResolvedValue(waitingRun({ pending: { ...pending, kind: 'click' } }));
    expect((await readSlackCard(REF))?.fromSlack).toBe(false);
  });

  it('finds nothing outside the post’s workspace and brand', async () => {
    expect(await readSlackCard({ ...REF, organizationId: OTHER_ORG })).toBeNull();
    expect(await readSlackCard({ ...REF, brandId: OTHER_BRAND })).toBeNull();
    fakes.loadRun.mockResolvedValue(waitingRun({ organizationId: OTHER_ORG }));
    expect(await readSlackCard(REF)).toBeNull();
  });

  it('says how the card the message showed ended', async () => {
    fakes.loadRun.mockResolvedValue(waitingRun({ status: 'done', pending: null }));
    db.tables.chat_run_steps[0] = {
      ...db.tables.chat_run_steps[0],
      status: 'done',
      finished_at: '2026-11-15T10:00:00Z',
    };
    db.tables.chat_activity_log = [
      { organization_id: ORG, step_id: STEP, summary_params: { via: 'slack' } },
    ];
    expect(await readSlackCard(REF, 3)).toMatchObject({
      state: 'decided',
      title: 'Save drafts in Content',
      decided: { how: 'approved', at: '2026-11-15T10:00:00Z', inSlack: true },
    });
    db.tables.chat_run_steps[0].status = 'skipped';
    expect((await readSlackCard(REF, 3))?.decided).toMatchObject({ how: 'rejected' });
    // Another card waiting now: this one is no longer the one.
    fakes.loadRun.mockResolvedValue(waitingRun({ pending: { ...pending, n: 5 } }));
    expect((await readSlackCard(REF, 3))?.state).toBe('decided');
  });
});

describe('decideFromSlack', () => {
  it('approves as the app does, as the run’s person, and the run goes on with no session', async () => {
    const answer = await decideFromSlack(REF, APPROVE, background);
    expect(answer).toMatchObject({
      outcome: 'approved',
      card: { title: 'Save drafts in Content' },
    });
    const actor = { userId: SAM, email: null, organizationId: ORG };
    expect(fakes.prepareResume).toHaveBeenCalledWith(actor, RUN, 'approve', {
      n: 3,
      digest: DIGEST,
    });
    expect(fakes.readPrecedenceContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SAM, organizationId: ORG, surface: 'chat' }),
    );
    expect(fakes.driveRun).not.toHaveBeenCalled();
    await Promise.all(tasks.map((task) => task()));
    expect(fakes.driveRun).toHaveBeenCalledWith(
      actor,
      RUN,
      { kind: 'approve', dontAskAgain: false, via: 'slack' },
      { sessionUserId: null },
    );
    expect(fakes.settleAgentRun).toHaveBeenCalledWith(AGENT_RUN);
  });

  it('rejects as the app’s Skip', async () => {
    const answer = await decideFromSlack(REF, { ...APPROVE, decision: 'reject' }, background);
    expect(answer.outcome).toBe('rejected');
    expect(fakes.prepareResume).toHaveBeenCalledWith(expect.anything(), RUN, 'skip', { n: 3 });
    await Promise.all(tasks.map((task) => task()));
    expect(fakes.driveRun).toHaveBeenCalledWith(
      expect.anything(),
      RUN,
      { kind: 'skip' },
      {
        sessionUserId: null,
      },
    );
  });

  it.each([
    [
      'Chat off for the workspace',
      'chat_off',
      () => fakes.chatAgenticEnabled.mockReturnValue(false),
    ],
    ['an agent run of another workspace', 'not_found', () => (db.tables.chat_agent_runs = [])],
    [
      'someone other than the run’s person',
      'not_yours',
      () => fakes.loadRun.mockResolvedValue(waitingRun({ userId: ZOE })),
    ],
    [
      'a card whose arguments changed',
      'changed',
      () =>
        fakes.loadRun.mockResolvedValue(
          waitingRun({ pending: { ...pending, digest: 'f'.repeat(32) } }),
        ),
    ],
    [
      'a change that needs its person’s session',
      'needs_app',
      () => fakes.runsWithoutSession.mockReturnValue(false),
    ],
    ['the demo brand', 'demo', () => fakes.readBrandIsDemo.mockResolvedValue(true)],
    [
      'someone no longer a member',
      'not_member',
      () => fakes.readPrecedenceContext.mockResolvedValue(null),
    ],
    [
      'a read-only workspace',
      'read_only',
      () =>
        fakes.readPrecedenceContext.mockResolvedValue({ ...writable, plan: { writable: false } }),
    ],
    [
      'no access to the brand',
      'forbidden',
      () =>
        fakes.readPrecedenceContext.mockResolvedValue({ ...writable, brandAccess: [OTHER_BRAND] }),
    ],
    [
      'a role that may not make the change (an Analyst)',
      'forbidden',
      () => fakes.decideForEngine.mockReturnValue({ kind: 'deny', denial: { code: 'role' } }),
    ],
  ])('refuses %s, and nothing moves', async (_name, reason, arrange) => {
    arrange();
    const answer = await decideFromSlack(REF, APPROVE, background);
    expect(answer).toMatchObject({ outcome: 'refused', reason });
    expect(fakes.prepareResume).not.toHaveBeenCalled();
    expect(tasks).toEqual([]);
  });

  it('answers a card decided already, in the app or by a first click, and changes nothing', async () => {
    fakes.loadRun.mockResolvedValue(waitingRun({ status: 'running', pending: null }));
    db.tables.chat_run_steps[0].status = 'done';
    expect(await decideFromSlack(REF, APPROVE, background)).toMatchObject({
      outcome: 'decided',
      card: { decided: { how: 'approved', inSlack: false } },
    });
    expect(fakes.prepareResume).not.toHaveBeenCalled();

    // A double click: the second finds the run taken already.
    fakes.loadRun.mockResolvedValue(waitingRun());
    db.tables.chat_run_steps[0].status = 'waiting';
    fakes.prepareResume.mockResolvedValue({ ok: false, status: 409, code: 'not_waiting' });
    expect((await decideFromSlack(REF, APPROVE, background)).outcome).toBe('decided');
    expect(tasks).toEqual([]);
  });

  it('passes on the engine’s own refusals', async () => {
    fakes.prepareResume.mockResolvedValue({
      ok: false,
      status: 402,
      code: 'subscription_inactive',
    });
    expect(await decideFromSlack(REF, APPROVE, background)).toMatchObject({ reason: 'read_only' });
    fakes.prepareResume.mockResolvedValue({ ok: false, status: 409, code: 'approval_mismatch' });
    expect(await decideFromSlack(REF, APPROVE, background)).toMatchObject({ reason: 'changed' });
    expect(tasks).toEqual([]);
  });
});
