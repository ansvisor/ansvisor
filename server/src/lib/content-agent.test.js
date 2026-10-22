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
  growsPastLimit,
  HEADING_LIMITS,
  MAX_PROMPT_PASSAGE_CHARS,
  passageKey,
  promptPassages,
  splitReplace,
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

/**
 * An answer written into a heading's replace was glued onto the heading's
 * line ("What is LLM SEO? LLM SEO optimizes…", "Frequently Asked
 * QuestionsWhat is an AEO tracker?…"): it now goes after the heading.
 */
describe('a replace on a heading', () => {
  const page = draftPassages(
    '<h2>What is LLM SEO</h2><p>It is new.</p><h2>FAQ</h2><p>Ask us.</p><p>Use good coffee.</p>',
  );
  const keep = (over) =>
    keepSuggestions(
      [suggestion({ passage: 1, before: 'What is LLM SEO', rules: ['faq'], ...over })],
      page,
      new Set(),
      new Set(['faq']),
    );

  it('keeps the question in the heading and inserts its answer after it', () => {
    expect(
      keep({ after: 'What is LLM SEO? LLM SEO optimizes pages for large language models.' }),
    ).toEqual([
      expect.objectContaining({
        kind: 'replace',
        block_text: 'What is LLM SEO',
        before_text: 'What is LLM SEO',
        after_text: 'What is LLM SEO?',
      }),
      expect.objectContaining({
        kind: 'insert',
        block_text: 'What is LLM SEO',
        after_text: '<p>LLM SEO optimizes pages for large language models.</p>',
        rule_keys: ['faq'],
      }),
    ]);
  });

  it('turns a heading sent with its blocks into the heading and an insert', () => {
    const kept = keepSuggestions(
      [
        suggestion({
          passage: 3,
          before: 'FAQ',
          after:
            '<h2>Frequently Asked Questions</h2><h3>What is an AEO tracker?</h3><p>An AEO tracker monitors AI answers.</p>',
        }),
      ],
      page,
      new Set(),
      new Set(),
    );
    expect(kept.map((k) => [k.kind, k.after_text])).toEqual([
      ['replace', 'Frequently Asked Questions'],
      ['insert', '<h3>What is an AEO tracker?</h3><p>An AEO tracker monitors AI answers.</p>'],
    ]);
  });

  it('leaves only the insert when the heading keeps its words', () => {
    expect(
      keep({ after: '<h2>What is LLM SEO</h2><p>LLM SEO optimizes pages.</p>' }).map((k) => k.kind),
    ).toEqual(['insert']);
  });

  it('keeps a split suggestion whole, or not at all, at the cap', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      suggestion({ kind: 'insert', passage: 2, before: '', after: `<p>Note ${i}.</p>` }),
    );
    const answer = suggestion({
      after: 'What is LLM SEO? LLM SEO optimizes pages for large language models.',
    });
    const kept = keepSuggestions(
      [...many, { ...answer, passage: 1, before: 'What is LLM SEO' }],
      page,
      new Set(),
      new Set(),
    );
    expect(kept).toHaveLength(7);
    expect(kept.every((k) => k.kind === 'insert')).toBe(true);
  });

  it('drops one that would still make the heading over its length', () => {
    expect(keep({ after: 'What is LLM SEO '.repeat(10) })).toEqual([]);
  });

  it('holds an H1 to 70 characters and other headings to 90, unless they get shorter', () => {
    expect(HEADING_LIMITS).toEqual({ h1: 70, other: 90 });
    const h1 = { tag: 'h1', text: 'Guide' };
    const h2 = { tag: 'h2', text: 'Guide' };
    expect(growsPastLimit(h1, 'Guide', 'x'.repeat(70))).toBe(false);
    expect(growsPastLimit(h1, 'Guide', 'x'.repeat(71))).toBe(true);
    expect(growsPastLimit(h2, 'Guide', 'x'.repeat(90))).toBe(false);
    expect(growsPastLimit(h2, 'Guide', 'x'.repeat(91))).toBe(true);
    // An imported heading already over its limit may still be shortened.
    const long = { tag: 'h2', text: 'y'.repeat(120) };
    expect(growsPastLimit(long, 'y'.repeat(20), 'z'.repeat(10))).toBe(false);
    expect(growsPastLimit(long, 'y'.repeat(20), 'z'.repeat(30))).toBe(true);
    // A paragraph has no limit here.
    expect(growsPastLimit({ tag: 'p', text: 'a' }, 'a', 'b'.repeat(500))).toBe(false);
  });

  it('keeps a heading with a second clause, and a paragraph replace as it was', () => {
    expect(splitReplace('AEO or SEO? Which matters more in 2026', 'h2')).toEqual({
      words: 'AEO or SEO? Which matters more in 2026',
      blocks: '',
    });
    // A short second part is the heading's, not an answer.
    expect(splitReplace("Is AEO worth it? Here's what the data says.", 'h2').blocks).toBe('');
    expect(splitReplace('What is AEO? The complete guide.', 'h1').blocks).toBe('');
    expect(
      splitReplace(
        'AEO とは？ AEO は AI アシスタントの回答に引用されるための最適化の方法です。説明します。',
        'h2',
      ),
    ).toEqual({
      words: 'AEO とは？',
      blocks: '<p>AEO は AI アシスタントの回答に引用されるための最適化の方法です。説明します。</p>',
    });
    // A non-breaking space stays one, as the passage keeps it.
    expect(splitReplace('Pour\u00a0slowly', 'p').words).toBe('Pour\u00a0slowly');
    expect(splitReplace('Use 15 g of coffee. Then pour.', 'p')).toEqual({
      words: 'Use 15 g of coffee. Then pour.',
      blocks: '',
    });
  });

  it('puts the answer first under the heading when blocks come with it', () => {
    expect(
      splitReplace(
        'What is LLM SEO? LLM SEO optimizes pages for large language models.<ul><li>a</li></ul>',
        'h2',
      ),
    ).toEqual({
      words: 'What is LLM SEO?',
      blocks: '<p>LLM SEO optimizes pages for large language models.</p><ul><li>a</li></ul>',
    });
    expect(
      splitReplace(
        '<h2>What is LLM SEO? LLM SEO optimizes pages for large language models.</h2><p>More.</p>',
        'h2',
      ),
    ).toEqual({
      words: 'What is LLM SEO?',
      blocks: '<p>LLM SEO optimizes pages for large language models.</p><p>More.</p>',
    });
  });

  it('keeps a subtitle that fits, and splits after a full-width ？ with no space', () => {
    const subtitle = 'What is AEO? The Complete Guide to Answer Engine Optimization';
    expect(splitReplace(subtitle, 'h1')).toEqual({ words: subtitle, blocks: '' });
    expect(
      splitReplace(
        'AEOとは？AEOはAIアシスタントの回答に引用されるための最適化の方法です。詳しく順番に説明します。',
        'h2',
      ),
    ).toEqual({
      words: 'AEOとは？',
      blocks:
        '<p>AEOはAIアシスタントの回答に引用されるための最適化の方法です。詳しく順番に説明します。</p>',
    });
    // "?" inside a word is no question's end.
    expect(splitReplace('What?No. A long enough sentence that ends here.', 'h2').blocks).toBe('');
    // Past the heading's limit the rest goes under it, a full stop or not.
    const long = `What is LLM SEO? ${'LLM SEO optimizes pages for large language models '.repeat(2)}`;
    expect(splitReplace(long, 'h2').words).toBe('What is LLM SEO?');
  });

  it('moves blocks sent with a paragraph replace after it', () => {
    expect(splitReplace('<p>Use 15 g.</p><ul><li>a scale</li></ul>', 'p')).toEqual({
      words: 'Use 15 g.',
      blocks: '<ul><li>a scale</li></ul>',
    });
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
      expect.objectContaining({
        model: expect.stringMatching(/^model:/),
        // An answer goes after a heading, never into it.
        system: expect.stringContaining(
          'Never write an answer, a sentence or a FAQ into a heading',
        ),
      }),
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
