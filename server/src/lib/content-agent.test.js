import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fix open rules with agent (Content Editor CE-018): the Content Agent's
 * suggestions on the open rules, kept only where the editor can apply them,
 * never on a locked passage, and metered from the AI usage budget.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let rows;
let writes;
const generateObject = vi.fn();
const enforceImproveQuota = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const result = () => ({ data: rows[table] ?? null, error: null });
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => result(),
        insert: async (value) => (writes.push({ table, value }), { error: null }),
        maybeSingle: async () => result(),
        single: async () => result(),
      };
      return chain;
    },
  },
}));
vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
vi.mock('./ai-provider.js', () => ({ resolveModel: vi.fn((id) => `model:${id}`) }));
vi.mock('./plan-guard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  enforceImproveQuota: (...args) => enforceImproveQuota(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn() } }));

const {
  buildFixPrompt,
  cleanInsertHtml,
  draftPassages,
  fixDraftRules,
  keepSuggestions,
  MAX_PROMPT_PASSAGE_CHARS,
  passageKey,
  promptPassages,
} = await import('./content-agent.js');
const { PlanLimitError } = await import('./plan-guard.js');

const BODY =
  '<h1>How to brew pour-over coffee</h1><p>Pour-over coffee tastes better than other methods.</p>' +
  '<ul><li><p>A dripper and a filter</p></li></ul><p>Use good coffee and hot water.</p>';

const input = (over = {}) => ({
  rules: [
    { key: 'dated', name: 'A dated data point', detail: 'missing' },
    { key: 'faq', name: 'FAQ with 5 questions', detail: 'missing' },
  ],
  textRules: ['Say “we” for the brand'],
  locked: [passageKey('Pour-over coffee tastes better than other methods.')],
  ...over,
});

const suggestion = (over = {}) => ({
  kind: 'replace',
  passage: 4,
  before: 'good coffee and hot water',
  after: '15 g of coffee and 250 g of water at 94 °C ([source, year])',
  reason: 'add a dated data point (rule)',
  rules: ['dated', 'made-up'],
  ...over,
});

beforeEach(() => {
  writes = [];
  rows = {
    content_drafts: {
      id: DRAFT,
      brand_id: BRAND,
      title: 'How to brew pour-over coffee',
      body_html: BODY,
      page_type: 'guide',
      action_id: 'act-1',
      status: 'draft',
    },
    brands: { name: 'Acme Coffee', organization_id: 'org-1', language: 'en' },
  };
  generateObject.mockReset();
  enforceImproveQuota.mockReset().mockResolvedValue(undefined);
});

describe('the page as the agent reads it', () => {
  it('reads headings and paragraphs in order, as the editor does', () => {
    expect(draftPassages(BODY)).toEqual([
      { tag: 'h1', text: 'How to brew pour-over coffee' },
      { tag: 'p', text: 'Pour-over coffee tastes better than other methods.' },
      { tag: 'p', text: 'A dripper and a filter' },
      { tag: 'p', text: 'Use good coffee and hot water.' },
    ]);
  });

  it('compares passages by their words, as the editor does', () => {
    expect(passageKey('Pour-over’s 94 °C — “Fresh”.')).toBe('pour overs 94 c fresh');
  });

  it('marks locked passages and lists the rules for the model', () => {
    const passages = draftPassages(BODY);
    const prompt = buildFixPrompt({
      brand: { name: 'Acme Coffee', language: 'en' },
      draft: rows.content_drafts,
      passages,
      lockedKeys: new Set(input().locked),
      input: input(),
    });
    expect(prompt).toContain('[2] (p, LOCKED) Pour-over coffee tastes better than other methods.');
    expect(prompt).toContain('[4] (p) Use good coffee and hot water.');
    expect(prompt).toContain('- dated: A dated data point — missing');
    expect(prompt).toContain('- Say “we” for the brand');
    expect(prompt).toContain('Write in English.');
    expect(prompt).toContain('Page type: How-to guide: numbered steps');
    expect(prompt).not.toContain('The page goes on');
  });

  it('sends a long page only up to its cap, and no passage too long to change', () => {
    const long = { tag: 'p', text: 'x'.repeat(5_001) };
    const passage = { tag: 'p', text: 'y'.repeat(4_000) };
    const many = Array.from({ length: 20 }, () => passage);
    const sent = promptPassages([long, ...many]);
    expect(sent.more).toBe(true);
    expect(sent.passages).toHaveLength(MAX_PROMPT_PASSAGE_CHARS / 4_000);
    expect(sent.passages).not.toContain(long);
    expect(promptPassages(draftPassages(BODY))).toEqual({
      passages: draftPassages(BODY),
      more: false,
    });
    const prompt = buildFixPrompt({
      brand: { name: 'Acme Coffee', language: 'en' },
      draft: rows.content_drafts,
      ...sent,
      lockedKeys: new Set(),
      input: input(),
    });
    expect(prompt).toContain('(The page goes on; suggest changes only to the passages above.)');
  });
});

describe('keepSuggestions', () => {
  const passages = draftPassages(BODY);
  const locked = new Set(input().locked);
  const ruleKeys = new Set(['dated', 'faq']);

  it('keeps a replace whose words are in its passage, with the rules sent', () => {
    expect(keepSuggestions([suggestion()], passages, locked, ruleKeys)).toEqual([
      {
        kind: 'replace',
        block_text: 'Use good coffee and hot water.',
        before_text: 'good coffee and hot water',
        after_text: '15 g of coffee and 250 g of water at 94 °C ([source, year])',
        reason: 'add a dated data point (rule)',
        rule_keys: ['dated'],
      },
    ]);
  });

  it('drops one on a locked passage, words not in the passage, or no passage', () => {
    expect(
      keepSuggestions(
        [
          suggestion({ passage: 2, before: 'tastes better', after: 'is brighter' }),
          suggestion({ before: 'cold water' }),
          suggestion({ passage: 9 }),
          suggestion({ after: 'good coffee and hot water' }),
        ],
        passages,
        locked,
        ruleKeys,
      ),
    ).toEqual([]);
  });

  it('keeps an insert after a locked passage, its HTML cleaned', () => {
    const [kept] = keepSuggestions(
      [
        suggestion({
          kind: 'insert',
          passage: 2,
          before: '',
          after:
            '<h2 class="x">FAQ</h2><p onclick="y()">How long? <a href="z">3 min</a></p><script>bad()</script>',
          reason: 'add FAQ block (rule)',
          rules: ['faq'],
        }),
      ],
      passages,
      locked,
      ruleKeys,
    );
    expect(kept).toMatchObject({
      kind: 'insert',
      block_text: 'Pour-over coffee tastes better than other methods.',
      before_text: '',
      after_text: '<h2>FAQ</h2><p>How long? 3 min</p>',
      rule_keys: ['faq'],
    });
  });

  it('keeps each change once', () => {
    expect(keepSuggestions([suggestion(), suggestion()], passages, locked, ruleKeys)).toHaveLength(
      1,
    );
  });
});

describe('cleanInsertHtml', () => {
  it('keeps simple blocks without attributes and unwraps the rest', () => {
    expect(
      cleanInsertHtml('<div><h3 style="x">Q</h3><ol><li><em>a</em></li></ol><img src=x></div>'),
    ).toBe('<h3>Q</h3><ol><li><em>a</em></li></ol>');
  });
});

describe('fixDraftRules', () => {
  it('charges the budget, asks the model and keeps one batch for review', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion(),
          suggestion({ passage: 2, before: 'tastes better', after: 'is brighter' }),
        ],
      },
      usage: { inputTokens: 900, outputTokens: 200 },
    });

    const result = await fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() });

    expect(enforceImproveQuota).toHaveBeenCalledWith('org-1', expect.any(String));
    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.stringMatching(/^model:/) }),
    );
    expect(result).toEqual({ count: 1, batchId: expect.any(String) });
    const usage = writes.find((w) => w.table === 'prompt_improve_usage');
    expect(usage.value).toMatchObject({ organization_id: 'org-1', content_draft_id: DRAFT });
    const batch = writes.find((w) => w.table === 'content_draft_suggestions');
    expect(batch.value).toEqual([
      expect.objectContaining({
        draft_id: DRAFT,
        batch_id: result.batchId,
        action_id: 'act-1',
        position: 0,
        kind: 'replace',
      }),
    ]);
  });

  it('keeps nothing when the agent found nothing it could change', async () => {
    generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ count: 0, batchId: null });
    expect(writes.some((w) => w.table === 'content_draft_suggestions')).toBe(false);
  });

  it('refuses another brand’s draft or an empty page before charging anything', async () => {
    await expect(
      fixDraftRules({
        draftId: DRAFT,
        brandId: '44444444-4444-4444-4444-444444444444',
        input: input(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    rows.content_drafts.body_html = '<p> </p>';
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 422, code: 'empty' });
    expect(enforceImproveQuota).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('refuses a published draft, or one whose latest batch is still open, before charging', async () => {
    rows.content_drafts.status = 'published';
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'published' });

    rows.content_drafts.status = 'ready';
    // Newest first: the latest batch b2 has an open row.
    rows.content_draft_suggestions = [
      { batch_id: 'b2', status: 'accepted' },
      { batch_id: 'b2', status: 'open' },
      { batch_id: 'b1', status: 'open' },
    ];
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'open_suggestions' });
    expect(enforceImproveQuota).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();

    // An older batch left open doesn't count: the editor shows the latest.
    rows.content_draft_suggestions = [
      { batch_id: 'b2', status: 'rejected' },
      { batch_id: 'b1', status: 'open' },
    ];
    generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ count: 0, batchId: null });
  });

  it('stops at the budget', async () => {
    enforceImproveQuota.mockRejectedValue(new PlanLimitError('AI usage is spent', 'starter'));
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(generateObject).not.toHaveBeenCalled();
  });
});
