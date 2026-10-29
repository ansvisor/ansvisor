// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';
import {
  BRAND,
  OPPORTUNITY,
  ORG,
  PEOPLE,
  SUGGESTION,
  fakeCreateDraft,
  fakeDismissSuggestion,
  fakeUpdateOpportunity,
  seedWorkspace,
} from './testing/chat-fixtures';

/**
 * A change Chat makes, logged once (CHAT-20 §10a, §11c, §21): every WRITE
 * that ran lands in the Activity log with its mode, approval and Undo; a
 * double-clicked approval makes one object.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/actions/content-drafts', () => ({ createContentDraft: vi.fn() }));
vi.mock('@/lib/actions/content', () => ({ updateOpportunityStatus: vi.fn() }));
vi.mock('@/lib/actions/prompt-suggestions', () => ({ dismissSuggestion: vi.fn() }));
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { createContentDraft } = await import('@/lib/actions/content-drafts');
const { updateOpportunityStatus } = await import('@/lib/actions/content');
const { dismissSuggestion } = await import('@/lib/actions/prompt-suggestions');
const { requestAccess } = await import('@/lib/actions/chat-access-requests');
const { runLoggedWrite } = await import('./write');
const { activitySummary, approvalFor, logActivity, recordActivity } = await import('./activity');
const { decideToolCall } = await import('./precedence');
const { readPrecedenceContext, readToolCall } = await import('./precedence-context');
const { chatTool, CHAT_TOOLS } = await import('./registry/tools');
const { UNDO_RULES } = await import('./undo');

type ChatMode = import('./precedence').ChatMode;
type ChatTool = import('./registry/define-tool').ChatTool;

const WRITES = CHAT_TOOLS.filter((tool) => tool.class === 'write');
// The writes Full auto may run without a card: an always-card row (Ask your Admin) never does.
const AUTO_WRITES = WRITES.filter((tool) => !tool.flags.alwaysCard);
const INPUTS: Record<string, unknown> = {
  create_draft: {
    brand_id: BRAND,
    title: 'Pricing FAQ',
    page_type: 'docs_faq',
    method: 'create',
    source: { kind: 'opportunity', id: OPPORTUNITY },
  },
  update_opportunity: { opportunity_id: OPPORTUNITY, status: 'dismissed', reason: 'not_relevant' },
  dismiss_prompt_suggestion: { suggestion_id: SUGGESTION },
  request_access: { asked: 'Add competitors · Peec AI', rule_kind: 'role' },
};
const toolCtx = {} as never;
let step = 0;
const nextStep = () => `step-${++step}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seedWorkspace(db);
  vi.mocked(createContentDraft).mockImplementation(fakeCreateDraft(db) as never);
  vi.mocked(updateOpportunityStatus).mockImplementation(fakeUpdateOpportunity(db) as never);
  vi.mocked(dismissSuggestion).mockImplementation(fakeDismissSuggestion(db) as never);
  db.tables.chat_access_requests = [];
  vi.mocked(requestAccess).mockImplementation(async (input) => {
    const id = `request-${db.tables.chat_access_requests.length + 1}`;
    db.tables.chat_access_requests.push({ id, asked: input.asked, status: 'pending' });
    return { ok: true, id };
  });
});
afterEach(() => vi.unstubAllEnvs());

/** The engine's path: decide the call, act on the decision, run and log it. */
async function runAs(
  userId: string,
  tool: ChatTool,
  mode: ChatMode,
  options: { approvalKey?: string; input?: unknown; approved?: boolean } = {},
) {
  const input = (options.input ?? INPUTS[tool.name]) as Record<string, unknown>;
  const ctx = await readPrecedenceContext({ userId, organizationId: ORG, mode, surface: 'chat' });
  const call = await readToolCall(ctx!, tool, input, false);
  const decision = decideToolCall(tool, ctx!, call);
  if (decision.kind === 'ask' && !options.approved) return { decision, outcome: null };
  const approval = approvalFor(decision);
  if (!approval || approval.kind === 'run') return { decision, outcome: null };
  const outcome = await runLoggedWrite({
    tool,
    input,
    ctx: toolCtx,
    organizationId: ORG,
    userId,
    brandId: call.brandId,
    surface: 'chat',
    mode,
    approval,
    place: { conversationId: null, runId: null, stepId: null },
    approvalKey: options.approvalKey ?? nextStep(),
  });
  return { decision, outcome };
}

describe('every WRITE that ran is in the Activity log (§21)', () => {
  it.each(AUTO_WRITES.map((tool) => [tool.name, tool] as const))(
    '%s in Full auto: mode, approval, Undo window, label key, target and summary',
    async (name, tool) => {
      const { decision, outcome } = await runAs(PEOPLE.admin, tool, 'full_auto');
      expect(decision).toEqual({ kind: 'run', via: 'full_auto' });
      expect(outcome).toMatchObject({ code: 'ok', repeated: false });

      const rows = db.tables.chat_activity_log;
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({
        organization_id: ORG,
        user_id: PEOPLE.admin,
        brand_id: BRAND,
        surface: 'chat',
        tool_key: tool.labelKey,
        class: 'write',
        mode: 'full_auto',
        approval_kind: 'auto',
        auto_via: 'full_auto',
        target_type: UNDO_RULES[name].targetType,
        summary_key: tool.labelKey,
        status: 'done',
      });
      // The label key, never the tool's name (CHAT-03 item 22).
      expect(JSON.stringify(row)).not.toContain(name);
      expect(row.target_id).toEqual(expect.any(String));
      expect(row.undo_json).toEqual(expect.any(Object));
      const window = Date.parse(row.undo_until as string) - Date.now();
      expect(window).toBeGreaterThan(UNDO_RULES[name].windowMs - 60_000);
      expect(window).toBeLessThanOrEqual(UNDO_RULES[name].windowMs);
      expect(outcome && 'activityId' in outcome && outcome.activityId).toBe(row.id);
      expect(activitySummary(row.summary_key as string, row.summary_params as never)).not.toBe('');
    },
  );

  it('logs Ask your Admin on its card, in every mode, with its Undo: withdraw while it waits', async () => {
    const tool = chatTool('request_access')!;
    const first = await runAs(PEOPLE.analyst, tool, 'full_auto');
    expect(first.decision).toMatchObject({ kind: 'ask', reason: 'always_card' });
    expect(requestAccess).not.toHaveBeenCalled(); // Only the person's click sends it.
    const { outcome } = await runAs(PEOPLE.analyst, tool, 'ask_first', { approved: true });
    expect(outcome).toMatchObject({ code: 'ok' });
    const [row] = db.tables.chat_activity_log;
    expect(row).toMatchObject({
      user_id: PEOPLE.analyst,
      brand_id: null,
      tool_key: 'askAdmin',
      approval_kind: 'ask',
      target_type: 'access_request',
      target_id: 'request-1',
      summary_key: 'askAdmin',
      summary_params: { asked: 'Add competitors · Peec AI' },
      status: 'done',
    });
    expect(JSON.stringify(row)).not.toContain('request_access');
    expect(activitySummary('askAdmin', row.summary_params as never)).toBe(
      'Asked your Admins: “Add competitors · Peec AI”',
    );

    const { undoChange } = await import('./undo');
    const undone = await undoChange({
      activityId: row.id as string,
      userId: PEOPLE.analyst,
      organizationId: ORG,
      surface: 'chat',
    });
    expect(undone).toMatchObject({ code: 'ok' });
    expect(db.tables.chat_access_requests[0].status).toBe('withdrawn');
  });

  it('records why a change ran without a card: Always, Full auto or "Don\'t ask again"', async () => {
    const tool = chatTool('dismiss_prompt_suggestion')!;
    db.tables.chat_auto_choices = [
      { user_id: PEOPLE.manager, organization_id: ORG, tool_key: tool.labelKey },
    ];
    await runAs(PEOPLE.manager, tool, 'auto');
    db.tables.prompt_suggestions[0].status = 'new';
    db.tables.chat_auto_choices = [];
    db.tables.chat_settings = [
      {
        organization_id: ORG,
        tool_policies: { [tool.labelKey]: 'always' },
        full_auto_for_members: true,
        dont_ask_again: true,
        manager_execute_off: [],
      },
    ];
    await runAs(PEOPLE.manager, tool, 'auto');
    expect(
      db.tables.chat_activity_log.map((row) => [row.mode, row.approval_kind, row.auto_via]),
    ).toEqual([
      ['auto', 'auto', 'dont_ask_again'],
      ['auto', 'auto', 'always'],
    ]);
  });

  it('records a change approved on its card as ask, in the mode it ran in', async () => {
    const tool = chatTool('create_draft')!;
    const first = await runAs(PEOPLE.manager, tool, 'ask_first');
    expect(first.decision.kind).toBe('ask');
    expect(db.tables.content_drafts).toHaveLength(0); // Nothing before the OK.
    await runAs(PEOPLE.manager, tool, 'ask_first', { approved: true });
    expect(db.tables.chat_activity_log[0]).toMatchObject({
      mode: 'ask_first',
      approval_kind: 'ask',
      auto_via: null,
    });
  });

  it('says what changed in words', () => {
    expect(activitySummary('saveDraft', { title: 'Pricing FAQ' })).toBe(
      'Saved the draft “Pricing FAQ”',
    );
    expect(activitySummary('opportunityStatus', { title: 'Teams', status: 'dismissed' })).toBe(
      'Dismissed the opportunity “Teams”',
    );
    expect(activitySummary('opportunityStatus', { title: 'Teams', status: 'reviewed' })).toBe(
      'Marked reviewed the opportunity “Teams”',
    );
    expect(activitySummary('dismissSuggestionUndo', { text: 'best crm' })).toBe(
      'Brought back the prompt suggestion “best crm”',
    );
  });
});

describe('a double-clicked approval creates one object (§21)', () => {
  it('two calls at once with the same approval save one draft and write one row', async () => {
    const tool = chatTool('create_draft')!;
    const [a, b] = await Promise.all([
      runAs(PEOPLE.manager, tool, 'auto', { approved: true, approvalKey: 'card-1' }),
      runAs(PEOPLE.manager, tool, 'auto', { approved: true, approvalKey: 'card-1' }),
    ]);
    expect(db.tables.content_drafts).toHaveLength(1);
    expect(db.tables.chat_activity_log).toHaveLength(1);
    expect(createContentDraft).toHaveBeenCalledTimes(1);
    expect(a.outcome).toMatchObject({ code: 'ok', output: db.tables.content_drafts[0].id });
    expect(b.outcome).toMatchObject({ code: 'ok', output: db.tables.content_drafts[0].id });
    expect([a.outcome, b.outcome].map((o) => o && 'repeated' in o && o.repeated).sort()).toEqual([
      false,
      true,
    ]);
  });

  it('a retry after the first call finished gets its result and log row back', async () => {
    const tool = chatTool('create_draft')!;
    const first = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-2' });
    const again = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-2' });
    expect(again.outcome).toEqual({ ...first.outcome, repeated: true });
    expect(db.tables.content_drafts).toHaveLength(1);
  });

  it('two approvals make two drafts', async () => {
    const tool = chatTool('create_draft')!;
    await runAs(PEOPLE.manager, tool, 'full_auto');
    await runAs(PEOPLE.manager, tool, 'full_auto');
    expect(db.tables.content_drafts).toHaveLength(2);
    expect(db.tables.chat_activity_log).toHaveLength(2);
  });

  it('an approval used for another change is a mismatch: nothing is made', async () => {
    const tool = chatTool('create_draft')!;
    await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-3' });
    const other = await runAs(PEOPLE.manager, tool, 'full_auto', {
      approvalKey: 'card-3',
      input: { ...(INPUTS.create_draft as object), title: 'Something else' },
    });
    expect(other.outcome).toEqual({ code: 'approval_mismatch' });
    expect(db.tables.content_drafts).toHaveLength(1);
  });
});

describe('failures', () => {
  it('a WRITE that failed is not logged, and its approval may be tried again', async () => {
    const tool = chatTool('create_draft')!;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createContentDraft).mockRejectedValueOnce(new Error('server down'));
    const failed = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-4' });
    expect(failed.outcome).toEqual({ code: 'failed', reason: 'server down' });
    expect(db.tables.chat_activity_log).toHaveLength(0);
    errors.mockRestore();
    const retry = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-4' });
    expect(retry.outcome).toMatchObject({ code: 'ok', repeated: false });
    expect(db.tables.content_drafts).toHaveLength(1);
  });

  it("a log row that can't be written never makes the change twice", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = chatTool('create_draft')!;
    db.failures.chat_activity_log = { message: 'insert failed' };
    const first = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-5' });
    expect(first.outcome).toMatchObject({ code: 'ok', activityId: null });
    const again = await runAs(PEOPLE.manager, tool, 'full_auto', { approvalKey: 'card-5' });
    expect(again.outcome).toMatchObject({ code: 'ok', repeated: true });
    expect(db.tables.content_drafts).toHaveLength(1);
    errors.mockRestore();
  });

  it("logs a change without its Undo when what Undo needs can't be read", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = chatTool('update_opportunity')!;
    const realFrom = db.from.bind(db);
    let changed = false;
    const update = fakeUpdateOpportunity(db);
    vi.mocked(updateOpportunityStatus).mockImplementationOnce((async (
      ...args: Parameters<typeof update>
    ) => {
      const row = await update(...args);
      changed = true;
      return row;
    }) as never);
    db.from = (table: string) => {
      // The reads before the change work; the one after it fails.
      if (table === 'content_opportunities' && changed) throw new Error('read failed');
      return realFrom(table);
    };
    try {
      await runAs(PEOPLE.manager, tool, 'full_auto');
    } finally {
      db.from = realFrom;
    }
    expect(db.tables.chat_activity_log).toHaveLength(1);
    expect(db.tables.chat_activity_log[0]).toMatchObject({ undo_json: null, undo_until: null });
    errors.mockRestore();
  });
});

describe('what is logged', () => {
  it('a read is never logged, and an EXECUTE only on a click and without Undo', async () => {
    const read = CHAT_TOOLS.find((tool) => tool.class === 'read')!;
    await expect(
      runLoggedWrite({
        tool: read,
        input: {},
        ctx: toolCtx,
        organizationId: ORG,
        userId: PEOPLE.admin,
        brandId: BRAND,
        surface: 'chat',
        mode: 'full_auto',
        approval: { kind: 'auto', via: 'full_auto' },
        place: { conversationId: null, runId: null, stepId: null },
        approvalKey: 'x',
      }),
    ).rejects.toThrow();
    const execute = {
      ...chatTool('create_draft')!,
      class: 'execute' as const,
      labelKey: 'publishCms',
    };
    await expect(
      runLoggedWrite({
        tool: execute,
        input: {},
        ctx: toolCtx,
        organizationId: ORG,
        userId: PEOPLE.admin,
        brandId: BRAND,
        surface: 'chat',
        mode: 'full_auto',
        approval: { kind: 'auto', via: 'full_auto' },
        place: { conversationId: null, runId: null, stepId: null },
        approvalKey: 'x',
      }),
    ).rejects.toThrow("An EXECUTE runs on the person's click only");
    const entry = {
      organizationId: ORG,
      userId: PEOPLE.admin,
      brandId: BRAND,
      place: { conversationId: null, runId: null, stepId: null },
      surface: 'chat' as const,
      tool: execute,
      mode: 'auto' as const,
      approval: { kind: 'click' as const },
      target: { type: 'cms_item', id: 'item-1' },
      summary: { key: 'publishCms', params: {} },
      undo: null,
    };
    await expect(
      logActivity({ ...entry, undo: { data: {}, until: new Date() } }),
    ).rejects.toThrow();
    expect(await logActivity(entry)).toEqual(expect.any(String));
  });

  it('maps each decision to its approval', () => {
    expect(approvalFor({ kind: 'run', via: 'read' })).toBeNull();
    expect(approvalFor({ kind: 'run', via: 'always' })).toEqual({ kind: 'auto', via: 'always' });
    expect(approvalFor({ kind: 'ask', reason: 'mode', offerDontAskAgain: true })).toEqual({
      kind: 'ask',
    });
    expect(approvalFor({ kind: 'click' })).toEqual({ kind: 'click' });
    expect(approvalFor({ kind: 'deny', denial: { code: 'policy_never' } })).toBeNull();
  });
});

describe('access.denied rows (§4c, §10a)', () => {
  it("records a refusal in the person's log: its reason, no approval, target or Undo", async () => {
    const tool = chatTool('update_opportunity')!;
    const ctx = await readPrecedenceContext({
      userId: PEOPLE.analyst,
      organizationId: ORG,
      mode: 'auto',
      surface: 'chat',
    });
    const decision = decideToolCall(
      tool,
      ctx!,
      await readToolCall(ctx!, tool, INPUTS.update_opportunity as Record<string, unknown>, false),
    );
    expect(decision.kind).toBe('deny');
    if (decision.kind !== 'deny') return;
    // The shape access-log.ts's accessDeniedEvent builds.
    const { code, ...detail } = decision.denial;
    const id = await recordActivity({
      kind: 'access.denied',
      userId: PEOPLE.analyst,
      organizationId: ORG,
      brandId: BRAND,
      toolKey: tool.labelKey,
      toolClass: tool.class,
      surface: 'chat',
      reason: code,
      detail,
      conversationId: null,
      runId: null,
    });
    expect(db.tables.chat_activity_log).toEqual([
      expect.objectContaining({
        id,
        kind: 'access.denied',
        user_id: PEOPLE.analyst,
        brand_id: BRAND,
        tool_key: 'opportunityStatus',
        class: 'write',
        denial_code: 'forbidden_role',
        denial_json: { role: 'analyst', roles: ['admin', 'manager'] },
        summary_key: 'accessDenied',
        summary_params: { tool: 'Review or dismiss opportunities' },
      }),
    ]);
    // Nothing ran: no approval, target or Undo (00402 holds the same).
    for (const column of ['approval_kind', 'target_type', 'undo_json', 'undo_until']) {
      expect(db.tables.chat_activity_log[0][column] ?? null).toBeNull();
    }
    expect(activitySummary('accessDenied', { tool: 'Review or dismiss opportunities' })).toBe(
      'Not allowed: Review or dismiss opportunities',
    );
  });

  it('a denial is never undone', async () => {
    const { undoChange } = await import('./undo');
    const id = await recordActivity({
      kind: 'access.denied',
      userId: PEOPLE.manager,
      organizationId: ORG,
      brandId: null,
      toolKey: 'saveDraft',
      toolClass: 'write',
      surface: 'mcp',
      reason: 'brand_scope',
      detail: {},
      conversationId: null,
      runId: null,
    });
    expect(
      await undoChange({
        activityId: id,
        userId: PEOPLE.manager,
        organizationId: ORG,
        surface: 'chat',
      }),
    ).toMatchObject({ code: 'not_undoable' });
  });
});

describe('00402', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../../../supabase/migrations/00402_chat_activity.sql'),
    'utf8',
  );

  it('lets a person read their own rows and an Admin the workspace’s; only the server writes', () => {
    expect(sql).toMatch(/alter table public\.chat_activity_log enable row level security/);
    expect(sql).toMatch(/alter table public\.chat_idempotency_keys enable row level security/);
    expect(sql).toMatch(/p\.role = 'admin' or chat_activity_log\.user_id = auth\.uid\(\)/);
    // No write grant or policy for members, and keys not readable at all.
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(sql).not.toMatch(/for (insert|update|delete)/);
    expect(sql).not.toMatch(/grant[^;]*chat_idempotency_keys to authenticated/);
  });

  it('keeps undo_json from members', () => {
    const grant = sql.match(/grant select \(([^)]*)\) on table public\.chat_activity_log/);
    expect(grant).not.toBeNull();
    const columns = grant![1].split(',').map((column) => column.trim());
    expect(columns).not.toContain('undo_json');
    for (const column of ['tool_key', 'mode', 'approval_kind', 'undo_until', 'status']) {
      expect(columns).toContain(column);
    }
  });
});
