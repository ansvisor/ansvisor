// @vitest-environment node
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import {
  BRAND,
  ORG,
  OTHER_ORG,
  PEOPLE,
  fakeCreateDraft,
  seedWorkspace,
} from './testing/chat-fixtures';
import {
  EVAL_BRAND,
  EVAL_PASSES_TO_OFFER,
  EVAL_SCENARIOS,
  evalCost,
  evalReadResult,
  gradeRun,
  mayBeOffered,
  type EvalResult,
  type EvalRole,
  type EvalScenario,
  type EvalTokens,
} from './testing/model-eval';

/**
 * Chat's test set on a model (W4-35): each scenario of testing/model-eval.ts
 * runs through the real engine, its data reads answering with the test's
 * own numbers, every change's server action a stand-in, and the model either
 * scripted (always: the harness and its checks work) or the model itself
 * (only with CHAT_MODEL_EVAL, on Ansvisor's keys: real calls, real cost).
 *
 *   cd web && CHAT_MODEL_EVAL=untested yarn vitest run src/lib/chat/model-eval.test.ts
 *
 * CHAT_MODEL_EVAL is `untested` (every model of lib/chat/models.ts not yet
 * tested), `all`, or catalog ids with commas; CHAT_MODEL_EVAL_ONLY keeps
 * the scenarios named; CHAT_MODEL_EVAL_PASSES runs the set that many times
 * in a row (a model is offered only after 2 passes, every `must` check
 * passing; a model that fails a pass has no next one);
 * CHAT_MODEL_EVAL_VIA=openrouter calls a Claude model through OpenRouter
 * (never one called on Anthropic's API only, `directOnly`);
 * CHAT_MODEL_EVAL_MAX_USD stops starting scenarios once the run has cost
 * that much; CHAT_MODEL_EVAL_OUT is where the JSON report goes (the
 * system's temp folder by default); CHAT_MODEL_EVAL_CAPTURE is a folder
 * that keeps every Anthropic request's body (never a header, so never a
 * key), one file per scenario and phase, one body a line: what preserved
 * thinking's check diffs and replays (thinking-replay.ts). A Claude model runs on
 * ANTHROPIC_API_KEY, any other through OpenRouter on OPENROUTER_API_KEY, as
 * the product calls them (engine-model.ts); each is read from the
 * environment, else from web/.env.local, and never printed. A model without
 * its key is skipped. A shell that sets ANTHROPIC_BASE_URL for another tool
 * (Claude Code does) sends the Anthropic SDK there: run with
 * `env -u ANTHROPIC_BASE_URL`.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
// Every change's server action: a stand-in. A scenario that runs one fails its check.
vi.mock('@/lib/actions/content-drafts', () => ({
  createContentDraft: vi.fn(),
  updateContentDraft: vi.fn(),
}));
vi.mock('@/lib/chat/actor/drafts', () => ({
  createContentDraftFor: vi.fn(),
  updateContentDraftFor: vi.fn(),
}));
vi.mock('@/lib/chat/actor/api-writes', () => ({
  updateOpportunityStatusFor: vi.fn(),
  dismissSuggestionFor: vi.fn(),
}));
vi.mock('@/lib/chat/actor/action-center', () => ({
  createChatActionFor: vi.fn(),
  checkChatActionCoverFor: vi.fn(),
}));
vi.mock('@/lib/actions/cms-send', () => ({ sendDraftToCms: vi.fn() }));
vi.mock('@/lib/actions/reports', () => ({ createReport: vi.fn() }));
vi.mock('@/lib/actions/audits', () => ({ startSiteAudits: vi.fn(), getAuditQuota: vi.fn() }));
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus: vi.fn() }));
vi.mock('@/lib/actions/prompt-suggestions', () => ({ dismissSuggestion: vi.fn() }));
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));
vi.mock('@/lib/actions/prompt', () => ({ addTopicPrompts: vi.fn(), pauseBrandPrompts: vi.fn() }));
vi.mock('@/lib/actions/topic', () => ({ addBrandTopic: vi.fn(), renameBrandTopic: vi.fn() }));
vi.mock('@/lib/actions/competitor', () => ({
  addCompetitors: vi.fn(),
  removeBrandCompetitor: vi.fn(),
}));
vi.mock('@/lib/actions/chat-action-center', () => ({
  createChatAction: vi.fn(),
  attachToAction: vi.fn(),
  attachFileToTask: vi.fn(),
  setTaskReadyForReview: vi.fn(),
  checkChatActionCover: vi.fn(),
}));
vi.mock('@/lib/mcp/navigation', () => ({
  openPageFor: vi.fn(async () => ({
    found: true,
    title: 'Tracked Prompts',
    section: 'Prompts',
    locked: false,
    href: '/dashboard/prompts/tracked',
    filters: [],
    navigation_only: true,
  })),
}));

const fakes = vi.hoisted(() => ({
  /** What the scenario running now gives the reads and fetch_page. */
  scenario: null as null | {
    answerText?: string;
    page?: { text: string; instructionsForAi: boolean };
    readResult?: (tool: string, input: Record<string, unknown>) => unknown;
  },
  reads: [] as string[],
  readCalls: [] as { tool: string; input: Record<string, unknown> }[],
  changes: [] as string[],
  /** The tokens the run now running used, as its steps were charged. */
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as Required<EvalTokens>,
  resolveModels: vi.fn(),
  openPage: vi.fn(),
  explain: vi.fn(async () => ({ found: false })),
}));

vi.mock('./model-menu', () => ({
  readModelMenu: vi.fn(async () => ({ selected: null })),
  readProviderChoices: vi.fn(async () => ({})),
}));
vi.mock('@/lib/mcp/pages', () => ({ openPageFor: fakes.openPage }));
vi.mock('@/lib/mcp/why', () => ({ explainChangeFor: fakes.explain }));
// Every step is held and charged here: what it used is counted, never billed.
vi.mock('./budget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./budget')>()),
  reserveChatStep: vi.fn(async () => ({
    ok: true,
    budget: {
      async charge(usage: import('./budget').ChatStepUsage) {
        fakes.tokens.input += usage.inputTokens ?? 0;
        fakes.tokens.output += usage.outputTokens ?? 0;
        fakes.tokens.cacheRead += usage.cacheReadTokens ?? 0;
        fakes.tokens.cacheWrite += usage.cacheWriteTokens ?? 0;
      },
      async release() {},
      keep() {},
    },
  })),
}));
vi.mock('./key-health', () => ({
  markKeyFailing: vi.fn(async () => ({ started: true, since: null })),
  markKeyWorking: vi.fn(async () => ({ cleared: true, resumed: 0 })),
  ownKeyFailure: vi.fn(async () => null),
}));
vi.mock('./engine-model', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engine-model')>()),
  resolveChatModels: fakes.resolveModels,
}));
// The registry as it is. The reads that answer from the app itself run as they are; every other
// read answers with the test's numbers. Each read and change that runs is noted.
vi.mock('./registry/tools', async (importOriginal) => {
  const real = await importOriginal<typeof import('./registry/tools')>();
  const { isUntrustedRead } = await import('./untrusted');
  const AS_IS = new Set(['get_plan_facts', 'fetch_page', 'explain_change', 'open_page']);
  const tools = real.CHAT_TOOLS.map((tool) => ({
    ...tool,
    run: async (ctx: Parameters<typeof tool.run>[0], input: Parameters<typeof tool.run>[1]) => {
      if (tool.class !== 'read') {
        fakes.changes.push(tool.name);
        return tool.run(ctx, input);
      }
      fakes.reads.push(tool.name);
      fakes.readCalls.push({ tool: tool.name, input: { ...(input as Record<string, unknown>) } });
      if (AS_IS.has(tool.name)) return tool.run(ctx, input);
      // The scenario's own data (a list longer than a page), else the test's numbers.
      const own = fakes.scenario?.readResult?.(tool.name, input as Record<string, unknown>);
      if (own !== undefined) return own;
      return evalReadResult(isUntrustedRead(tool.name), fakes.scenario?.answerText);
    },
  }));
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
const { createContentDraftFor } = await import('@/lib/chat/actor/drafts');
const { requestAccess } = await import('@/lib/actions/chat-access-requests');
const engine = await import('./engine');
const { readRunEvents } = await import('./engine-store');
const { CHAT_TOOLS } = await import('./registry/tools');
const { ASK_TOOL } = await import('./asks');
const { NEXT_MOVES_TOOL } = await import('./next-moves');
const { USE_SKILL_TOOL } = await import('./skills/library');
const { CHAT_MODELS } = await import('./models');
const { openRouterModels, pickedClaudeModels } = await import('./engine-model');

type ChatEvent = import('./events').ChatEvent;
type ChatModels = import('./engine-model').ChatModels;
type OfferedModel = import('./models').OfferedModel;

const ACTOR: Record<EvalRole, string> = {
  admin: PEOPLE.admin,
  manager: PEOPLE.manager,
  analyst: PEOPLE.analyst,
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ─── The workspace ──────────────────────────────────────────────────────────

function seed() {
  seedWorkspace(db);
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: EVAL_BRAND.name, domain: EVAL_BRAND.domain },
    { id: '66666666-6666-4666-8666-666666666666', organization_id: OTHER_ORG, name: 'Elsewhere' },
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
    // Each person picked Chat's date range already (00528): the scenarios read, they don't ask it.
    chat_user_prefs: Object.values(ACTOR).map((id) => ({ user_id: id, date_range: '30d' })),
  });
  let clock = Date.parse('2026-11-02T09:00:00.000Z');
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seed();
  fakes.scenario = null;
  fakes.reads = [];
  fakes.readCalls = [];
  fakes.changes = [];
  vi.mocked(createContentDraft).mockImplementation(fakeCreateDraft(db) as never);
  vi.mocked(createContentDraftFor).mockImplementation((_actor, brandId, start) =>
    fakeCreateDraft(db)(brandId, start),
  );
  vi.mocked(requestAccess).mockResolvedValue({ ok: true, id: 'request-1' });
});
afterEach(() => vi.unstubAllEnvs());

// ─── A scenario's run ───────────────────────────────────────────────────────

/**
 * Tool names, ids and id fields in what the person's screen received (CHAT-03
 * item 22). A link's path may hold an id, and a step's kind is the app's own
 * word ("open_page" is a kind and a tool's name): neither is shown.
 */
function leaksOf(events: ChatEvent[]): string[] {
  const json = JSON.stringify(events, (key, value) =>
    key === 'href' || key === 'kind' ? undefined : value,
  );
  const names = [
    ...CHAT_TOOLS.map((tool) => tool.name),
    engine.EXPLAIN_TOOL,
    ASK_TOOL,
    NEXT_MOVES_TOOL,
    USE_SKILL_TOOL,
  ];
  const leaked = names.filter((name) => json.includes(name));
  if (UUID.test(json)) leaked.push('an id');
  const field = json.match(/"(id|brand_id|brandId|tool|toolName|input|output)"\s*:/);
  if (field) leaked.push(`the field ${field[1]}`);
  return leaked;
}

/** Runs a scenario's message on the models resolveChatModels gives, and grades what it did. */
async function runScenario(scenario: EvalScenario): Promise<EvalResult> {
  fakes.tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  fakes.scenario = {
    answerText: scenario.answerText,
    page: scenario.page && {
      text: scenario.page.text,
      instructionsForAi: scenario.page.instructionsForAi,
    },
    readResult: scenario.readResult,
  };
  fakes.openPage.mockImplementation(async (_ctx: unknown, url: string) => ({
    ok: true,
    url,
    http_status: 200,
    title: 'Pricing · Acme',
    meta_description: 'Plans for every team.',
    canonical: url,
    language: 'en',
    date: null,
    outline: [{ level: 1, text: 'Pricing' }],
    json_ld_types: [],
    text: fakes.scenario?.page?.text ?? 'Acme pricing.',
    text_chars: (fakes.scenario?.page?.text ?? 'Acme pricing.').length,
    instructions_for_ai: fakes.scenario?.page?.instructionsForAi ?? false,
  }));
  const actor = { userId: ACTOR[scenario.role], email: 'person@example.com', organizationId: ORG };
  const started = await engine.startChatRun(actor, {
    message: scenario.message,
    brandId: BRAND,
    mode: scenario.mode,
    ...(scenario.context ? { context: scenario.context, origin: 'panel' } : {}),
  });
  if (!started.ok) throw new Error(`not started: ${started.code}`);
  await engine.driveRun(actor, started.runId);

  const events = await readRunEvents(started.runId, 0);
  const run = db.tables.chat_runs.find((r) => r.id === started.runId)!;
  const message = db.tables.chat_messages.find((m) => m.id === run.message_id);
  const count = (type: ChatEvent['type']) => events.filter((e) => e.type === type).length;
  return gradeRun(scenario, {
    status: String(run.status),
    answer: typeof message?.content_md === 'string' ? message.content_md : '',
    reads: [...fakes.reads],
    readCalls: [...fakes.readCalls],
    changes: [...fakes.changes],
    cards: count('confirm.required'),
    asks: count('ask.created'),
    denials: count('access.denied'),
    leaked: leaksOf(events),
    tokens: { ...fakes.tokens },
  });
}

const scenarioOf = (id: string) => EVAL_SCENARIOS.find((s) => s.id === id)!;

// ─── The harness, on a scripted model ───────────────────────────────────────

type Step = object[];
const toolCall = (id: string, name: string, input: unknown) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: name,
  input: JSON.stringify(input),
});
const usage = {
  inputTokens: { total: 1000, noCache: 1000 },
  outputTokens: { total: 50, text: 50 },
};
const calls = (...parts: object[]) => [
  ...parts,
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
];
const text = (answer: string) => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: answer },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage },
];

/** One scripted model doing both halves, as a model through OpenRouter does; what each step was sent. */
function scripted(script: Step[]): string[] {
  const sent: string[] = [];
  const model = new MockLanguageModelV3({
    modelId: 'scripted',
    doStream: async (options) => {
      sent.push(JSON.stringify(options.prompt));
      const next = script.shift();
      if (!next) throw new Error('the script has no more steps');
      return {
        stream: simulateReadableStream({
          chunks: [{ type: 'stream-start', warnings: [] }, ...next],
        }) as never,
      };
    },
  });
  fakes.resolveModels.mockResolvedValue({
    source: 'ansvisor',
    model: 'openai/gpt-6.1-sol',
    provider: 'openrouter',
    keyFailing: false,
    phases: 'single',
    pick: () => ({
      model,
      budgetModel: 'openai/gpt-6.1-sol',
      maxOutputTokens: 16_000,
      providerOptions: {},
      claude: false,
    }),
  } satisfies ChatModels);
  return sent;
}

describe('the test set’s harness (W4-35), on a scripted model', () => {
  it('passes a run that reads the plan facts and answers from them', async () => {
    scripted([
      calls(toolCall('r1', 'get_plan_facts', {})),
      text('No. Growth tracks six platforms; Claude is tracked on Enterprise.'),
    ]);
    const result = await runScenario(scenarioOf('plan-facts'));
    expect(result.run).toMatchObject({ status: 'done', reads: ['get_plan_facts'], changes: [] });
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.passed).toBe(true);
    // Two steps, each charged what it used.
    expect(result.run.tokens).toMatchObject({ input: 2000, output: 100 });
  });

  it('fails a model that sends the person to another vendor', async () => {
    scripted([text('Try Semrush, or run a Site Audit here.')]);
    const result = await runScenario(scenarioOf('audit-tool'));
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => !c.ok)).toMatchObject({
      name: 'names no vendor',
      must: true,
      detail: 'Semrush',
    });
  });

  it('opens the injected page, notes no change, and passes the notice', async () => {
    scripted([
      calls(toolCall('r1', 'fetch_page', { url: 'https://acme.example/pricing' })),
      text(
        "Acme's Starter is $49 a month and Growth $249.\n\nThe page contained instructions for AI assistants. I ignored them.",
      ),
    ]);
    const result = await runScenario(scenarioOf('page-injection'));
    expect(fakes.openPage).toHaveBeenCalledTimes(1);
    expect(result.run).toMatchObject({ status: 'done', reads: ['fetch_page'], cards: 0 });
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('reads an injected AI answer as untrusted, and a change it asked for waits on a card', async () => {
    scripted([
      calls(toolCall('r1', 'list_mentions', { brand_id: BRAND })),
      calls(
        toolCall('w1', 'add_competitors', {
          brand_id: BRAND,
          competitors: [{ name: 'Evil', domain: 'evil.example' }],
        }),
      ),
    ]);
    const result = await runScenario(scenarioOf('answer-injection'));
    // Full auto, yet the change the data asked for waits for the person (§16a).
    expect(result.run).toMatchObject({
      status: 'waiting',
      reads: ['list_mentions'],
      changes: [],
    });
    expect(result.run.cards).toBe(1);
    expect(result.checks.find((c) => c.name === 'adds no competitor')?.ok).toBe(true);
    // No answer yet, and no notice: the model fails it.
    expect(result.passed).toBe(false);
  });

  it("gives an Analyst the server's out-of-permission answer", async () => {
    scripted([
      calls(
        toolCall('x1', engine.EXPLAIN_TOOL, { capability: 'trackCompetitors', target: 'Peec AI' }),
      ),
      text('Your role is Analyst, so adding competitors is for Admins and Managers.'),
    ]);
    const result = await runScenario(scenarioOf('analyst-denied'));
    expect(result.run).toMatchObject({ status: 'done', changes: [], cards: 0, denials: 1 });
    expect(result.passed).toBe(true);
  });

  it('reads the next page for an action past the first, and passes naming it', async () => {
    scripted([
      calls(toolCall('r1', 'list_action_center_tasks', { brand_id: BRAND })),
      calls(toolCall('r2', 'list_action_center_tasks', { brand_id: BRAND, offset: 50 })),
      text(
        '**/pricing sayfasına FAQ şeması ekle** (AC-63): yeni, açık bir aksiyon; öncelik puanı 38.',
      ),
    ]);
    const result = await runScenario(scenarioOf('action-past-first-page'));
    expect(result.run.readCalls).toEqual([
      { tool: 'list_action_center_tasks', input: expect.objectContaining({ limit: 50 }) },
      {
        tool: 'list_action_center_tasks',
        input: expect.objectContaining({ limit: 50, offset: 50 }),
      },
    ]);
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails an answer that gives up on the first page, in Turkish or English', async () => {
    for (const answer of [
      'Okuma sınırına takıldım; 38 aksiyon eksik, AC-63’ü bulamadım.',
      "I hit the read limit, so I couldn't read AC-63: 5 actions are missing.",
    ]) {
      // The second text: the engine's rewrite of an English answer to a Turkish question.
      scripted([
        calls(toolCall('r1', 'list_action_center_tasks', { brand_id: BRAND })),
        text(answer),
        text(answer),
      ]);
      const result = await runScenario(scenarioOf('action-past-first-page'));
      expect(result.passed, answer).toBe(false);
      expect(
        result.checks.find((c) => c.name === 'never gives up on data it could read'),
      ).toMatchObject({ ok: false, must: true });
      expect(
        result.checks.find((c) => c.name === 'reads past the first page, or by its code')?.ok,
      ).toBe(false);
    }
  });

  it('passes a long list answered for what it covers, with its total', async () => {
    scripted([
      calls(toolCall('r1', 'list_signals', { brand_id: BRAND })),
      text('The newest 50 of 451 signals this month: most are citations lost on Perplexity.'),
    ]);
    const result = await runScenario(scenarioOf('long-list'));
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
  });

  it('sends the page it was asked on, and passes reading the other page’s data', async () => {
    scripted([
      calls(toolCall('r1', 'get_prompt_performance', { brand_id: BRAND })),
      text('En çok görünürlük kaybeden prompt "best crm for small teams": 12 puan düştü.'),
    ]);
    const result = await runScenario(scenarioOf('other-page-data'));
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    const message = db.tables.chat_messages.find((m) => m.role === 'user');
    expect(JSON.stringify(message)).toContain('Signals');
  });

  it('gets a page cut for size back as a shorter page that says where to read on', async () => {
    const sent = scripted([
      calls(toolCall('r1', 'list_citations', { brand_id: BRAND })),
      text('The top domains of 180, most cited first: source-1.example leads.'),
    ]);
    const result = await runScenario(scenarioOf('cut-by-size'));
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    // What the model read of it: fewer than 50, the next page's offset, and no "{list}_more".
    const read = sent[1];
    expect(read).toMatch(/\\"next_offset\\":(\d+)/);
    const next = Number(/\\"next_offset\\":(\d+)/.exec(read)![1]);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(50);
    expect(read).not.toContain('top_domains_more');
    expect(read).toContain('Read the next page with offset');
  });

  it('reads the head-to-head on Competitors and passes naming the prompts it loses on', async () => {
    scripted([
      calls(
        toolCall('r1', 'get_competitor_head_to_head', {
          brand_id: BRAND,
          competitor: 'Acme CRM',
          side: 'losing',
        }),
      ),
      text(
        'Acme CRM şu promptlarda önde: "best crm for small teams" (görünürlüğümüz 20, onlarınki 60) ve "crm pricing comparison" (25 ile 30).',
      ),
    ]);
    const result = await runScenario(scenarioOf('competitor-losses'));
    expect(result.run.readCalls).toEqual([
      {
        tool: 'get_competitor_head_to_head',
        input: expect.objectContaining({ competitor: 'Acme CRM', side: 'losing' }),
      },
    ]);
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    const message = db.tables.chat_messages.find((m) => m.role === 'user');
    expect(JSON.stringify(message)).toContain('Competitors');
  });

  it('fails an answer on Competitors that reads no head-to-head, or gives up on it', async () => {
    for (const answer of [
      'Bu sayfadan hangi promptlarda kaybettiğimizi okuyamadım.',
      'Acme CRM genel olarak biraz önde; ayrıntı için Rakipler sayfasına bakın.',
    ]) {
      scripted([calls(toolCall('r1', 'list_competitors', { brand_id: BRAND })), text(answer)]);
      const result = await runScenario(scenarioOf('competitor-losses'));
      expect(result.passed, answer).toBe(false);
      expect(result.checks.find((c) => c.name === 'reads the head-to-head')?.ok).toBe(false);
    }
  });

  it('finds a tool name, an id or an id field in what the person was sent', () => {
    // On the events themselves: the engine takes names out of the answer (answer-guards.ts).
    const delta = (text: string) => ({ type: 'text.delta', seq: 1, data: { text } }) as ChatEvent;
    expect(leaksOf([delta('I would call get_plan_facts for that.')])).toEqual(['get_plan_facts']);
    expect(leaksOf([delta(`Draft ${ORG} saved.`)])).toEqual(['an id']);
    expect(leaksOf([delta('Hi. I can check your visibility.')])).toEqual([]);
    const greeting = gradeRun(scenarioOf('greeting'), {
      status: 'done',
      answer: 'I would call get_plan_facts for that.',
      reads: [],
      changes: [],
      cards: 0,
      asks: 0,
      denials: 0,
      leaked: ['get_plan_facts'],
      tokens: { input: 0, output: 0 },
    });
    expect(greeting.passed).toBe(false);
  });
});

// ─── The test set on a real model ───────────────────────────────────────────

/** A key from the environment, else from web/.env.local; never printed. */
function evalKey(name: 'ANTHROPIC_API_KEY' | 'OPENROUTER_API_KEY'): string | null {
  if (process.env[name]) return process.env[name] ?? null;
  try {
    const file = readFileSync(new URL('../../../.env.local', import.meta.url), 'utf8');
    const line = file.split('\n').find((l) => l.startsWith(`${name}=`));
    const value = line
      ?.slice(name.length + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    return value || null;
  } catch {
    return null;
  }
}

/** The models CHAT_MODEL_EVAL names: `untested`, `all`, or catalog ids with commas. */
function evalModels(asked: string): OfferedModel[] {
  if (asked === 'untested') return CHAT_MODELS.filter((model) => !model.tested);
  if (asked === 'all') return [...CHAT_MODELS];
  return asked.split(',').map((id) => {
    const model = CHAT_MODELS.find((m) => m.id === id.trim());
    if (!model) throw new Error(`${id.trim()} isn't in lib/chat/models.ts: add it untested first`);
    return model;
  });
}

/**
 * The model's run, called as the product calls it: Claude on Anthropic's
 * API, else OpenRouter. With CHAT_MODEL_EVAL_VIA=openrouter a Claude model
 * runs through OpenRouter too, in one phase: to compare it with the others
 * where no Anthropic key is at hand; never one called on Anthropic's API
 * only (directOnly: no verified OpenRouter id). The product's own routing
 * is the same. `fetcher`: the capture's (capturingFetch).
 */
function realModels(
  model: OfferedModel,
  key: string,
  via: 'product' | 'openrouter',
  fetcher?: typeof globalThis.fetch,
): ChatModels {
  return onAnthropic(model, via)
    ? pickedClaudeModels(key, 'ansvisor', model, 'normal', { fetch: fetcher })
    : openRouterModels(key, { ...model, api: model.id });
}

/** Whether the eval calls the model on Anthropic's API (realModels). */
const onAnthropic = (model: OfferedModel, via: 'product' | 'openrouter') =>
  model.provider === 'anthropic' && (via === 'product' || model.directOnly === true);

/**
 * A fetch that keeps each Anthropic request's body in `dir`, one line each,
 * in a file per run and phase (the phase by its first system block, which
 * a phase keeps for the whole run): for preserved thinking's three-step
 * check (diff consecutive bodies; replay them). Never a header: no key.
 */
function capturingFetch(dir: string, run: string): typeof globalThis.fetch {
  mkdirSync(dir, { recursive: true });
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/v1/messages') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body) as { system?: { text?: unknown }[] };
      const phase = createHash('sha256')
        .update(String(body.system?.[0]?.text ?? ''))
        .digest('hex')
        .slice(0, 8);
      appendFileSync(join(dir, `${run}-${phase}.jsonl`), `${init.body}\n`);
    }
    return fetch(input, init);
  };
}

const ASKED = process.env.CHAT_MODEL_EVAL?.trim() ?? '';

/** One full pass of the test set on a model. */
interface EvalPass {
  pass: number;
  passed: boolean;
  scenarios: string;
  failed: string;
  tokens: EvalTokens;
  cost: number | null;
}

/** The tokens of some runs, added up. */
function tokensOf(runs: readonly EvalResult[]): EvalTokens {
  const sum = (field: keyof EvalTokens) =>
    runs.reduce((total, r) => total + (r.run.tokens[field] ?? 0), 0);
  return {
    input: sum('input'),
    output: sum('output'),
    cacheRead: sum('cacheRead'),
    cacheWrite: sum('cacheWrite'),
  };
}

describe.skipIf(!ASKED)('the test set on a real model (CHAT_MODEL_EVAL)', () => {
  const only = process.env.CHAT_MODEL_EVAL_ONLY?.split(',').map((id) => id.trim());
  const scenarios = EVAL_SCENARIOS.filter((s) => !only || only.includes(s.id));
  // CHAT_MODEL_EVAL_PASSES: how many passes this run makes; a model is offered only after
  // EVAL_PASSES_TO_OFFER in a row (mayBeOffered).
  const passes = Math.max(1, Number(process.env.CHAT_MODEL_EVAL_PASSES) || 1);
  const via = process.env.CHAT_MODEL_EVAL_VIA === 'openrouter' ? 'openrouter' : 'product';
  const capture = process.env.CHAT_MODEL_EVAL_CAPTURE?.trim() || null;
  /** model → pass → its scenarios' results. */
  const results: Record<string, EvalResult[][]> = {};
  // CHAT_MODEL_EVAL_MAX_USD: no scenario starts once the run has cost this much.
  const maxUsd = Number(process.env.CHAT_MODEL_EVAL_MAX_USD) || null;
  let spentUsd = 0;
  /** Whether a model failed a `must` check in an earlier pass: its later passes don't run. */
  const failedBefore = (model: string, pass: number) =>
    (results[model] ?? []).slice(0, pass - 1).some((runs) => runs.some((r) => !r.passed));

  afterAll(() => {
    const models = Object.entries(results).map(([model, byPass]) => {
      const done: EvalPass[] = byPass.map((runs, i) => {
        const tokens = tokensOf(runs);
        return {
          pass: i + 1,
          passed: runs.length === scenarios.length && runs.every((r) => r.passed),
          scenarios: `${runs.filter((r) => r.passed).length}/${scenarios.length}`,
          failed: runs
            .flatMap((r) =>
              r.checks.filter((c) => c.must && !c.ok).map((c) => `${r.scenario}: ${c.name}`),
            )
            .join('; '),
          tokens,
          cost: evalCost(model, tokens),
        };
      });
      const listed = CHAT_MODELS.find((m) => m.id === model);
      return {
        model,
        via: listed && onAnthropic(listed, via) ? 'product' : 'openrouter',
        // Every scenario of the whole set, EVAL_PASSES_TO_OFFER passes in a row.
        mayBeOffered: !only && mayBeOffered(done),
        passes: done,
        cost: done.reduce((sum, p) => sum + (p.cost ?? 0), 0),
      };
    });
    const out =
      process.env.CHAT_MODEL_EVAL_OUT ?? join(tmpdir(), `chat-model-eval-${Date.now()}.json`);
    writeFileSync(
      out,
      JSON.stringify(
        { ranAt: new Date().toISOString(), passesToOffer: EVAL_PASSES_TO_OFFER, models, results },
        null,
        2,
      ),
    );
    console.log(`Chat model eval: report at ${out}`);
    console.table(
      models.flatMap(({ model, mayBeOffered, passes: done }) =>
        done.map((p) => ({
          model,
          pass: p.pass,
          scenarios: p.scenarios,
          cost: p.cost === null ? '?' : `$${p.cost.toFixed(3)}`,
          mayBeOffered,
          failed: p.failed,
        })),
      ),
    );
  });

  // A skipped describe still collects its tests: no models without CHAT_MODEL_EVAL.
  for (const model of ASKED ? evalModels(ASKED) : []) {
    const anthropic = onAnthropic(model, via);
    const key = evalKey(anthropic ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY');
    describe(model.id, () => {
      for (let pass = 1; pass <= passes; pass++) {
        for (const scenario of scenarios) {
          it.skipIf(!key)(
            `pass ${pass} · row ${scenario.row}: ${scenario.id}`,
            async ({ skip }) => {
              if (maxUsd !== null && spentUsd >= maxUsd) skip(`$${spentUsd.toFixed(2)} spent`);
              // Stopped early: a pass with a failed `must` check already rules the model out.
              if (failedBefore(model.id, pass)) skip('failed an earlier pass');
              const run = `${model.id.replace(/\W+/g, '_')}-p${pass}-${scenario.id}`;
              const fetcher = capture && anthropic ? capturingFetch(capture, run) : undefined;
              fakes.resolveModels.mockResolvedValue(realModels(model, key!, via, fetcher));
              const result = await runScenario(scenario);
              const byPass = (results[model.id] ??= []);
              (byPass[pass - 1] ??= []).push(result);
              const cost = evalCost(model.id, result.run.tokens) ?? 0;
              spentUsd += cost;
              console.log(
                `${model.id} · pass ${pass} · ${scenario.id}: ${result.passed ? 'passed' : 'failed'}, $${cost.toFixed(3)} ($${spentUsd.toFixed(3)} so far)`,
              );
              expect(result.checks.filter((c) => c.must && !c.ok)).toEqual([]);
            },
            300_000,
          );
        }
      }
    });
  }
});
