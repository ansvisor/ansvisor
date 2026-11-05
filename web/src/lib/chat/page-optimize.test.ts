// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveRule, RuleStatus } from '@/lib/content/rules';
import { createFakeSupabase, type FakeSupabase } from './testing/fake-supabase';

/**
 * Optimize here, no editor (CHAT-25 §7, W4-12b part 2): the editor's
 * Rewrite the page to these rules, waited for and put in as the next
 * version; a rule this chat's agent tried and couldn't close isn't sent again.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  draft: vi.fn(),
  rewrite: vi.fn(),
  update: vi.fn(),
  decide: vi.fn(),
  rules: vi.fn(),
  request: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  get supabaseAdmin() {
    return fake.db;
  },
}));
vi.mock('@/lib/actions/content-drafts', () => ({
  getContentDraft: (...args: unknown[]) => fake.draft(...args),
  startPageRewrite: (...args: unknown[]) => fake.rewrite(...args),
  updateContentDraft: (...args: unknown[]) => fake.update(...args),
  decideDraftSuggestions: (...args: unknown[]) => fake.decide(...args),
}));
vi.mock('@/lib/content/draft-rules-read', () => ({
  readDraftRules: (...args: unknown[]) => fake.rules(...args),
}));
vi.mock('@/lib/content/agent-write', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content/agent-write')>()),
  agentWriteRequest: (...args: unknown[]) => fake.request(...args),
}));

const { optimizeDraftHere, triedInChat, triedOf } = await import('./page-optimize');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const BRAND = '55555555-5555-4555-8555-555555555555';
const ctx = {
  userId: USER,
  email: null,
  organizationId: ORG,
  role: 'manager' as const,
  apiKeyId: 'agent-internal',
  chat: {
    conversationId: CHAT,
    runId: 'r2',
    approvalKey: 'k',
    executionMode: 'assisted' as const,
  },
};

const rule = (key: string, over: Partial<ActiveRule> = {}): ActiveRule =>
  ({
    key,
    group: 'structure',
    kind: 'number',
    value: '5',
    check: 'page',
    on: true,
    current: '5',
    changed: false,
    ...over,
  }) as ActiveRule;
const bad = { state: 'bad', code: 'partOf', count: 3, of: 5 } as RuleStatus;
const ok = { state: 'ok' } as RuleStatus;
const rulesRead = (open: string[]) => ({
  title: 'Pricing FAQ',
  met: 3 - open.length,
  total: 3,
  textRules: ['Say “team”, not “users”'],
  checked: ['faq', 'length', 'oneH1'].map((key) => ({
    rule: rule(key),
    status: open.includes(key) ? bad : ok,
  })),
});

const AFTER = '<h1>Pricing FAQ</h1><h2>Can I get a refund?</h2><p>Yes.</p>';
const fast = { maxMs: 50, pollMs: 1 };

beforeEach(() => {
  fake.db = createFakeSupabase();
  fake.db.tables.chat_runs = [];
  fake.db.tables.chat_run_state = [];
  fake.db.tables.content_agent_runs = [];
  fake.db.tables.content_draft_suggestions = [];
  fake.draft.mockReset().mockResolvedValue({
    id: DRAFT,
    brandId: BRAND,
    title: 'Pricing FAQ',
    pageType: 'docs_faq',
    method: 'create',
    sourceUrl: null,
    bodyHtml: '<h1>Pricing FAQ</h1>',
    rules: { set: null, source: 'default', overrides: {}, textRules: [] },
  });
  fake.rules.mockReset().mockResolvedValue(rulesRead(['faq', 'length']));
  fake.request.mockReset().mockImplementation(async (_draft, describe, inEffect) => ({
    sources: {},
    rules: inEffect.rules.map((r: ActiveRule) => ({ key: r.key, ...describe(r) })),
    textRules: inEffect.textRules,
    locked: [],
  }));
  // The API starts the rewrite, and its run ends with the page as one suggestion.
  fake.rewrite.mockReset().mockImplementation(async () => {
    const now = new Date().toISOString();
    fake.db.tables.content_agent_runs.push({
      draft_id: DRAFT,
      kind: 'rewrite',
      started_at: now,
      finished_at: now,
      outcome: 'done',
    });
    fake.db.tables.content_draft_suggestions.push({
      id: 'sg1',
      draft_id: DRAFT,
      kind: 'page',
      status: 'open',
      after_text: AFTER,
      created_at: now,
    });
    return { started: true };
  });
  fake.update.mockReset().mockResolvedValue({
    ok: true,
    updatedAt: 'now',
    bodyHash: 'h',
    beforeVersionId: 'v1',
  });
  fake.decide.mockReset().mockResolvedValue(1);
});

describe('Optimize here, no editor (W4-12b part 2)', () => {
  it('rewrites the page to its rules as the editor does, and puts it in as the next version', async () => {
    // After the rewrite, the FAQ rule is met and Length is still open.
    fake.rules
      .mockResolvedValueOnce(rulesRead(['faq', 'length']))
      .mockResolvedValueOnce(rulesRead(['length']));
    const result = await optimizeDraftHere(ctx, DRAFT, fast);
    expect(result).toEqual({
      ok: true,
      title: 'Pricing FAQ',
      beforeVersionId: 'v1',
      body_html: AFTER,
      fixed: ['FAQ block'],
      left: ['Length'],
      tried: ['length'],
    });
    const [draftId, brandId, request] = fake.rewrite.mock.calls[0];
    expect([draftId, brandId]).toEqual([DRAFT, BRAND]);
    // The rules in effect, an open one with how the page reads now; the person's own rules too.
    expect(request.rules.map((r: { key: string }) => r.key)).toEqual(['faq', 'length', 'oneH1']);
    expect(request.rules[0].detail).toContain('now: 3 of 5');
    expect(request.textRules).toEqual(['Say “team”, not “users”']);
    expect(request.counted).toBe(3);
    expect(fake.update).toHaveBeenCalledWith(DRAFT, { bodyHtml: AFTER });
    expect(fake.decide).toHaveBeenCalledWith(['sg1'], 'accepted');
  });

  it('never sends the agent again for a rule it tried here, and names what’s left', async () => {
    fake.db.tables.chat_runs = [{ id: 'r1', conversation_id: CHAT }];
    fake.db.tables.chat_run_state = [
      { run_id: 'r1', progress: { optimizeTried: { [DRAFT]: ['length'] } } },
    ];
    expect(await triedInChat(CHAT, DRAFT)).toEqual(['length']);
    await optimizeDraftHere(ctx, DRAFT, fast);
    const request = fake.rewrite.mock.calls[0][2];
    expect(request.rules.map((r: { key: string }) => r.key)).toEqual(['faq', 'oneH1']);
    // Only the tried one open: nothing is sent, and it's the person's.
    fake.rewrite.mockClear();
    fake.rules.mockResolvedValue(rulesRead(['length']));
    expect(await optimizeDraftHere(ctx, DRAFT, fast)).toEqual({
      ok: false,
      reason: 'nothing',
      message: expect.stringContaining('Length'),
      left: ['Length'],
    });
    expect(fake.rewrite).not.toHaveBeenCalled();
  });

  it('says every rule is met, and runs nothing', async () => {
    fake.rules.mockResolvedValue(rulesRead([]));
    expect(await optimizeDraftHere(ctx, DRAFT, fast)).toMatchObject({
      ok: false,
      reason: 'nothing',
      message: 'Every rule the Content Agent can fix is met already.',
    });
    expect(fake.rewrite).not.toHaveBeenCalled();
  });

  it('says the rewrite’s refusals in Chat’s words', async () => {
    fake.rewrite.mockResolvedValue({ error: 'open_suggestions' });
    expect(await optimizeDraftHere(ctx, DRAFT, fast)).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('still wait for review'),
    });
    fake.rewrite.mockResolvedValue({ error: 'ai_budget' });
    expect(await optimizeDraftHere(ctx, DRAFT, fast)).toMatchObject({ reason: 'quota_exceeded' });
    expect(fake.update).not.toHaveBeenCalled();
  });

  it('leaves a rewrite still running for the editor, and changes nothing', async () => {
    fake.rewrite.mockResolvedValue({ started: true });
    expect(await optimizeDraftHere(ctx, DRAFT, fast)).toMatchObject({
      ok: false,
      reason: 'still_writing',
    });
    expect(fake.update).not.toHaveBeenCalled();
  });

  it('finds nothing of a draft the person can’t read', async () => {
    fake.draft.mockResolvedValue(null);
    expect(await optimizeDraftHere(ctx, DRAFT, fast)).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
  });

  it('reads what it tried from its output, by draft', () => {
    expect(triedOf({ draft_id: DRAFT }, { ok: true, tried: ['length'] })).toEqual({
      draftId: DRAFT,
      keys: ['length'],
    });
    expect(triedOf({ draft_id: DRAFT }, { ok: false })).toBeNull();
  });
});
