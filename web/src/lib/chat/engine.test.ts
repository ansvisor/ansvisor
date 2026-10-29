// @vitest-environment node
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import {
  BRAND,
  ORG,
  OTHER_ORG,
  PEOPLE,
  fakeCreateDraft,
  seedWorkspace,
} from './testing/chat-fixtures';

/**
 * Chat's engine (C3), with a scripted model and an in-memory database: a turn
 * streams as steps; Auto reads with Haiku and writes with Sonnet; a change
 * waits on its card, an EXECUTE on its click; Approve is bound to the card's
 * arguments; a refused hold starts nothing; a refusal is recorded; Stop and a
 * card left 7 days end the run; and no event names a tool or carries an id.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/actions/content-drafts', () => ({ createContentDraft: vi.fn() }));
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus: vi.fn() }));
vi.mock('@/lib/actions/prompt-suggestions', () => ({ dismissSuggestion: vi.fn() }));
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));

const fakes = vi.hoisted(() => ({
  readRun: vi.fn(),
  publishRun: vi.fn(),
  reserve: vi.fn(),
  resolveModels: vi.fn(),
}));
vi.mock('./budget', () => ({ reserveChatStep: fakes.reserve }));
vi.mock('./engine-model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engine-model')>()),
  resolveChatModels: fakes.resolveModels,
}));
// The registry's writes and request_access as they are; a read and an EXECUTE of the test's own.
vi.mock('./registry/tools', async (importOriginal) => {
  const real = await importOriginal<typeof import('./registry/tools')>();
  const { defineTool } = await import('./registry/define-tool');
  const { z } = await import('zod');
  const readVisibility = defineTool({
    name: 'read_visibility',
    class: 'read',
    area: 'visibility',
    description: "A brand's visibility.",
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C1',
    labelKey: 'visibility',
    route: null,
    mcpTool: null,
    specRow: 'test',
    inputSchema: z.object({
      brand_id: z.string(),
      date_from: z.string().optional(),
      date_to: z.string().optional(),
      platform: z.string().optional(),
    }),
    run: (ctx, input) => fakes.readRun(ctx, input),
    fixture: { input: { brand_id: 'x' } },
  });
  const publishPage = defineTool({
    name: 'publish_page',
    class: 'execute',
    executeGroup: 'publishing',
    area: 'content',
    description: 'Publish a page.',
    minRole: 'analyst',
    planGate: null,
    brandOf: { input: 'brand_id' },
    costClass: 'C0',
    labelKey: 'publishPage',
    route: null,
    mcpTool: null,
    specRow: 'test',
    inputSchema: z.object({ brand_id: z.string(), title: z.string() }),
    run: (ctx, input) => fakes.publishRun(ctx, input),
    fixture: { input: { brand_id: 'x', title: 'x' } },
  });
  // The same read under a name the engine trusts: the workspace's own numbers (§16a).
  const ownNumbers = { ...readVisibility, name: 'get_visibility_summary' };
  const tools = [
    readVisibility,
    ownNumbers,
    ...real.CHAT_TOOLS.filter((t) => t.class !== 'read'),
    publishPage,
  ];
  return {
    ...real,
    CHAT_TOOLS: tools,
    chatTool: (name: string) => tools.find((t) => t.name === name),
    chatToolByKey: (key: string) => tools.find((t) => t.labelKey === key),
  };
});

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { createContentDraft } = await import('@/lib/actions/content-drafts');
const { requestAccess } = await import('@/lib/actions/chat-access-requests');
const engine = await import('./engine');
const { readRunEvents } = await import('./engine-store');
const { runFromEvents } = await import('./run-state');
const { toClientStep } = await import('./steps');
const { CHAT_TOOLS } = await import('./registry/tools');
const { readPrecedenceContext } = await import('./precedence-context');

type ChatEvent = import('./events').ChatEvent;
type ChatActor = import('./engine').ChatActor;
type CallOptions = Parameters<MockLanguageModelV3['doStream']>[0];
type Mode = 'ask_first' | 'auto' | 'full_auto';

const OTHER_BRAND = '66666666-6666-4666-8666-666666666666';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DATA_AS_OF = '2026-10-28T06:00:00.000Z';

const actorOf = (userId: string): ChatActor => ({
  userId,
  email: 'person@example.com',
  organizationId: ORG,
});
const ADMIN = actorOf(PEOPLE.admin);
const ANALYST = actorOf(PEOPLE.analyst);

// ─── A scripted model ───────────────────────────────────────────────────────

const usage = (input = 120, output = 30) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
const toolCall = (id: string, name: string, input: unknown) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: name,
  input: JSON.stringify(input),
});
const calls = (...parts: object[]) => [
  ...parts,
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: usage() },
];
const text = (...chunks: string[]) => [
  { type: 'text-start', id: 't' },
  ...chunks.map((delta) => ({ type: 'text-delta', id: 't', delta })),
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: usage() },
];
const READY = text('{"ready":true}');

type Step = object[] | ((options: CallOptions) => ReadableStream);

function scripted(modelId: string, script: Step[]) {
  const seen: CallOptions[] = [];
  const model = new MockLanguageModelV3({
    modelId,
    doStream: async (options) => {
      seen.push(options);
      const next = script.shift();
      if (!next) throw new Error(`${modelId} has no more steps`);
      const stream =
        typeof next === 'function'
          ? next(options)
          : simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...next] });
      return { stream: stream as never };
    },
  });
  return { model, seen, script };
}

/** Auto: the read script for Haiku, the write script for Sonnet. */
function useModels(read: Step[], write: Step[]) {
  const haiku = scripted('claude-haiku-5-5', read);
  const sonnet = scripted('claude-sonnet-5-5', write);
  fakes.resolveModels.mockResolvedValue({
    source: 'ansvisor',
    phases: 'auto',
    pick: (phase: 'read' | 'write') => ({
      model: phase === 'read' ? haiku.model : sonnet.model,
      budgetModel: phase === 'read' ? 'anthropic/claude-haiku-5.5' : 'anthropic/claude-sonnet-5.5',
      maxOutputTokens: phase === 'read' ? 8_000 : 16_000,
      providerOptions: { anthropic: { structuredOutputMode: 'outputFormat' } },
      claude: true,
    }),
  });
  return { haiku, sonnet };
}

// ─── The budget ─────────────────────────────────────────────────────────────

const holds: {
  charge: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  keep: ReturnType<typeof vi.fn>;
}[] = [];

function budgetHolds() {
  fakes.reserve.mockImplementation(async () => {
    const hold = { charge: vi.fn(async () => {}), release: vi.fn(async () => {}), keep: vi.fn() };
    holds.push(hold);
    return { ok: true, budget: hold };
  });
}

// ─── The workspace ──────────────────────────────────────────────────────────

function seed() {
  seedWorkspace(db);
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Northwind' },
    { id: OTHER_BRAND, organization_id: OTHER_ORG, name: 'Elsewhere' },
  ];
  Object.assign(db.tables, {
    chat_conversations: [],
    chat_messages: [],
    chat_runs: [],
    chat_run_state: [],
    chat_run_steps: [],
    chat_run_events: [],
  });
  let clock = Date.parse('2026-10-29T09:00:00.000Z');
  const at = () => new Date((clock += 1000)).toISOString();
  Object.assign(db.defaults, {
    chat_conversations: () => ({ created_at: at() }),
    chat_messages: () => ({
      created_at: at(),
      generated_at: null,
      data_as_of: null,
      timezone: null,
    }),
    chat_runs: () => ({
      status: 'queued',
      model: 'auto',
      effort: 'normal',
      error: null,
      created_at: at(),
      started_at: null,
      finished_at: null,
    }),
    chat_run_state: () => ({
      messages: [],
      pending: null,
      working_ms: 0,
      last_seq: 0,
      waiting_since: null,
    }),
  });
  db.rpcs = {
    chat_run_limits: () => ({
      workspaceRunning: 0,
      userRunning: 0,
      messagesHour: 0,
      messagesDay: 0,
    }),
    chat_claim_run_slot: ({ p_run_id }) => {
      const run = db.tables.chat_runs.find((r) => r.id === p_run_id);
      if (!run || run.status !== 'queued') return false;
      run.status = 'running';
      return true;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  holds.length = 0;
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seed();
  budgetHolds();
  fakes.readRun.mockResolvedValue({
    rows: [{ prompt: 'best crm' }, { prompt: 'crm for teams' }, { prompt: 'crm pricing' }],
    data_as_of: DATA_AS_OF,
  });
  fakes.publishRun.mockResolvedValue({ published: true });
  vi.mocked(createContentDraft).mockImplementation(fakeCreateDraft(db) as never);
  vi.mocked(requestAccess).mockResolvedValue({ ok: true, id: 'request-1' });
});
afterEach(() => vi.unstubAllEnvs());

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Starts a turn and drives it until it waits or ends; its run id. */
async function turn(actor: ChatActor, message: string, mode: Mode = 'auto') {
  const started = await engine.startChatRun(actor, { message, brandId: BRAND, mode });
  if (!started.ok) throw new Error(`not started: ${started.code}`);
  await engine.driveRun(actor, started.runId);
  return started.runId;
}

const eventsOf = (runId: string) => readRunEvents(runId, 0);
const runRow = (runId: string) => db.tables.chat_runs.find((r) => r.id === runId)!;
const stepsOf = (runId: string) =>
  db.tables.chat_run_steps
    .filter((s) => s.run_id === runId)
    .sort((a, b) => (a.position as number) - (b.position as number));
const ofType = <K extends ChatEvent['type']>(events: ChatEvent[], type: K) =>
  events.filter((e): e is Extract<ChatEvent, { type: K }> => e.type === type);

/** No event names a tool, carries an id or holds an id field (CHAT-03 item 22). */
function expectClean(events: ChatEvent[]) {
  const json = JSON.stringify(events);
  for (const tool of CHAT_TOOLS) expect(json).not.toContain(tool.name);
  expect(json).not.toContain(engine.EXPLAIN_TOOL);
  expect(json).not.toMatch(UUID);
  expect(json).not.toMatch(/"(id|brand_id|brandId|tool|toolName|input|output)"\s*:/);
}

/** Approves (or clicks) the card the run waits on, as the person saw it, and drives on. */
async function approve(actor: ChatActor, runId: string, override: { digest?: string } = {}) {
  const confirm = ofType(await eventsOf(runId), 'confirm.required').at(-1)!.data;
  const prepared = await engine.prepareResume(actor, runId, 'approve', {
    n: confirm.n,
    digest: override.digest ?? confirm.digest,
  });
  if (prepared.ok) await engine.driveRun(actor, runId, prepared.resume);
  return prepared;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('a turn', () => {
  it('reads with Haiku, writes with Sonnet, and streams steps, text and its timestamps', async () => {
    const { haiku, sonnet } = useModels(
      [
        calls(toolCall('r1', 'read_visibility', { brand_id: BRAND, platform: 'chatgpt-web' })),
        READY,
      ],
      [text('Visibility is ', 'up 12% on ChatGPT.')],
    );
    const runId = await turn(ADMIN, 'How is my brand doing?');
    const events = await eventsOf(runId);

    // Haiku got the reads only, a structured "ready" and Claude 5.5's settings.
    const read = haiku.seen[0];
    expect(read.tools?.map((t) => t.name)).toEqual(['read_visibility', 'get_visibility_summary']);
    expect(read.responseFormat).toMatchObject({ type: 'json' });
    expect(read.toolChoice).toEqual({ type: 'auto' });
    expect(read.maxOutputTokens).toBe(8_000);
    for (const options of [...haiku.seen, ...sonnet.seen]) {
      expect(options.temperature).toBeUndefined();
      expect(options.topP).toBeUndefined();
      expect(options.topK).toBeUndefined();
    }
    // Sonnet wrote from what was read, with every offered tool.
    const write = sonnet.seen[0];
    expect(write.maxOutputTokens).toBe(16_000);
    expect(write.responseFormat?.type ?? 'text').toBe('text');
    expect(write.tools?.map((t) => t.name)).toContain('create_draft');
    expect(JSON.stringify(write.prompt)).toContain('crm pricing');

    // Each model step was held on the budget first, by its own model, and charged.
    expect(fakes.reserve.mock.calls.map(([step]) => step.model)).toEqual([
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-sonnet-5.5',
    ]);
    expect(holds.every((h) => h.charge.mock.calls.length === 1)).toBe(true);

    const [started, finished] = [
      ofType(events, 'step.started')[0],
      ofType(events, 'step.finished')[0],
    ];
    expect(started.data.step).toMatchObject({
      n: 1,
      kind: 'read',
      status: 'running',
      label: 'Read Visibility',
    });
    expect(finished.data.step).toMatchObject({
      status: 'done',
      rowCount: 3,
      dataAsOf: DATA_AS_OF,
      detail: 'Last 30 days · ChatGPT · 3 rows',
      scope: { dateRange: 'Last 30 days', platforms: ['ChatGPT'] },
    });
    expect(
      ofType(events, 'text.delta')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('Visibility is up 12% on ChatGPT.');
    const end = ofType(events, 'run.finished')[0].data;
    expect(end).toMatchObject({
      stepCount: 1,
      dataAsOf: DATA_AS_OF,
      sources: [{ label: 'Visibility', count: 3 }],
    });
    expect(Date.parse(end.generatedAt)).not.toBeNaN();

    // The answer is kept with "Generated" and "Data as of"; never a tool's output.
    const answer = db.tables.chat_messages.find((m) => m.role === 'assistant')!;
    expect(answer).toMatchObject({
      content_md: 'Visibility is up 12% on ChatGPT.',
      generated_at: end.generatedAt,
      data_as_of: DATA_AS_OF,
    });
    expect(runRow(runId).status).toBe('done');
    expectClean(events);
  });

  it('rebuilds the same steps and text from its events after a reload', async () => {
    useModels(
      [
        calls(
          toolCall('r1', 'read_visibility', {
            brand_id: BRAND,
            date_from: '2026-10-01',
            date_to: '2026-10-15',
          }),
        ),
        READY,
      ],
      [text('Done.')],
    );
    const runId = await turn(ADMIN, 'Citations this month?');
    const rebuilt = runFromEvents(await eventsOf(runId));
    const stored = stepsOf(runId).map((row) => toClientStep(row as never));
    expect(rebuilt.steps).toEqual(stored);
    expect(rebuilt.steps[0].detail).toBe('Oct 1 – Oct 15 · 3 rows');
    expect(rebuilt.text).toBe('Done.');
    expect(rebuilt.status).toBe('done');
    // Replaying twice, or from the middle, changes nothing.
    const events = await eventsOf(runId);
    expect(runFromEvents([...events, ...events])).toEqual(rebuilt);
  });

  it('hides ids in the streamed answer, even split across chunks', async () => {
    useModels([READY], [text(`The brand ${BRAND.slice(0, 10)}`, `${BRAND.slice(10)} is fine.`)]);
    const runId = await turn(ADMIN, 'Which brand?');
    const events = await eventsOf(runId);
    expect(
      ofType(events, 'text.delta')
        .map((e) => e.data.text)
        .join(''),
    ).toBe('The brand … is fine.');
    expectClean(events);
  });
});

describe("a read's scope (W1-17)", () => {
  const readInput = () => fakes.readRun.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  it('reads the last 30 days when no dates are given, and says so on the step', async () => {
    useModels(
      [calls(toolCall('r1', 'read_visibility', { brand_id: BRAND })), READY],
      [text('Ok.')],
    );
    const runId = await turn(ADMIN, 'How are we doing?');
    expect(readInput()).toMatchObject({ date_from: day(-30), date_to: day(0) });
    const step = stepsOf(runId)[0];
    expect(step.scope_json).toMatchObject({
      dateRange: 'Last 30 days',
      used: { dates: 'default', dateFrom: day(-30), dateTo: day(0) },
    });
  });

  it('reads all time only when the person asks for it', async () => {
    useModels(
      [calls(toolCall('r1', 'read_visibility', { brand_id: BRAND })), READY],
      [text('Ok.')],
    );
    const runId = await turn(ADMIN, 'How have we done since we started?');
    expect(readInput().date_from).toBeUndefined();
    expect(readInput().date_to).toBeUndefined();
    expect(stepsOf(runId)[0].detail).toBe('All time · 3 rows');
  });

  it("doesn't read a platform the plan doesn't track, and tells the model why", async () => {
    db.tables.organizations[0].plan = 'starter';
    const { sonnet } = useModels(
      [
        calls(toolCall('r1', 'read_visibility', { brand_id: BRAND, platform: 'perplexity-web' })),
        READY,
      ],
      [text('Your plan tracks ChatGPT and Copilot.')],
    );
    const runId = await turn(ADMIN, 'How do we do on Perplexity?');
    expect(fakes.readRun).not.toHaveBeenCalled();
    expect(stepsOf(runId)).toHaveLength(0);
    const sent = JSON.stringify(sonnet.seen[0].prompt);
    expect(sent).toContain('not_on_plan');
    expect(sent).toContain('Starter');
  });

  it('cuts a long list to its row limit and says it was cut', async () => {
    fakes.readRun.mockResolvedValue({
      rows: Array.from({ length: 60 }, (_, i) => ({ prompt: `prompt ${i}` })),
    });
    const { sonnet } = useModels(
      [calls(toolCall('r1', 'read_visibility', { brand_id: BRAND })), READY],
      [text('Ok.')],
    );
    const runId = await turn(ADMIN, 'Which prompts?');
    expect(stepsOf(runId)[0].row_count).toBe(50);
    const sent = JSON.stringify(sonnet.seen[0].prompt);
    expect(sent).toContain('\\"rows_more\\":10');
    expect(sent).toContain('\\"truncated\\":true');
    expect(sent).not.toContain('prompt 55');
  });
});

describe('changes wait for the person', () => {
  it('never runs an EXECUTE without the click, even in Full auto', async () => {
    const { sonnet } = useModels(
      [READY],
      [
        calls(toolCall('w1', 'publish_page', { brand_id: BRAND, title: 'Pricing FAQ' })),
        text('Published.'),
      ],
    );
    const runId = await turn(ADMIN, 'Publish the pricing FAQ', 'full_auto');

    expect(fakes.publishRun).not.toHaveBeenCalled();
    expect(runRow(runId).status).toBe('waiting');
    expect(stepsOf(runId)[0]).toMatchObject({ kind: 'execute', status: 'waiting' });
    const confirm = ofType(await eventsOf(runId), 'confirm.required')[0].data;
    expect(confirm).toMatchObject({
      n: 1,
      target: 'Pricing FAQ · Northwind',
      canDontAskAgain: false,
    });
    expect(sonnet.seen).toHaveLength(1);

    // The click runs it once, logged as a click.
    expect((await approve(ADMIN, runId)).ok).toBe(true);
    expect(fakes.publishRun).toHaveBeenCalledTimes(1);
    expect(db.tables.chat_activity_log).toEqual([
      expect.objectContaining({
        kind: 'change',
        class: 'execute',
        approval_kind: 'click',
        tool_key: 'publishPage',
      }),
    ]);
    expect(runRow(runId).status).toBe('done');
    expectClean(await eventsOf(runId));
  });

  it('runs a change only for the arguments its card showed (approval_mismatch)', async () => {
    useModels(
      [READY],
      [
        calls(
          toolCall('w1', 'create_draft', {
            brand_id: BRAND,
            title: 'Pricing FAQ',
            page_type: 'docs_faq',
            source: { kind: 'content' },
          }),
        ),
        text('Saved the draft.'),
      ],
    );
    const runId = await turn(ADMIN, 'Draft a pricing FAQ', 'ask_first');
    expect(runRow(runId).status).toBe('waiting');

    const stale = await approve(ADMIN, runId, { digest: 'f'.repeat(32) });
    expect(stale).toMatchObject({ ok: false, status: 409, code: 'approval_mismatch' });
    expect(createContentDraft).not.toHaveBeenCalled();
    expect(runRow(runId).status).toBe('waiting');
    // The card is shown again, with the arguments it really holds.
    const cards = ofType(await eventsOf(runId), 'confirm.required');
    expect(cards).toHaveLength(2);
    expect(cards[1].data.digest).toBe(cards[0].data.digest);

    expect((await approve(ADMIN, runId)).ok).toBe(true);
    expect(createContentDraft).toHaveBeenCalledTimes(1);
    expect(stepsOf(runId)[0]).toMatchObject({ status: 'done', label: 'Saved draft in Content' });
    expect(db.tables.chat_activity_log[0]).toMatchObject({
      approval_kind: 'ask',
      mode: 'ask_first',
    });
    expect(runRow(runId).status).toBe('done');
  });

  it('runs the arguments the card showed, as the tool reads them: defaults filled, text trimmed', async () => {
    useModels(
      [READY],
      [
        calls(
          toolCall('w1', 'create_draft', {
            brand_id: BRAND,
            title: '  Pricing FAQ  ',
            page_type: 'docs_faq',
            source: { kind: 'content' },
          }),
        ),
        text('Saved the draft.'),
      ],
    );
    const runId = await turn(ADMIN, 'Draft a pricing FAQ', 'ask_first');
    expect((await approve(ADMIN, runId)).ok).toBe(true);
    expect(createContentDraft).toHaveBeenCalledWith(
      BRAND,
      expect.objectContaining({ method: 'create', title: 'Pricing FAQ' }),
    );
  });

  it("doesn't take the same approval twice", async () => {
    useModels(
      [READY],
      [
        calls(
          toolCall('w1', 'create_draft', {
            brand_id: BRAND,
            title: 'Pricing FAQ',
            page_type: 'docs_faq',
            source: { kind: 'content' },
          }),
        ),
        text('Saved.'),
      ],
    );
    const runId = await turn(ADMIN, 'Draft it', 'ask_first');
    const confirm = ofType(await eventsOf(runId), 'confirm.required')[0].data;
    const body = { n: confirm.n, digest: confirm.digest };
    const [first, second] = await Promise.all([
      engine.prepareResume(ADMIN, runId, 'approve', body),
      engine.prepareResume(ADMIN, runId, 'approve', body),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect([first, second].find((r) => !r.ok)).toMatchObject({ code: 'not_waiting' });
  });

  it('tells the model a skipped change was skipped, and goes on', async () => {
    const { sonnet } = useModels(
      [READY],
      [
        calls(
          toolCall('w1', 'create_draft', {
            brand_id: BRAND,
            title: 'Pricing FAQ',
            page_type: 'docs_faq',
            source: { kind: 'content' },
          }),
        ),
        text('Left it.'),
      ],
    );
    const runId = await turn(ADMIN, 'Draft it', 'auto');
    const prepared = await engine.prepareResume(ADMIN, runId, 'skip', { n: 1 });
    expect(prepared.ok).toBe(true);
    if (prepared.ok) await engine.driveRun(ADMIN, runId, prepared.resume);
    expect(createContentDraft).not.toHaveBeenCalled();
    expect(stepsOf(runId)[0]).toMatchObject({ status: 'skipped', detail: 'Skipped' });
    expect(JSON.stringify(sonnet.seen[1].prompt)).toContain('skipped');
    expect(runRow(runId).status).toBe('done');
  });
});

describe('what a read brings in (§16a)', () => {
  const draftCall = calls(
    toolCall('w1', 'create_draft', {
      brand_id: BRAND,
      title: 'Pricing FAQ',
      page_type: 'docs_faq',
      source: { kind: 'content' },
    }),
  );

  it('shows a card for a change after a read of outside text, even in Full auto', async () => {
    const { sonnet } = useModels(
      [calls(toolCall('r1', 'read_visibility', { brand_id: BRAND })), READY],
      [draftCall, text('Saved.')],
    );
    const runId = await turn(ADMIN, 'Draft a page from what AI says', 'full_auto');
    expect(createContentDraft).not.toHaveBeenCalled();
    expect(runRow(runId).status).toBe('waiting');
    expect(ofType(await eventsOf(runId), 'confirm.required')).toHaveLength(1);
    // What was read reaches the writer as data, marked so.
    expect(JSON.stringify(sonnet.seen[0].prompt)).toContain('<read_results>');
  });

  it("runs it without a card in Full auto after reading the workspace's own numbers only", async () => {
    useModels(
      [calls(toolCall('r1', 'get_visibility_summary', { brand_id: BRAND })), READY],
      [draftCall, text('Saved.')],
    );
    const runId = await turn(ADMIN, 'Draft a pricing FAQ', 'full_auto');
    expect(createContentDraft).toHaveBeenCalledTimes(1);
    expect(runRow(runId).status).toBe('done');
  });
});

describe('the AI budget', () => {
  it("doesn't start a step whose hold is refused, and says why", async () => {
    const { haiku, sonnet } = useModels([READY], [text('never')]);
    fakes.reserve.mockResolvedValueOnce({
      ok: false,
      refusal: 'unavailable',
      trial: false,
      retryable: true,
      message: "Chat couldn't check your AI usage just now, so it didn't start this step.",
    });
    const runId = await turn(ADMIN, 'Hello');
    expect(haiku.seen).toHaveLength(0);
    expect(sonnet.seen).toHaveLength(0);
    expect(runRow(runId)).toMatchObject({ status: 'error', error: 'failed' });
    expect(ofType(await eventsOf(runId), 'run.error')[0].data).toMatchObject({
      code: 'failed',
      reason: "Chat couldn't check your AI usage just now, so it didn't start this step.",
    });
  });

  it('pauses at the cap when the month’s AI limit is used', async () => {
    const { sonnet } = useModels([READY], [text('never')]);
    fakes.reserve
      .mockImplementationOnce(async () => {
        const hold = {
          charge: vi.fn(async () => {}),
          release: vi.fn(async () => {}),
          keep: vi.fn(),
        };
        holds.push(hold);
        return { ok: true, budget: hold };
      })
      .mockResolvedValueOnce({
        ok: false,
        refusal: 'ai_limit',
        trial: false,
        retryable: false,
        message: 'x',
      });
    const runId = await turn(ADMIN, 'Hello');
    expect(sonnet.seen).toHaveLength(0);
    expect(runRow(runId).status).toBe('paused_cap');
    expect(ofType(await eventsOf(runId), 'run.paused_cap')).toHaveLength(1);
  });
});

describe('refusals', () => {
  it('shows the out-of-permission answer and records each refusal', async () => {
    const { sonnet } = useModels(
      [READY],
      [
        calls(
          toolCall('x1', engine.EXPLAIN_TOOL, {
            capability: 'opportunityStatus',
            target: 'Pricing page',
          }),
          toolCall('w1', 'create_draft', {
            brand_id: OTHER_BRAND,
            title: 'Their FAQ',
            page_type: 'docs_faq',
            source: { kind: 'content' },
          }),
        ),
        text("I can't do that."),
      ],
    );
    const runId = await turn(ANALYST, 'Dismiss the pricing opportunity');

    // The analyst's list leaves the Manager's write out, with its reason to explain.
    const offered = sonnet.seen[0].tools?.map((t) => t.name) ?? [];
    expect(offered).not.toContain('update_opportunity');
    expect(offered).toContain(engine.EXPLAIN_TOOL);

    const denials = ofType(await eventsOf(runId), 'access.denied').map((e) => e.data);
    expect(denials).toEqual([
      expect.objectContaining({
        asked: 'You asked: Review or dismiss opportunities · Pricing page.',
        rule: expect.objectContaining({ kind: 'role' }),
        nextActions: ['ask_admin', 'see_access'],
      }),
      // Another workspace's brand: refused without naming it.
      expect.objectContaining({
        asked: 'You asked: Save drafts in Content.',
        rule: expect.objectContaining({ kind: 'brand' }),
      }),
    ]);
    expect(db.tables.chat_activity_log).toEqual([
      expect.objectContaining({
        kind: 'access.denied',
        tool_key: 'opportunityStatus',
        denial_code: 'forbidden_role',
        run_id: runId,
      }),
      expect.objectContaining({
        kind: 'access.denied',
        tool_key: 'saveDraft',
        denial_code: 'brand_scope',
        brand_id: null,
      }),
    ]);
    expect(createContentDraft).not.toHaveBeenCalled();
    expectClean(await eventsOf(runId));
  });

  it('lets a request to the Admins through a read-only workspace, and nothing else', async () => {
    const { sonnet } = useModels(
      [READY],
      [
        calls(
          toolCall('a1', 'request_access', {
            asked: 'Add competitors · Peec AI',
            rule_kind: 'role',
          }),
        ),
      ],
    );
    const runId = await turn(ANALYST, 'Ask my admin');
    expect(runRow(runId).status).toBe('waiting');

    // The trial ends while the card waits.
    db.tables.organizations[0].subscription_status = 'canceled';
    const ctx = await readPrecedenceContext({
      userId: PEOPLE.analyst,
      organizationId: ORG,
      mode: 'auto',
      surface: 'chat',
    });
    const call = { brandId: null, brandIsDemo: false, tainted: false };
    const ask = CHAT_TOOLS.find((t) => t.name === 'request_access')!;
    const draft = CHAT_TOOLS.find((t) => t.name === 'create_draft')!;
    expect(engine.decideForEngine(ask, ctx, call).kind).toBe('ask');
    expect(engine.decideForEngine(draft, ctx, { ...call, brandId: BRAND })).toMatchObject({
      kind: 'deny',
      denial: { code: 'subscription_inactive' },
    });

    expect((await approve(ANALYST, runId)).ok).toBe(true);
    expect(requestAccess).toHaveBeenCalledWith(
      expect.objectContaining({ asked: 'Add competitors · Peec AI', ruleKind: 'role' }),
    );
    // No model step it couldn't pay for: the run ends after the request.
    expect(sonnet.seen).toHaveLength(1);
    expect(runRow(runId).status).toBe('done');
    expect(stepsOf(runId)[0]).toMatchObject({ status: 'done', label: 'Sent to your Admins' });

    // A new message, or any other change, gets the read-only answer.
    expect(await engine.startChatRun(ANALYST, { message: 'Hi', brandId: BRAND })).toMatchObject({
      ok: false,
      status: 402,
      code: 'subscription_inactive',
    });
  });

  it('refuses an approval other than the request while read-only', async () => {
    useModels(
      [READY],
      [
        calls(
          toolCall('w1', 'create_draft', {
            brand_id: BRAND,
            title: 'Pricing FAQ',
            page_type: 'docs_faq',
            source: { kind: 'content' },
          }),
        ),
      ],
    );
    const runId = await turn(ADMIN, 'Draft it', 'ask_first');
    db.tables.organizations[0].subscription_status = 'canceled';
    expect(await approve(ADMIN, runId)).toMatchObject({ ok: false, status: 402 });
    expect(createContentDraft).not.toHaveBeenCalled();
    expect(runRow(runId).status).toBe('waiting');
  });
});

describe('Stop', () => {
  it('keeps the text so far and the step’s hold, and says how long it worked', async () => {
    useModels(
      [READY],
      [
        (options) =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'text-start', id: 't' });
              controller.enqueue({ type: 'text-delta', id: 't', delta: 'Half an answer. ' });
              options.abortSignal?.addEventListener('abort', () =>
                controller.error(new DOMException('Aborted', 'AbortError')),
              );
            },
          }),
      ],
    );
    const started = await engine.startChatRun(ADMIN, { message: 'Long answer', brandId: BRAND });
    if (!started.ok) throw new Error('not started');
    const driving = engine.driveRun(ADMIN, started.runId);
    await vi.waitFor(() =>
      expect(db.tables.chat_run_events.some((e) => e.type === 'text.delta')).toBe(true),
    );
    expect(await engine.stopChatRun(ADMIN, started.runId)).toEqual({ ok: true });
    await driving;

    const events = await eventsOf(started.runId);
    const stopped = ofType(events, 'run.stopped')[0].data;
    expect(stopped.reason).toBe('person');
    expect(stopped.workingMs).toBeGreaterThan(0);
    expect(runRow(started.runId).status).toBe('stopped');
    // The provider bills the aborted call: its hold stays as its cost.
    expect(holds.at(-1)!.keep).toHaveBeenCalled();
    expect(holds.at(-1)!.charge).not.toHaveBeenCalled();
    expect(db.tables.chat_messages.find((m) => m.role === 'assistant')!.content_md).toBe(
      'Half an answer. ',
    );
    expect(runFromEvents(events).status).toBe('stopped');
  });

  it('turns the running step skipped: "Stopped"', async () => {
    useModels([calls(toolCall('r1', 'read_visibility', { brand_id: BRAND }))], []);
    fakes.readRun.mockImplementation(() => new Promise(() => {}));
    const started = await engine.startChatRun(ADMIN, { message: 'Read', brandId: BRAND });
    if (!started.ok) throw new Error('not started');
    const driving = engine.driveRun(ADMIN, started.runId);
    await vi.waitFor(() => expect(stepsOf(started.runId)).toHaveLength(1));
    await engine.stopChatRun(ADMIN, started.runId);
    await driving;
    expect(stepsOf(started.runId)[0]).toMatchObject({ status: 'skipped', detail: 'Stopped' });
    expect(ofType(await eventsOf(started.runId), 'run.stopped')).toHaveLength(1);
  });

  it('ends a run that waits on its card at once', async () => {
    useModels(
      [READY],
      [
        calls(
          toolCall('w1', 'create_draft', {
            brand_id: BRAND,
            title: 'Pricing FAQ',
            page_type: 'docs_faq',
            source: { kind: 'content' },
          }),
        ),
      ],
    );
    const runId = await turn(ADMIN, 'Draft it', 'ask_first');
    await engine.stopChatRun(ADMIN, runId);
    expect(runRow(runId).status).toBe('stopped');
    expect(stepsOf(runId)[0]).toMatchObject({ status: 'skipped', detail: 'Stopped' });
    expect(ofType(await eventsOf(runId), 'run.stopped')[0].data.reason).toBe('person');
  });
});

describe('the sweep', () => {
  it('stops a run whose card waited 7 days, and leaves a newer one', async () => {
    const draftCall = calls(
      toolCall('w1', 'create_draft', {
        brand_id: BRAND,
        title: 'Pricing FAQ',
        page_type: 'docs_faq',
        source: { kind: 'content' },
      }),
    );
    useModels([READY, READY], [draftCall, [...draftCall]]);
    const old = await turn(ADMIN, 'Draft it', 'ask_first');
    const recent = await turn(ADMIN, 'Draft another', 'ask_first');
    const now = new Date('2026-11-10T12:00:00.000Z');
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    db.tables.chat_run_state.find((s) => s.run_id === old)!.waiting_since = daysAgo(8);
    db.tables.chat_run_state.find((s) => s.run_id === recent)!.waiting_since = daysAgo(6);

    expect(await engine.sweepChatRuns(now)).toEqual({ expired: 1, lost: 0 });
    expect(runRow(old).status).toBe('stopped');
    expect(stepsOf(old)[0]).toMatchObject({ status: 'skipped', detail: 'No answer in 7 days' });
    expect(ofType(await eventsOf(old), 'run.stopped')[0].data.reason).toBe('expired');
    expect(runRow(recent).status).toBe('waiting');
    // Twice is safe.
    expect(await engine.sweepChatRuns(now)).toEqual({ expired: 0, lost: 0 });
  });
});

describe('starting', () => {
  it('queues a run while every slot is busy', async () => {
    useModels([READY], [text('Hi.')]);
    db.rpcs.chat_run_limits = () => ({
      workspaceRunning: 10,
      userRunning: 1,
      messagesHour: 0,
      messagesDay: 0,
    });
    const started = await engine.startChatRun(ADMIN, { message: 'Hello', brandId: BRAND });
    expect(started).toMatchObject({ ok: true, queued: true });
    if (started.ok) expect(runRow(started.runId).status).toBe('queued');
  });

  it('refuses past the hour’s messages, and a chat that isn’t the person’s', async () => {
    db.rpcs.chat_run_limits = () => ({
      workspaceRunning: 0,
      userRunning: 0,
      messagesHour: 60,
      messagesDay: 60,
    });
    expect(await engine.startChatRun(ADMIN, { message: 'Hello' })).toMatchObject({
      ok: false,
      status: 429,
      code: 'rate_limited',
    });
    db.rpcs.chat_run_limits = () => ({
      workspaceRunning: 0,
      userRunning: 0,
      messagesHour: 0,
      messagesDay: 0,
    });
    db.tables.chat_conversations.push({
      id: OTHER_BRAND,
      user_id: PEOPLE.manager,
      organization_id: ORG,
    });
    expect(
      await engine.startChatRun(ADMIN, { message: 'Hello', conversationId: OTHER_BRAND }),
    ).toMatchObject({ ok: false, status: 404 });
  });
});
