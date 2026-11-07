// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';

/**
 * A run split into parts (CHAT-27 phase 1): 2–5 parts, one level only; each
 * part a child run made with its parent's id and title, all started
 * together; the parent shows "Working on N parts" with each part's status,
 * pauses at the shared cap with them, stops them with its Stop, and gets
 * what each found. The parts' driver here is a fake of the engine's, which
 * engine.test.ts runs for real.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { chatEvent } = await import('./events');
const { newProgress } = await import('./engine-store');
const { claimRunSlot } = await import('./run-limits');
const { CHAT_TOOLS, chatTool } = await import('./registry/tools');
const { withParts } = await import('./subtask-parts');
const { SUBTASKS_TOOL, partQuestion, partToolSet, partTools, runSubtasks, subtasksInput } =
  await import('./subtasks');
type SubtasksHost = import('./subtasks').SubtasksHost;
type ChatEvent = import('./events').ChatEvent;

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const CHAT = '44444444-4444-4444-8444-444444444444';
const PARENT = '55555555-5555-4555-8555-555555555555';

const TEAMMATE_RUN = '66666666-6666-4666-8666-666666666666';
/** A trial workspace runs 2 at once (run-limits.ts); Growth 10. */
const TRIAL = { planId: 'growth', isTrial: true } as const;
const GROWTH = { planId: 'growth', isTrial: false } as const;

const part = (title: string) => ({
  title,
  instruction: `Read ${title}'s citations, last 30 days.`,
});

let events: ChatEvent[];

beforeEach(() => {
  events = [];
  let clock = Date.parse('2026-11-07T09:00:00.000Z');
  const at = () => new Date((clock += 1000)).toISOString();
  Object.assign(db.tables, {
    chat_runs: [
      {
        id: PARENT,
        conversation_id: CHAT,
        message_id: 'answer',
        parent_run_id: null,
        status: 'running',
        created_at: at(),
      },
    ],
    chat_run_state: [{ run_id: PARENT, organization_id: ORG, user_id: USER, progress: {} }],
    chat_run_steps: [],
    chat_run_events: [],
  });
  // chat_claim_run_slot as 00406 counts: every running run of the workspace, parts included.
  db.rpcs = {
    chat_claim_run_slot: ({ p_run_id, p_workspace_limit }) => {
      const running = db.tables.chat_runs.filter((r) => r.status === 'running').length;
      if (running >= (p_workspace_limit as number)) return false;
      const run = db.tables.chat_runs.find((r) => r.id === p_run_id);
      if (!run || run.status !== 'queued') return false;
      run.status = 'running';
      run.started_at = new Date().toISOString();
      return true;
    },
  };
  Object.assign(db.defaults, {
    chat_runs: () => ({ created_at: at(), started_at: null, finished_at: null, error: null }),
    chat_run_state: () => ({
      messages: [],
      pending: null,
      working_ms: 0,
      last_seq: 0,
      waiting_since: null,
    }),
  });
});
afterEach(() => vi.useRealTimers());

const running = () => db.tables.chat_runs.filter((r) => r.status === 'running').map((r) => r.id);
const partRuns = () => db.tables.chat_runs.filter((r) => r.parent_run_id === PARENT);
const stateOf = (runId: string) => db.tables.chat_run_state.find((s) => s.run_id === runId)!;

/** A part as the engine's driver would end it: its status, answer, sources and a step. */
function endPart(runId: string, status: string, text: string, extra: Record<string, unknown> = {}) {
  db.tables.chat_runs.find((r) => r.id === runId)!.status = status;
  const state = stateOf(runId);
  state.progress = {
    ...(state.progress as object),
    text,
    sources: { Citations: 12 },
    dataAsOf: '2026-11-06T06:00:00.000Z',
    ...extra,
  };
  db.tables.chat_run_steps.push({
    id: `step-${runId}`,
    run_id: runId,
    position: 1,
    kind: 'read',
    status: 'done',
    label: 'Read Citations',
    detail: null,
    scope_json: null,
    row_count: 12,
    data_as_of: null,
    started_at: null,
    finished_at: null,
  });
}

function hostOf(overrides: Partial<SubtasksHost> = {}): SubtasksHost & {
  drive: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const progress = {
    ...newProgress('Europe/Istanbul', BRAND, 'write' as const),
    question: 'Compare my three competitors',
    scope: {
      context: { chips: [{ key: 'page', label: 'Citations', value: '/dashboard/citations' }] },
    },
  };
  return {
    run: {
      id: PARENT,
      conversationId: CHAT,
      organizationId: ORG,
      userId: USER,
      mode: 'auto',
      model: 'auto',
      effort: 'normal',
    },
    progress,
    // As a run's sink: every event is one the browser may get.
    sink: {
      emit: ((type: ChatEvent['type'], data: never) => {
        const event = chatEvent(type, events.length + 1, data);
        events.push(event);
        return event;
      }) as SubtasksHost['sink']['emit'],
    },
    signal: new AbortController().signal,
    endsAt: Date.now() + 300_000,
    claim: (runId: string) => claimRunSlot(runId, GROWTH),
    room: 48_000,
    logRead: false,
    drive: vi.fn(async (runId: string) => endPart(runId, 'done', `Found ${runId.slice(0, 4)}.`)),
    stop: vi.fn(async () => {}),
    ...overrides,
  } as never;
}

describe('run_subtasks', () => {
  it('takes 2 to 5 parts, each with a title and an instruction', () => {
    const parts = (n: number) => ({ parts: Array.from({ length: n }, (_, i) => part(`P${i}`)) });
    expect(subtasksInput.safeParse(parts(1)).success).toBe(false);
    expect(subtasksInput.safeParse(parts(2)).success).toBe(true);
    expect(subtasksInput.safeParse(parts(5)).success).toBe(true);
    expect(subtasksInput.safeParse(parts(6)).success).toBe(false);
    expect(
      subtasksInput.safeParse({ parts: [part('A'), { title: '', instruction: 'x' }] }).success,
    ).toBe(false);
    // The model's tool takes the same: the registry row's input is this schema.
    expect(chatTool(SUBTASKS_TOOL)!.inputSchema.safeParse(parts(6)).success).toBe(false);
  });

  it('is a read for every role and plan, never offered in a part', async () => {
    const row = chatTool(SUBTASKS_TOOL)!;
    expect(row).toMatchObject({ class: 'read', minRole: 'analyst', planGate: null, mcpTool: null });
    expect(await row.offerIn!({ agentRunId: null, parentRunId: null })).toBe(true);
    expect(await row.offerIn!({ agentRunId: 'agent-run', parentRunId: null })).toBe(true);
    expect(await row.offerIn!({ agentRunId: null, parentRunId: PARENT })).toBe(false);
  });

  it('gives a part reads only, and no question, parts check or next moves', () => {
    const tools = [...CHAT_TOOLS];
    expect(partTools(null, tools)).toBe(tools);
    const inPart = partTools(PARENT, tools);
    expect(inPart.length).toBeGreaterThan(0);
    expect(inPart.every((tool) => tool.class === 'read')).toBe(true);
    expect(inPart.map((tool) => tool.name)).not.toContain(SUBTASKS_TOOL);
    expect(inPart.map((tool) => tool.name)).not.toContain('run_agent');
    const set = partToolSet({
      read_x: {} as never,
      ask_question: {} as never,
      plan_parts: {} as never,
      suggest_next_moves: {} as never,
    });
    expect(Object.keys(set)).toEqual(['read_x']);
  });

  it("makes each part a child run with its parent's id and title, all started together", async () => {
    const host = hostOf();
    let working = 0;
    let most = 0;
    host.drive.mockImplementation(async (runId: string) => {
      working += 1;
      most = Math.max(most, working);
      await new Promise((resolve) => setTimeout(resolve, 20));
      working -= 1;
      endPart(runId, 'done', `Competitor ${runId.slice(0, 4)} has 12 citations.`);
    });
    const done = await runSubtasks(host, { parts: [part('B'), part('C'), part('D')] });

    expect(partRuns().map((r) => [r.subtask_title, r.message_id, r.conversation_id])).toEqual([
      ['B', null, CHAT],
      ['C', null, CHAT],
      ['D', null, CHAT],
    ]);
    // Started in the parent's slot, all three at once.
    expect(most).toBe(3);
    expect(partRuns().every((r) => r.started_at)).toBe(true);
    // Each part is the parent's person, mode, brand and page context, with its own instruction.
    for (const [i, r] of partRuns().entries()) {
      const state = stateOf(r.id as string);
      expect(state).toMatchObject({ organization_id: ORG, user_id: USER, mode: 'auto' });
      expect(state.progress).toMatchObject({
        brandId: BRAND,
        timezone: 'Europe/Istanbul',
        scope: host.progress.scope,
        question: partQuestion('Compare my three competitors', part(['B', 'C', 'D'][i]), i + 1, 3),
      });
    }

    // The parent gets each part's answer, and their sources and data date.
    expect(done.kind).toBe('result');
    if (done.kind !== 'result') return;
    expect(done.error).toBe(false);
    expect(done.untrusted).toBe(false);
    const value = done.value as { parts: Record<string, unknown>[] };
    expect(value.parts.map((p) => [p.part, p.title, p.status])).toEqual([
      [1, 'B', 'done'],
      [2, 'C', 'done'],
      [3, 'D', 'done'],
    ]);
    expect(value.parts[0].answer).toMatch(/has 12 citations/);
    expect(host.progress.sources).toEqual({ Citations: 36 });
    expect(host.progress.dataAsOf).toBe('2026-11-06T06:00:00.000Z');
    expect(host.progress.toolReads).toEqual({ run_subtasks: 1 });

    // One step: "Working on 3 parts", done, with each part and its own steps.
    const step = db.tables.chat_run_steps.find((s) => s.run_id === PARENT)!;
    expect(step).toMatchObject({
      label: 'Working on 3 parts',
      detail: '3 of 3 done',
      status: 'done',
      row_count: 3,
      scope_json: { unit: 'parts' },
      tool: SUBTASKS_TOOL,
    });
    const finished = events.filter((e) => e.type === 'step.finished').at(-1)!;
    expect(finished.data).toMatchObject({
      step: {
        label: 'Working on 3 parts',
        status: 'done',
        parts: [
          { title: 'B', status: 'done', steps: [{ label: 'Read Citations' }] },
          { title: 'C', status: 'done' },
          { title: 'D', status: 'done' },
        ],
      },
    });
    expect(events[0]).toMatchObject({
      type: 'step.started',
      data: { step: { status: 'running', parts: [{ status: 'running' }, {}, {}] } },
    });
  });

  it('names a failed part, and the others still count', async () => {
    const host = hostOf();
    host.drive.mockImplementation(async (runId: string) => {
      const title = db.tables.chat_runs.find((r) => r.id === runId)!.subtask_title;
      if (title === 'C') endPart(runId, 'error', "Couldn't read Search Console.");
      else endPart(runId, 'done', 'Read it.');
    });
    const done = await runSubtasks(host, { parts: [part('B'), part('C')] });
    if (done.kind !== 'result') throw new Error(done.kind);
    expect((done.value as { parts: unknown[] }).parts).toEqual([
      expect.objectContaining({ title: 'B', status: 'done' }),
      expect.objectContaining({
        title: 'C',
        status: 'failed',
        reason: 'It stopped on an error.',
        answer: "Couldn't read Search Console.",
      }),
    ]);
    expect(done.error).toBe(false);
  });

  it('carries outside text from a part back as untrusted', async () => {
    const host = hostOf({ logRead: true });
    host.drive.mockImplementation(async (runId: string) =>
      endPart(runId, 'done', 'A cited page says so.', { tainted: true }),
    );
    const done = await runSubtasks(host, { parts: [part('B'), part('C')] });
    expect(done).toMatchObject({ kind: 'result', untrusted: true });
    expect(host.progress.tainted).toBe(true);
    // In the reading phase, the writer reads the parts from the read log.
    expect(host.progress.readLog).toEqual([
      expect.objectContaining({ tool: SUBTASKS_TOOL, untrusted: true, source: 'Parts' }),
    ]);
  });

  it('pauses everyone at the shared cap: no part starts after it, the parent pauses too', async () => {
    const host = hostOf({ claim: (runId) => claimRunSlot(runId, TRIAL) });
    // The run's cap is the parent's and its parts' (reserve_chat_ai_usage sums the agent run):
    // the first part's next step is refused, so it pauses at the cap.
    host.drive.mockImplementation(async (runId: string) =>
      endPart(runId, 'paused_cap', 'Half read.', { capHit: 'run' }),
    );
    const done = await runSubtasks(host, { parts: [part('B'), part('C'), part('D')] });

    expect(done).toEqual({ kind: 'cap', limit: 'run' });
    expect(host.drive).toHaveBeenCalledTimes(1);
    expect(partRuns().map((r) => [r.subtask_title, r.status])).toEqual([
      ['B', 'paused_cap'],
      ['C', 'stopped'],
      ['D', 'stopped'],
    ]);
    const step = db.tables.chat_run_steps.find((s) => s.run_id === PARENT)!;
    expect(step).toMatchObject({ status: 'skipped', detail: 'Stopped at the AI limit' });
    expect(events.at(-1)).toMatchObject({
      type: 'step.finished',
      data: {
        step: { parts: [{ status: 'paused' }, { status: 'stopped' }, { status: 'stopped' }] },
      },
    });
    // A part at the cap holds no slot: only the parent runs.
    expect(running()).toEqual([PARENT]);
  });

  it('pauses at the month limit when that is what a part reached', async () => {
    const host = hostOf();
    host.drive.mockImplementation(async (runId: string) =>
      endPart(runId, 'paused_cap', '', { capHit: 'month' }),
    );
    expect(await runSubtasks(host, { parts: [part('B'), part('C')] })).toEqual({
      kind: 'cap',
      limit: 'month',
    });
  });

  it("stops every part with the parent's Stop", async () => {
    const controller = new AbortController();
    const host = hostOf({ signal: controller.signal });
    const stopped = new Set<string>();
    host.drive.mockImplementation(
      (runId: string) =>
        new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (!stopped.has(runId)) return;
            clearInterval(check);
            endPart(runId, 'stopped', '');
            resolve();
          }, 5);
        }),
    );
    host.stop.mockImplementation(async (runId: string) => {
      stopped.add(runId);
    });
    setTimeout(() => controller.abort(), 30);
    const done = await runSubtasks(host, { parts: [part('B'), part('C')] });

    expect(done).toEqual({ kind: 'stopped' });
    expect(host.stop.mock.calls.map(([id]) => id).sort()).toEqual(
      partRuns()
        .map((r) => r.id)
        .sort(),
    );
    const step = db.tables.chat_run_steps.find((s) => s.run_id === PARENT)!;
    expect(step).toMatchObject({ status: 'skipped', detail: 'Stopped' });
  });

  it('stops a part still working when its time is up, and says it timed out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const host = hostOf({ endsAt: Date.now() + 120_000 });
    host.drive.mockImplementation(async (runId: string) => {
      const title = db.tables.chat_runs.find((r) => r.id === runId)!.subtask_title;
      if (title === 'B') return endPart(runId, 'done', 'Read B.');
      // C works past the time (the request's limit less a minute for the answer).
      await new Promise<void>((resolve) => {
        host.stop.mockImplementation(async (id: string) => {
          if (id !== runId) return;
          endPart(runId, 'stopped', 'Half of C.');
          resolve();
        });
        vi.setSystemTime(Date.now() + 61_000);
      });
    });
    const done = await runSubtasks(host, { parts: [part('B'), part('C')] });
    if (done.kind !== 'result') throw new Error(done.kind);
    expect((done.value as { parts: unknown[] }).parts).toEqual([
      expect.objectContaining({ title: 'B', status: 'done' }),
      expect.objectContaining({ title: 'C', status: 'timed_out', answer: 'Half of C.' }),
    ]);
  });

  it('claims a slot for each part: on a trial the parent holds 1 of 2, so parts run one at a time', async () => {
    const host = hostOf({ claim: (runId) => claimRunSlot(runId, TRIAL) });
    let most = 0;
    let parts = 0;
    let mostParts = 0;
    host.drive.mockImplementation(async (runId: string) => {
      parts += 1;
      mostParts = Math.max(mostParts, parts);
      most = Math.max(most, running().length);
      await new Promise((resolve) => setTimeout(resolve, 10));
      parts -= 1;
      endPart(runId, 'done', 'Read it.');
    });
    const done = await runSubtasks(host, { parts: [part('B'), part('C'), part('D')] });

    expect(done.kind).toBe('result');
    expect(host.drive).toHaveBeenCalledTimes(3);
    expect(mostParts).toBe(1);
    expect(most).toBe(2);
    expect(partRuns().map((r) => r.status)).toEqual(['done', 'done', 'done']);
    expect(running()).toEqual([PARENT]);
  });

  it("lets a teammate's run take a slot once a part ends, and starts the next part when one frees up", async () => {
    db.tables.chat_runs.push({ id: TEAMMATE_RUN, conversation_id: 'their-chat', status: 'queued' });
    const host = hostOf({ claim: (runId) => claimRunSlot(runId, TRIAL) });
    const teammate: boolean[] = [];
    host.drive.mockImplementation(async (runId: string) => {
      const title = db.tables.chat_runs.find((r) => r.id === runId)!.subtask_title;
      if (title === 'B') {
        // B works a moment, while C finds no slot.
        await new Promise((resolve) => setTimeout(resolve, 20));
        // The parent and B hold both slots: the teammate waits.
        teammate.push(await claimRunSlot(TEAMMATE_RUN, TRIAL));
        endPart(runId, 'done', 'Read B.');
        // B ended: its slot is free, and the teammate takes it.
        teammate.push(await claimRunSlot(TEAMMATE_RUN, TRIAL));
        // The teammate's run ends a moment later; C starts then.
        setTimeout(() => {
          db.tables.chat_runs.find((r) => r.id === TEAMMATE_RUN)!.status = 'done';
        }, 30);
        return;
      }
      expect(db.tables.chat_runs.find((r) => r.id === TEAMMATE_RUN)!.status).toBe('done');
      endPart(runId, 'done', 'Read C.');
    });
    const done = await runSubtasks(host, { parts: [part('B'), part('C')] });

    expect(teammate).toEqual([false, true]);
    expect(done.kind).toBe('result');
    expect(partRuns().map((r) => [r.subtask_title, r.status])).toEqual([
      ['B', 'done'],
      ['C', 'done'],
    ]);
  });

  it('stops the parts that never got a slot when its time is up, and leaves none queued', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // A teammate's run holds the trial's other slot the whole time.
    db.tables.chat_runs.push({
      id: 'busy-run',
      conversation_id: 'their-chat',
      status: 'running',
    });
    const host = hostOf({
      endsAt: Date.now() + 120_000,
      // Each try that finds no slot comes 25 s later than the one before.
      claim: async (runId) => {
        const got = await claimRunSlot(runId, TRIAL);
        if (!got) vi.setSystemTime(Date.now() + 25_000);
        return got;
      },
    });
    const done = await runSubtasks(host, { parts: [part('B'), part('C')] });

    expect(host.drive).not.toHaveBeenCalled();
    if (done.kind !== 'result') throw new Error(done.kind);
    expect((done.value as { parts: unknown[] }).parts).toEqual([
      expect.objectContaining({
        title: 'B',
        status: 'not_started',
        reason: "It couldn't start: the workspace was busy.",
      }),
      expect.objectContaining({ title: 'C', status: 'not_started' }),
    ]);
    expect(done.error).toBe(true);
    expect(partRuns().map((r) => r.status)).toEqual(['stopped', 'stopped']);
  });

  it("frees each part's slot whichever way it ends", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = hostOf({ claim: (runId) => claimRunSlot(runId, TRIAL) });
    const ends: Record<string, string> = { B: 'done', C: 'error', D: 'stopped', E: 'running' };
    host.drive.mockImplementation(async (runId: string) => {
      const title = db.tables.chat_runs.find((r) => r.id === runId)!.subtask_title as string;
      // E's driver leaves it running, as a lost one would: it is ended all the same.
      endPart(runId, ends[title], `Part ${title}.`);
    });
    await runSubtasks(host, { parts: ['B', 'C', 'D', 'E'].map(part) });

    // One at a time on a trial, so each part started only once the one before freed its slot.
    expect(host.drive).toHaveBeenCalledTimes(4);
    expect(partRuns().map((r) => [r.subtask_title, r.status])).toEqual([
      ['B', 'done'],
      ['C', 'error'],
      ['D', 'stopped'],
      ['E', 'error'],
    ]);
    expect(running()).toEqual([PARENT]);
    vi.mocked(console.error).mockRestore();
  });

  it('starts no part when one could not be made', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.failures.chat_run_state = { message: 'insert failed' };
    const host = hostOf();
    const done = await runSubtasks(host, { parts: [part('B'), part('C')] });
    delete db.failures.chat_run_state;
    expect(done).toMatchObject({ kind: 'result', error: true, value: { code: 'failed' } });
    expect(host.drive).not.toHaveBeenCalled();
    expect(partRuns().map((r) => r.status)).toEqual(['stopped']);
    vi.mocked(console.error).mockRestore();
  });

  it('splits nothing with too little time left in the request', async () => {
    const host = hostOf({ endsAt: Date.now() + 70_000 });
    expect(await runSubtasks(host, { parts: [part('B'), part('C')] })).toMatchObject({
      kind: 'result',
      error: true,
      value: { code: 'no_time' },
    });
    expect(partRuns()).toEqual([]);
  });
});

describe('a reload', () => {
  it("puts each parts step's parts under it, in the order they were made", () => {
    const step = (n: number, count?: number) => ({
      n,
      kind: 'read' as const,
      status: 'done' as const,
      label: count ? `Working on ${count} parts` : 'Read Citations',
      ...(count ? { rowCount: count, scope: { unit: 'parts' as const } } : {}),
    });
    const run = (title: string, status: string) => ({ title, status, steps: [] });
    const steps = withParts(
      [step(3, 1), step(1, 2), step(2)],
      [run('A', 'done'), run('B', 'error'), run('C', 'paused_cap')],
    );
    expect(steps.map((s) => [s.n, s.parts?.map((p) => `${p.title}:${p.status}`)])).toEqual([
      [1, ['A:done', 'B:failed']],
      [2, undefined],
      [3, ['C:paused']],
    ]);
  });
});
