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
const reserveAiBudget = vi.fn();

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
class NoObjectGeneratedError extends Error {
  static isInstance(err) {
    return err instanceof NoObjectGeneratedError;
  }
}
vi.mock('ai', () => ({
  generateObject: (...args) => generateObject(...args),
  NoObjectGeneratedError,
}));
vi.mock('./ai-provider.js', () => ({ resolveModel: vi.fn((id) => `model:${id}`) }));
vi.mock('./plan-guard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reserveAiBudget: (...args) => reserveAiBudget(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const readLinkTargets = vi.fn();
vi.mock('./content-links.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readLinkTargets: (...args) => readLinkTargets(...args),
}));

const {
  asksMoreThanOne,
  buildFixPrompt,
  cleanInsertHtml,
  draftPassages,
  fixDraftRules,
  keepSuggestions,
  growsPastLimit,
  HEADING_LIMITS,
  inlineText,
  MAX_PROMPT_PASSAGE_CHARS,
  passageKey,
  promptPassages,
  splitReplace,
} = await import('./content-agent.js');
const { linkKey, NO_LINK_TARGETS } = await import('./content-links.js');
const { PlanLimitError } = await import('./plan-guard.js');
// The real hold: self-hosted here, so it reserves nothing and writes each charge.
const realGuard = await vi.importActual('./plan-guard.js');

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
  reserveAiBudget.mockReset().mockImplementation(realGuard.reserveAiBudget);
  readLinkTargets.mockReset().mockResolvedValue(NO_LINK_TARGETS);
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

  it('drops one that adds a second question to a heading, and keeps a question reworded', () => {
    const faq = draftPassages(
      '<h2>FAQ</h2><h3>What is AEO?</h3><p>Answer engine optimization.</p>',
    );
    const run = (after) =>
      keepSuggestions(
        [suggestion({ passage: 2, before: 'What is AEO?', after, rules: ['fanoutFaq'] })],
        faq,
        new Set(),
        new Set(['fanoutFaq']),
      );
    // A fan-out's question added to the one there, short, past the limit or answered.
    expect(run('What is AEO? What is an AEO tracker?')).toEqual([]);
    expect(
      run(
        'What is AEO? What is an AEO tracker? An AEO tracker is a tool that reads many AI engines for you.',
      ),
    ).toEqual([]);
    expect(
      run(`What is AEO? How does ${'an AEO tracker read many engines and '.repeat(3)}work?`),
    ).toEqual([]);
    // The question reworded into the fan-out's words.
    expect(run('What is an AEO tracker?')).toEqual([
      expect.objectContaining({ kind: 'replace', after_text: 'What is an AEO tracker?' }),
    ]);
    // A heading that already asks two may still change.
    expect(asksMoreThanOne({ tag: 'h3', text: 'Why AEO? Why now?' }, 'now', 'today')).toBe(false);
    expect(asksMoreThanOne({ tag: 'p', text: 'Why?' }, 'Why?', 'Why? How?')).toBe(false);
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
    expect(splitReplace('AEO or SEO? Which matters more in 2026', 'h2')).toMatchObject({
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
    ).toMatchObject({
      words: 'AEO とは？',
      blocks: '<p>AEO は AI アシスタントの回答に引用されるための最適化の方法です。説明します。</p>',
    });
    // A non-breaking space stays one, as the passage keeps it.
    expect(splitReplace('Pour\u00a0slowly', 'p').words).toBe('Pour\u00a0slowly');
    expect(splitReplace('Use 15 g of coffee. Then pour.', 'p')).toMatchObject({
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
    ).toMatchObject({
      words: 'What is LLM SEO?',
      blocks: '<p>LLM SEO optimizes pages for large language models.</p><ul><li>a</li></ul>',
    });
    expect(
      splitReplace(
        '<h2>What is LLM SEO? LLM SEO optimizes pages for large language models.</h2><p>More.</p>',
        'h2',
      ),
    ).toMatchObject({
      words: 'What is LLM SEO?',
      blocks: '<p>LLM SEO optimizes pages for large language models.</p><p>More.</p>',
    });
  });

  it('keeps a subtitle that fits, and splits after a full-width ？ with no space', () => {
    const subtitle = 'What is AEO? The Complete Guide to Answer Engine Optimization';
    expect(splitReplace(subtitle, 'h1')).toMatchObject({ words: subtitle, blocks: '' });
    expect(
      splitReplace(
        'AEOとは？AEOはAIアシスタントの回答に引用されるための最適化の方法です。詳しく順番に説明します。',
        'h2',
      ),
    ).toMatchObject({
      words: 'AEOとは？',
      blocks:
        '<p>AEOはAIアシスタントの回答に引用されるための最適化の方法です。詳しく順番に説明します。</p>',
    });
    // "?" inside a word is no question's end.
    expect(splitReplace('What?No. A long enough sentence that ends here.', 'h2').blocks).toBe('');
    // Past the heading's limit the rest goes under it, a full stop or not.
    const long = `What is LLM SEO? ${'LLM SEO optimizes pages for large language models '.repeat(2)}`;
    expect(splitReplace(long, 'h2').words).toBe('What is LLM SEO?');
    // A second question is no answer, with its own answer or not: it stays,
    // for keepSuggestions to drop.
    const two = `What is LLM SEO? How does ${'LLM SEO read many engines and '.repeat(3)}work?`;
    expect(splitReplace(two, 'h2')).toMatchObject({ words: two, blocks: '' });
    const answered =
      'What is AEO? What is an AEO tracker? An AEO tracker is a tool that reads many AI engines for you.';
    expect(splitReplace(answered, 'h3')).toMatchObject({ words: answered, blocks: '' });
    // An answer that ends on a question still goes under the heading.
    const why = `What is LLM SEO? ${'LLM SEO optimizes pages for large language models. '.repeat(2)}Why care?`;
    expect(splitReplace(why, 'h2').words).toBe('What is LLM SEO?');
  });

  it('moves blocks sent with a paragraph replace after it', () => {
    expect(splitReplace('<p>Use 15 g.</p><ul><li>a scale</li></ul>', 'p')).toMatchObject({
      words: 'Use 15 g.',
      blocks: '<ul><li>a scale</li></ul>',
    });
  });
});

/**
 * Content Agent rule gaps, A: links only to the brand's pages and the draft's
 * sources it was given, a replace's beside its words, an insert's in its HTML.
 */
describe('links to the pages and sources given', () => {
  const page = draftPassages(
    '<h2>Pricing</h2><p>See our plans for teams.</p><p>Studies show it works.</p>',
  );
  const links = new Map(
    ['https://acme.example/pricing', 'https://research.example/study'].map((url) => [
      linkKey(url),
      url,
    ]),
  );
  const keep = (over, ruleKeys = ['internalLinks']) =>
    keepSuggestions(
      [suggestion({ passage: 2, before: 'See our plans for teams.', rules: ruleKeys, ...over })],
      page,
      new Set(),
      new Set(ruleKeys),
      links,
    );

  it('keeps a replace’s link to a listed page, by its words, with the page’s URL', () => {
    const [kept] = keep({
      after:
        'See <a href="https://www.acme.example/pricing/?utm_source=x">our plans</a> for teams.',
    });
    expect(kept).toMatchObject({
      kind: 'replace',
      after_text: 'See our plans for teams.',
      after_links: [{ start: 4, end: 13, href: 'https://acme.example/pricing' }],
      rule_keys: ['internalLinks'],
    });
  });

  it('unwraps a link to anything not listed, and drops what then changes nothing', () => {
    expect(
      keep({ after: 'See <a href="https://made-up.example/x">our plans</a> for teams.' }),
    ).toMatchObject([]);
    const [kept] = keep({ after: 'See <a href="https://made-up.example/x">our team plans</a>.' });
    expect(kept.after_text).toBe('See our team plans.');
    expect(kept).not.toHaveProperty('after_links');
  });

  it('keeps an insert’s link to a listed source, never one in a heading', () => {
    const [kept] = keepSuggestions(
      [
        suggestion({
          kind: 'insert',
          passage: 3,
          before: '',
          after:
            '<h3><a href="https://research.example/study">Study</a></h3><p>A <a href="https://research.example/study" target="_blank" onclick="x()">2025 study</a> found it.</p>',
          rules: ['citeInline'],
        }),
      ],
      page,
      new Set(),
      new Set(['citeInline']),
      links,
    );
    expect(kept.after_text).toBe(
      '<h3>Study</h3><p>A <a href="https://research.example/study">2025 study</a> found it.</p>',
    );
  });

  it('keeps at most 20 links on a replace, as the table allows', () => {
    const many = Array.from(
      { length: 22 },
      (_, i) => `<a href="https://acme.example/pricing">plan ${i}</a>`,
    ).join(' ');
    const [kept] = keep({ after: `See ${many} for teams.` });
    expect(kept.after_links).toHaveLength(20);
  });

  it('keeps no link without targets, as before', () => {
    const [kept] = keepSuggestions(
      [
        suggestion({
          kind: 'insert',
          passage: 3,
          before: '',
          after: '<p>A <a href="https://research.example/study">study</a>.</p>',
        }),
      ],
      page,
      new Set(),
      new Set(),
    );
    expect(kept.after_text).toBe('<p>A study.</p>');
  });

  it('reads inline words and their links, spaces collapsed', () => {
    expect(inlineText('Read <a href="u"> the  guide </a><br>now')).toEqual({
      text: 'Read the guide now',
      links: [{ start: 5, end: 14, href: 'u' }],
    });
  });

  it('gives the model the targets for the link rules asked, and keeps the links', async () => {
    readLinkTargets.mockResolvedValue({
      own: [{ url: 'https://acme.example/brew-guide', title: 'Brew guide' }],
      sources: [{ url: 'https://research.example/study', title: 'Coffee study' }],
    });
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          suggestion({
            after:
              'Use good coffee (see <a href="https://acme.example/brew-guide">our brew guide</a>).',
            rules: ['internalLinks'],
          }),
        ],
      },
      usage: {},
    });
    const result = await fixDraftRules({
      draftId: DRAFT,
      brandId: BRAND,
      input: input({ rules: [{ key: 'internalLinks', name: 'Internal links', detail: '0 of 3' }] }),
    });

    expect(readLinkTargets).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: BRAND, draftId: DRAFT }),
    );
    const { prompt, system } = generateObject.mock.calls[0][0];
    expect(prompt).toContain(
      "Pages on the brand's site you may link to (internal links):\n- Brew guide — https://acme.example/brew-guide",
    );
    // Only the rule asked for: no outbound list.
    expect(prompt).not.toContain('Sources you may link to');
    expect(system).toContain('Never invent a URL');
    // The fan-outs a rule names, in their words (B).
    expect(system).toContain('fanoutH2 wants an H2, fanoutFaq a question');
    expect(system).toContain('One question per heading: never add a question to a heading.');
    expect(result.count).toBe(1);
    const batch = writes.find((w) => w.table === 'content_draft_suggestions');
    expect(batch.value[0]).toMatchObject({
      after_text: 'Use good coffee (see our brew guide).',
      after_links: [{ start: 21, end: 35, href: 'https://acme.example/brew-guide' }],
    });
  });
});

describe('cleanInsertHtml', () => {
  it('makes an agent’s H1 an H2: the page has its title', () => {
    expect(cleanInsertHtml('<h1 class="x">New title</h1><p>Text</p>')).toBe(
      '<h2>New title</h2><p>Text</p>',
    );
  });

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

    expect(reserveAiBudget).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ feature: 'content', modelId: expect.any(String) }),
    );
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
    expect(usage.value).toMatchObject({
      organization_id: 'org-1',
      content_draft_id: DRAFT,
      feature: 'content',
    });
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
    expect(reserveAiBudget).not.toHaveBeenCalled();
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
    expect(reserveAiBudget).not.toHaveBeenCalled();
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
    reserveAiBudget.mockRejectedValue(new PlanLimitError('AI usage is spent', 'starter'));
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('lets the hold on the budget go when the model fails', async () => {
    const held = { charge: vi.fn(), release: vi.fn() };
    reserveAiBudget.mockResolvedValueOnce(held);
    generateObject.mockRejectedValueOnce(new Error('timeout'));
    await expect(fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() })).rejects.toThrow(
      'timeout',
    );
    expect(held.charge).not.toHaveBeenCalled();
    expect(held.release).toHaveBeenCalled();
  });

  it('charges an answer that missed the schema, as the provider billed it', async () => {
    const held = { charge: vi.fn(), release: vi.fn() };
    reserveAiBudget.mockResolvedValueOnce(held);
    const billed = { inputTokens: 900, outputTokens: 4000 };
    generateObject.mockRejectedValueOnce(
      Object.assign(new NoObjectGeneratedError('no object'), { usage: billed }),
    );
    await expect(
      fixDraftRules({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toBeInstanceOf(NoObjectGeneratedError);
    expect(held.charge).toHaveBeenCalledTimes(1);
    expect(held.charge).toHaveBeenCalledWith(billed);
    expect(held.release).toHaveBeenCalled();
  });
});
