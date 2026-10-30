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
 * arguments; a refused hold starts nothing; a refusal is recorded; a question
 * card waits for its answer, once; next moves come with the final answer, for
 * the person's role; Stop and a card left 7 days end the run;
 * and no event names a tool or carries an id.
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
const { ASK_TOOL } = await import('./asks');
const { NEXT_MOVES_TOOL } = await import('./next-moves');

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
    chat_asks: [],
    chat_next_moves: [],
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
    chat_asks: () => ({ answer_json: null, answered_at: null, created_at: at() }),
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

/** chat-files: what was put in it (a deliverable's file, CHAT-06 item 9). */
let uploads: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  holds.length = 0;
  uploads = [];
  Object.assign(db, {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { error: null };
        },
      }),
    },
  });
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

/**
 * No event names a tool, carries an id or holds an id field (CHAT-03 item
 * 22). A link's path to an app page may hold one (an output card's draft in
 * the editor): never shown, as chatEvent keeps it.
 */
function expectClean(events: ChatEvent[]) {
  const json = JSON.stringify(events, (key, value) => (key === 'href' ? undefined : value));
  for (const tool of CHAT_TOOLS) expect(json).not.toContain(tool.name);
  expect(json).not.toContain(engine.EXPLAIN_TOOL);
  expect(json).not.toContain(ASK_TOOL);
  expect(json).not.toContain(NEXT_MOVES_TOOL);
  expect(json).not.toContain('continues_this_run');
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
      detail: 'All time · ChatGPT · 3 rows',
      scope: { dateRange: 'All time', platforms: ['ChatGPT'] },
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

  it('files the page it saved in Files and shows it as an output card (CHAT-06 items 1, 9)', async () => {
    useModels(
      [READY],
      [
        calls(
          toolCall('w1', 'create_draft', {
            brand_id: BRAND,
            title: 'Pricing FAQ',
            page_type: 'docs_faq',
            source: { kind: 'content' },
            body_html: '<h1>Pricing FAQ</h1><p>Answers.</p>',
          }),
        ),
        text('Saved the draft.'),
      ],
    );
    const runId = await turn(ADMIN, 'Draft a pricing FAQ', 'ask_first');
    expect((await approve(ADMIN, runId)).ok).toBe(true);
    const draftId = db.tables.content_drafts.at(-1)!.id;
    const file = (db.tables.chat_files ?? []).find((f) => f.run_id === runId)!;
    expect(file).toMatchObject({
      type: 'document',
      title: 'Pricing FAQ',
      mime_type: 'text/html',
      origin: 'chat',
      message_id: null,
      content_draft_id: draftId,
    });
    expect(uploads).toEqual([`${ORG}/${file.id}/page.html`]);
    const cards = ofType(await eventsOf(runId), 'deliverable.created');
    expect(cards.map((c) => c.data)).toEqual([
      {
        title: 'Pricing FAQ',
        type: 'document',
        formats: ['html', 'md', 'docx', 'pdf'],
        status: 'draft',
        href: `/dashboard/content/editor/${draftId}`,
        filed: 'in_files',
      },
    ]);
    expectClean(await eventsOf(runId));
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

describe('question cards (CHAT-07)', () => {
  const ask = (question: string, extra: Record<string, unknown> = {}) => ({
    question,
    options: [
      { label: '/pricing', detail: 'Cited 18 times for pricing prompts', recommended: true },
      { label: '/features' },
    ],
    ...extra,
  });
  const asksOf = (runId: string) =>
    db.tables.chat_asks
      .filter((a) => a.run_id === runId)
      .sort((a, b) => (a.position as number) - (b.position as number));
  /** Answers the question the run waits on and drives on. */
  async function answer(actor: ChatActor, runId: string, body: Record<string, unknown>) {
    const n = ofType(await eventsOf(runId), 'ask.created').at(-1)!.data.n;
    const prepared = await engine.prepareResume(actor, runId, 'answer', { n, ...body });
    if (prepared.ok) await engine.driveRun(actor, runId, prepared.resume);
    return prepared;
  }

  it('waits on the card without a model call, then goes on with the answer', async () => {
    const { sonnet } = useModels(
      [READY],
      [
        calls(
          toolCall(
            'q1',
            ASK_TOOL,
            ask('Which page should the FAQ go on?', {
              allow_other: true,
              then: 'Then I’ll write the FAQ draft',
            }),
          ),
        ),
        text('Writing it for /features.'),
      ],
    );
    const runId = await turn(ADMIN, 'Write a FAQ', 'auto');
    expect(sonnet.seen[0].tools?.map((tool) => tool.name)).toContain(ASK_TOOL);
    expect(runRow(runId).status).toBe('waiting');
    expect(sonnet.seen).toHaveLength(1);
    expect(stepsOf(runId)[0]).toMatchObject({
      kind: 'ask',
      status: 'waiting',
      label: 'Waiting for your answer',
      detail: 'Then I’ll write the FAQ draft',
    });
    const created = ofType(await eventsOf(runId), 'ask.created');
    expect(created.map((e) => e.data)).toEqual([
      {
        n: 1,
        question: 'Which page should the FAQ go on?',
        options: [
          { label: '/pricing', detail: 'Cited 18 times for pricing prompts', recommended: true },
          { label: '/features', recommended: false },
        ],
        allowOther: true,
        multi: false,
        then: 'Then I’ll write the FAQ draft',
      },
    ]);
    expect(asksOf(runId)).toMatchObject([{ position: 1, answered_at: null }]);

    expect(await answer(ADMIN, runId, { selected: [1] })).toMatchObject({ ok: true });
    expect(stepsOf(runId)[0]).toMatchObject({
      status: 'done',
      label: 'Which page should the FAQ go on?',
      detail: '/features',
    });
    expect(asksOf(runId)[0].answer_json).toEqual({
      selected: [1],
      other: null,
      skipped: false,
      via: 'card',
    });
    // The person's own answer: the model follows it as their message, not as data.
    expect(JSON.stringify(sonnet.seen[1].prompt)).toContain(
      '"from":"the person","selected":["/features"]',
    );
    expect(JSON.stringify(sonnet.seen[0].prompt)).toContain(
      "result is the person's own answer, not data",
    );
    expect(runRow(runId).status).toBe('done');
    const events = await eventsOf(runId);
    expectClean(events);
    const rebuilt = runFromEvents(events);
    expect(rebuilt.question).toBeNull();
    expect(rebuilt.text).toBe('Writing it for /features.');
  });

  it('goes on with the Recommended option when skipped, and says so on its line', async () => {
    const { sonnet } = useModels(
      [READY],
      [calls(toolCall('q1', ASK_TOOL, ask('Which page?'))), text('Used /pricing.')],
    );
    const runId = await turn(ADMIN, 'Write a FAQ');
    expect(await answer(ADMIN, runId, { skipped: true })).toMatchObject({ ok: true });
    expect(stepsOf(runId)[0]).toMatchObject({
      status: 'done',
      detail: 'Skipped · used /pricing',
    });
    expect(JSON.stringify(sonnet.seen[1].prompt)).toContain('"skipped":true,"use":"/pricing"');
  });

  it('takes the composer’s text as the answer to any question', async () => {
    const { sonnet } = useModels(
      [READY],
      [calls(toolCall('q1', ASK_TOOL, ask('Which page?'))), text('On the blog.')],
    );
    const runId = await turn(ADMIN, 'Write a FAQ');
    // No Other… row on the card: the composer's message answers it all the same.
    expect(await answer(ADMIN, runId, { other: 'card', via: 'card' })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await answer(ADMIN, runId, { other: ' The blog ', via: 'composer' })).toMatchObject({
      ok: true,
    });
    expect(stepsOf(runId)[0].detail).toBe('The blog');
    expect(JSON.stringify(sonnet.seen[1].prompt)).toContain('The blog');
  });

  it('refuses an answer that doesn’t fit, a second answer and an approval for it', async () => {
    useModels([READY], [calls(toolCall('q1', ASK_TOOL, ask('Which page?'))), text('Done.')]);
    const runId = await turn(ADMIN, 'Write a FAQ');
    const tries = [
      { n: 1, selected: [0, 1] },
      { n: 1, selected: [2] },
      { n: 1 },
      { n: 1, selected: [0], skipped: true },
    ];
    for (const body of [...tries, { n: 1, other: 'x'.repeat(501), via: 'composer' }]) {
      expect(await engine.prepareResume(ADMIN, runId, 'answer', body)).toMatchObject({
        ok: false,
        status: 400,
        message:
          "That answer doesn't fit this question. Pick one of its options, or write up to 500 characters.",
      });
    }
    expect(await engine.prepareResume(ADMIN, runId, 'answer', { n: 2 })).toMatchObject({
      code: 'not_waiting',
    });
    expect(
      await engine.prepareResume(ADMIN, runId, 'approve', { n: 1, digest: '0123456789abcdef' }),
    ).toMatchObject({ code: 'not_waiting' });
    expect(await engine.prepareResume(ADMIN, runId, 'skip', { n: 1 })).toMatchObject({
      code: 'not_waiting',
    });
    expect(await engine.prepareResume(ANALYST, runId, 'answer', { n: 1 })).toMatchObject({
      status: 404,
    });

    const body = { n: 1, selected: [0] };
    const [first, second] = await Promise.all([
      engine.prepareResume(ADMIN, runId, 'answer', body),
      engine.prepareResume(ADMIN, runId, 'answer', body),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect([first, second].find((r) => !r.ok)).toMatchObject({ status: 409, code: 'answered' });
    expect(asksOf(runId)[0].answer_json).toMatchObject({ selected: [0] });
  });

  it('counts the questions asked together: 1 of 2, then 2 of 2', async () => {
    const { sonnet } = useModels(
      [READY],
      [
        calls(
          toolCall('q1', ASK_TOOL, ask('Which page?')),
          toolCall('q2', ASK_TOOL, {
            question: 'Which questions?',
            options: [
              { label: 'Pricing', recommended: true },
              { label: 'Setup' },
              { label: 'Security' },
            ],
            multi: true,
          }),
        ),
        text('Both noted.'),
      ],
    );
    const runId = await turn(ADMIN, 'Write a FAQ');
    expect(ofType(await eventsOf(runId), 'ask.created').at(-1)!.data.batch).toEqual({
      at: 1,
      of: 2,
    });
    await answer(ADMIN, runId, { selected: [0] });
    expect(runRow(runId).status).toBe('waiting');
    expect(sonnet.seen).toHaveLength(1);
    const second = ofType(await eventsOf(runId), 'ask.created').at(-1)!.data;
    expect(second).toMatchObject({ n: 2, multi: true, batch: { at: 2, of: 2 } });
    await answer(ADMIN, runId, { selected: [0, 2] });
    expect(stepsOf(runId)[1].detail).toBe('Pricing, Security');
    expect(asksOf(runId).map((a) => a.position)).toEqual([1, 2]);
    expect(runRow(runId).status).toBe('done');
  });

  it('answers the questions asked together with one message from the composer', async () => {
    const { sonnet } = useModels(
      [READY],
      [
        calls(
          toolCall('q1', ASK_TOOL, ask('Which page?')),
          toolCall('q2', ASK_TOOL, ask('How long?')),
        ),
        text('Done.'),
      ],
    );
    const runId = await turn(ADMIN, 'Write a FAQ');
    const message = '/pricing, each answer under 60 words';
    await answer(ADMIN, runId, { other: message, via: 'composer' });
    // No second card: the message answered it too, and its line folds with it.
    expect(ofType(await eventsOf(runId), 'ask.created')).toHaveLength(1);
    expect(stepsOf(runId).map((s) => [s.kind, s.status, s.label, s.detail])).toEqual([
      ['ask', 'done', 'Which page?', message],
      ['ask', 'done', 'How long?', message],
    ]);
    expect(asksOf(runId)[1]).toMatchObject({
      position: 2,
      answer_json: { selected: [], other: message, skipped: false, via: 'composer' },
    });
    expect(asksOf(runId)[1].answered_at).not.toBeNull();
    expect(JSON.stringify(sonnet.seen[1].prompt)).toContain('the same message');
    expect(runRow(runId).status).toBe('done');
    expectClean(await eventsOf(runId));
  });

  it('runs no change asked with a question: the model calls it again with the answer', async () => {
    const draftCall = toolCall('w1', 'create_draft', {
      brand_id: BRAND,
      title: 'Pricing FAQ',
      page_type: 'docs_faq',
      source: { kind: 'content' },
    });
    const { sonnet } = useModels(
      [READY],
      [calls(toolCall('q1', ASK_TOOL, ask('Which page?')), draftCall), text('I’ll draft it next.')],
    );
    const runId = await turn(ADMIN, 'Write a FAQ', 'full_auto');
    await answer(ADMIN, runId, { selected: [1] });
    expect(createContentDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(sonnet.seen[1].prompt)).toContain('not_run');
    expect(JSON.stringify(sonnet.seen[0].prompt)).toContain(
      "Don't call other tools in the same reply as a question",
    );
    expect(runRow(runId).status).toBe('done');
  });

  it('lets the answer go when the run stopped meanwhile, so nothing is kept half-way', async () => {
    useModels([READY], [calls(toolCall('q1', ASK_TOOL, ask('Which page?')))]);
    const runId = await turn(ADMIN, 'Write a FAQ');
    // The run stops between the answer being kept and the run being taken back.
    let rows = db.tables.chat_asks;
    Object.defineProperty(db.tables, 'chat_asks', {
      configurable: true,
      enumerable: true,
      get: () => rows,
      set: (next: typeof rows) => {
        if (next.some((a) => a.run_id === runId && a.answered_at)) {
          runRow(runId).status = 'stopped';
        }
        rows = next;
      },
    });
    expect(
      await engine.prepareResume(ADMIN, runId, 'answer', { n: 1, selected: [0] }),
    ).toMatchObject({ ok: false, status: 409, code: 'not_waiting' });
    expect(asksOf(runId)[0]).toMatchObject({ answered_at: null, answer_json: null });
  });

  it('refuses a question without exactly one Recommended, and asks 4 a run at most', async () => {
    const both = {
      question: 'Which page?',
      options: [
        { label: '/pricing', recommended: true },
        { label: '/features', recommended: true },
      ],
    };
    const five = [1, 2, 3, 4, 5].map((i) => toolCall(`q${i}`, ASK_TOOL, ask(`Question ${i}?`)));
    const { sonnet } = useModels(
      [READY],
      [calls(toolCall('bad', ASK_TOOL, both)), calls(...five), text('Went with /pricing.')],
    );
    const runId = await turn(ADMIN, 'Write a FAQ');
    // The refused one tells the model why; no card, no row.
    expect(JSON.stringify(sonnet.seen[1].prompt)).toContain('Mark exactly one option recommended.');
    // Of the five asked together, the four the run may ask are counted.
    expect(ofType(await eventsOf(runId), 'ask.created')[0].data.batch).toEqual({ at: 1, of: 4 });
    for (let i = 0; i < 4; i++) {
      expect(runRow(runId).status).toBe('waiting');
      await answer(ADMIN, runId, { skipped: true });
    }
    expect(asksOf(runId)).toHaveLength(4);
    expect(JSON.stringify(sonnet.seen[2].prompt)).toContain('limit_reached');
    expect(sonnet.seen[2].tools?.map((tool) => tool.name)).not.toContain(ASK_TOOL);
    expect(runRow(runId).status).toBe('done');
  });

  it('keeps an open question as skipped on Stop, and refuses an answer while read-only', async () => {
    useModels(
      [READY, READY],
      [
        calls(toolCall('q1', ASK_TOOL, ask('Which page?'))),
        calls(toolCall('q2', ASK_TOOL, ask('Which page?'))),
      ],
    );
    const stopped = await turn(ADMIN, 'Write a FAQ');
    await engine.stopChatRun(ADMIN, stopped);
    expect(runRow(stopped).status).toBe('stopped');
    expect(stepsOf(stopped)[0]).toMatchObject({
      status: 'skipped',
      label: 'Question skipped',
      detail: 'Stopped',
    });
    expect(asksOf(stopped)[0]).toMatchObject({
      answer_json: { selected: [], other: null, skipped: true, via: 'card' },
    });
    expect(runFromEvents(await eventsOf(stopped)).question).toBeNull();

    const locked = await turn(ADMIN, 'Write another');
    db.tables.organizations[0].subscription_status = 'canceled';
    expect(await answer(ADMIN, locked, { selected: [0] })).toMatchObject({
      ok: false,
      status: 402,
    });
    expect(asksOf(locked)[0].answered_at).toBeNull();
    expect(runRow(locked).status).toBe('waiting');
  });
});

describe('next moves (CHAT-07 §C)', () => {
  /** The final answer and its next moves, in one model step. */
  const answerWithMoves = (answer: string, moves: unknown) => [
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: answer },
    { type: 'text-end', id: 't' },
    toolCall('m1', NEXT_MOVES_TOOL, { moves }),
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: usage() },
  ];
  const MOVES = [
    {
      label: 'Do the same for /features',
      prompt: 'Do the same for /features',
      kind: 'continue',
      class: 'write',
      continues_this_run: true,
    },
    {
      label: 'Compare with Perplexity',
      prompt: 'Compare these citations with Perplexity',
      kind: 'deepen',
      class: 'read',
    },
  ];
  const movesOf = (runId: string) =>
    db.tables.chat_next_moves
      .filter((m) => m.run_id === runId)
      .sort((a, b) => (a.rank as number) - (b.rank as number));

  it('keeps them with the final answer, without another model step, and sends them before the end', async () => {
    const { sonnet } = useModels([READY], [answerWithMoves('Two pages lost most of it.', MOVES)]);
    const runId = await turn(ADMIN, 'Why did citations fall?');
    expect(sonnet.seen[0].tools?.map((tool) => tool.name)).toContain(NEXT_MOVES_TOOL);
    expect(sonnet.seen).toHaveLength(1);
    expect(runRow(runId).status).toBe('done');
    expect(movesOf(runId)).toMatchObject([
      { rank: 1, prompt: 'Do the same for /features', class: 'write', ghost_ok: true },
      {
        rank: 2,
        prompt: 'Compare these citations with Perplexity',
        class: 'read',
        ghost_ok: false,
      },
    ]);
    const events = await eventsOf(runId);
    expectClean(events);
    const types = events.map((e) => e.type);
    expect(types.indexOf('next_moves')).toBeLessThan(types.indexOf('run.finished'));
    expect(ofType(events, 'next_moves')[0].data.moves).toEqual([
      { label: 'Do the same for /features', prompt: 'Do the same for /features', ghost: true },
      { label: 'Compare with Perplexity', prompt: 'Compare these citations with Perplexity' },
    ]);
    const rebuilt = runFromEvents(events);
    expect(rebuilt.text).toBe('Two pages lost most of it.');
    expect(rebuilt.nextMoves).toHaveLength(2);
  });

  it('gives an Analyst read moves only, so no ghost unless one continues this run', async () => {
    useModels([READY], [answerWithMoves('Two pages lost most of it.', MOVES)]);
    const runId = await turn(ANALYST, 'Why did citations fall?');
    expect(movesOf(runId)).toMatchObject([
      {
        rank: 1,
        prompt: 'Compare these citations with Perplexity',
        class: 'read',
        ghost_ok: false,
      },
    ]);
    expect(ofType(await eventsOf(runId), 'next_moves')[0].data.moves).toEqual([
      { label: 'Compare with Perplexity', prompt: 'Compare these citations with Perplexity' },
    ]);
  });

  it('ends without moves when they don’t fit, or none were suggested', async () => {
    const { sonnet } = useModels(
      [READY, READY],
      [answerWithMoves('Done.', []), text('Done again.')],
    );
    const bad = await turn(ADMIN, 'Why did citations fall?');
    expect(sonnet.seen).toHaveLength(1);
    expect(runRow(bad).status).toBe('done');
    const plain = await turn(ADMIN, 'And now?');
    expect(runRow(plain).status).toBe('done');
    for (const runId of [bad, plain]) {
      expect(movesOf(runId)).toEqual([]);
      expect(ofType(await eventsOf(runId), 'next_moves')).toEqual([]);
    }
  });

  it('suggests none while the run waits on the person', async () => {
    useModels(
      [READY],
      [
        [
          toolCall('q1', ASK_TOOL, {
            question: 'Which page?',
            options: [{ label: '/pricing', recommended: true }, { label: '/features' }],
          }),
          toolCall('m1', NEXT_MOVES_TOOL, { moves: MOVES }),
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: 'tool_use' },
            usage: usage(),
          },
        ],
      ],
    );
    const runId = await turn(ADMIN, 'Write a FAQ');
    expect(runRow(runId).status).toBe('waiting');
    expect(ofType(await eventsOf(runId), 'next_moves')).toEqual([]);
    expect(movesOf(runId)).toEqual([]);
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
  it('sends the person’s ready files with the message, and refuses one that isn’t ready first', async () => {
    useModels([READY], [text('Hi.')]);
    db.rpcs.chat_run_limits = () => ({
      workspaceRunning: 0,
      userRunning: 0,
      messagesHour: 0,
      messagesDay: 0,
    });
    const FILE = '11111111-2222-4333-8444-555555555555';
    const PENDING = '11111111-2222-4333-8444-666666666666';
    const upload = (id: string, status: string) => ({
      id,
      user_id: PEOPLE.admin,
      organization_id: ORG,
      status,
      message_id: null,
      conversation_id: null,
    });
    db.tables.chat_uploads = [upload(FILE, 'ready'), upload(PENDING, 'pending')];
    const chats = db.tables.chat_conversations.length;
    expect(
      await engine.startChatRun(ADMIN, {
        message: 'Read this',
        brandId: BRAND,
        attachmentIds: [FILE, PENDING],
      }),
    ).toMatchObject({ ok: false, status: 400, code: 'attachments' });
    // Refused before anything is kept: no chat, no message.
    expect(db.tables.chat_conversations).toHaveLength(chats);

    const started = await engine.startChatRun(ADMIN, {
      message: 'Read this',
      brandId: BRAND,
      attachmentIds: [FILE],
    });
    expect(started.ok).toBe(true);
    const question = db.tables.chat_messages.find(
      (m) => m.role === 'user' && m.content_md === 'Read this',
    );
    const file = db.tables.chat_uploads.find((r) => r.id === FILE);
    expect(file?.message_id).toBe(question?.id);
    if (started.ok) expect(file?.conversation_id).toBe(started.conversationId);
    expect(db.tables.chat_uploads.find((r) => r.id === PENDING)?.message_id).toBeNull();
  });

  it('keeps what the page scoped a message to, and gives it to the models as data', async () => {
    const { haiku, sonnet } = useModels([READY], [text('Two pages lost most of it.')]);
    const context = {
      route: '/dashboard/mentions',
      chips: [
        { key: 'page', label: 'Mentions & Sentiment' },
        { key: 'filter:platform', label: 'ChatGPT', value: 'chatgpt-web' },
      ],
    };
    const references = [
      { type: 'chart' as const, id: 'mentions-trend', label: 'Mentions over time' },
    ];
    const started = await engine.startChatRun(ADMIN, {
      message: 'Why did mentions drop?',
      brandId: BRAND,
      context,
      references,
    });
    if (!started.ok) throw new Error('not started');
    const question = db.tables.chat_messages.find((m) => m.content_md === 'Why did mentions drop?');
    expect(question?.context_json).toEqual({ context, references });
    await engine.driveRun(ADMIN, started.runId);
    for (const prompt of [haiku.seen[0].prompt, sonnet.seen[0].prompt]) {
      const seen = JSON.stringify(prompt);
      expect(seen).toContain('<page_context>');
      expect(seen).toContain('chatgpt-web');
      expect(seen).toContain('mentions-trend');
    }
  });

  it('names the app page a side panel chat started on (CHAT-01 origin, origin_page)', async () => {
    useModels([READY], [text('Hi.')]);
    const panel = await engine.startChatRun(ADMIN, {
      message: 'From the panel',
      brandId: BRAND,
      origin: 'panel',
      originPage: '/dashboard/mentions',
    });
    const page = await engine.startChatRun(ADMIN, { message: 'From Chat', brandId: BRAND });
    const odd = await engine.startChatRun(ADMIN, {
      message: 'Odd page',
      brandId: BRAND,
      origin: 'panel',
      originPage: 'https://example.com/x',
    });
    if (!panel.ok || !page.ok || !odd.ok) throw new Error('not started');
    const row = (id: string) => db.tables.chat_conversations.find((c) => c.id === id)!;
    expect(row(panel.conversationId)).toMatchObject({
      origin: 'panel',
      origin_page: '/dashboard/mentions',
    });
    expect(row(page.conversationId)).toMatchObject({
      origin: 'page',
      origin_page: '/dashboard/chat',
    });
    expect(row(odd.conversationId)).toMatchObject({ origin: 'panel', origin_page: null });
  });

  it('keeps no scope on a message without one', async () => {
    const { haiku } = useModels([READY], [text('Hi.')]);
    const started = await engine.startChatRun(ADMIN, {
      message: 'Hello there',
      brandId: BRAND,
      context: { chips: [] },
    });
    if (!started.ok) throw new Error('not started');
    const question = db.tables.chat_messages.find((m) => m.content_md === 'Hello there');
    expect(question?.context_json ?? null).toBeNull();
    await engine.driveRun(ADMIN, started.runId);
    expect(JSON.stringify(haiku.seen[0].prompt)).not.toContain('<page_context>');
  });

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
    // The person's own chat, deleted with its Undo still open (00407): read
    // with the service role, it still takes no new message.
    db.tables.chat_conversations.push({
      id: BRAND,
      user_id: ADMIN.userId,
      organization_id: ORG,
      deleted_at: new Date().toISOString(),
    });
    expect(
      await engine.startChatRun(ADMIN, { message: 'Hello', conversationId: BRAND }),
    ).toMatchObject({ ok: false, status: 404 });
  });
});
