import { describe, expect, it } from 'vitest';
import { passageKey } from './cited-passages';
import {
  cleanInsertHtml,
  draftPassages,
  keepAgentSuggestions,
  splitReplace,
} from './agent-suggestions';

const HTML =
  '<h1>How to brew pour-over</h1><p>Use good coffee &amp; hot water.</p>' +
  '<ul><li><p>A <strong>dripper</strong></p></li></ul>' +
  '<table><tbody><tr><td><p>Ratio</p></td></tr></tbody></table>' +
  '<div data-html-block="PHA+aGk8L3A+"></div><p>Pour&nbsp;slowly.</p>';

describe('draftPassages', () => {
  it('reads headings and paragraphs in order, with the text the editor has', () => {
    expect(draftPassages(HTML)).toEqual([
      { tag: 'h1', text: 'How to brew pour-over' },
      { tag: 'p', text: 'Use good coffee & hot water.' },
      { tag: 'p', text: 'A dripper' },
      { tag: 'p', text: 'Ratio' },
      // A non-breaking space, as the editor keeps it.
      { tag: 'p', text: 'Pour\u00a0slowly.' },
    ]);
  });
});

describe('cleanInsertHtml', () => {
  it('keeps simple blocks without attributes and drops scripts', () => {
    expect(
      cleanInsertHtml(
        '<h2 class="x">FAQ</h2><p onclick="y()">How long? <a href="z">3 min</a></p><script>bad()</script><img src="a">',
      ),
    ).toBe('<h2>FAQ</h2><p>How long? 3 min</p>');
  });

  it('makes an agent’s H1 an H2: the page has its title', () => {
    expect(cleanInsertHtml('<h1 class="x">New title</h1><p>Text</p>')).toBe(
      '<h2>New title</h2><p>Text</p>',
    );
  });
});

describe('keepAgentSuggestions', () => {
  const passages = draftPassages(HTML);
  const locked = new Set([passageKey('A dripper')]);
  const replace = (over = {}) => ({
    kind: 'replace' as const,
    passage: 2,
    before: 'good coffee',
    after: '15 g of coffee',
    reason: 'add a number (rule)',
    rules: ['dated', 'dated'],
    ...over,
  });

  it('keeps a replace found in its passage, and an insert cleaned', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [
        replace(),
        {
          kind: 'insert',
          passage: 3,
          after: '<h2>FAQ</h2><p>Q? <em>A</em></p>',
          reason: 'add FAQ block',
        },
      ],
      passages,
      locked,
    );
    expect(dropped).toEqual([]);
    expect(kept).toEqual([
      {
        kind: 'replace',
        block_text: 'Use good coffee & hot water.',
        before_text: 'good coffee',
        after_text: '15 g of coffee',
        reason: 'add a number (rule)',
        rule_keys: ['dated'],
      },
      {
        kind: 'insert',
        block_text: 'A dripper',
        before_text: '',
        after_text: '<h2>FAQ</h2><p>Q? <em>A</em></p>',
        reason: 'add FAQ block',
        rule_keys: [],
      },
    ]);
  });

  it('says why each one it drops was dropped', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [
        replace({ passage: 9 }),
        replace({ passage: 3, before: 'dripper', after: 'cone' }),
        replace({ before: 'cold water' }),
        replace({ after: 'good coffee' }),
        replace({ after: '<p></p>' }),
        replace(),
        replace(),
      ],
      passages,
      locked,
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual([
      { index: 0, reason: 'no_passage' },
      { index: 1, reason: 'locked' },
      { index: 2, reason: 'not_in_passage' },
      { index: 3, reason: 'no_change' },
      { index: 4, reason: 'empty' },
      { index: 6, reason: 'duplicate' },
    ]);
  });
});

/**
 * An answer written into a heading's replace was glued onto the heading's
 * line ("What is LLM SEO? LLM SEO optimizes…"): it now goes after it.
 */
describe('a replace on a heading', () => {
  const page = draftPassages('<h2>What is LLM SEO</h2><p>It is new.</p><h2>FAQ</h2>');
  const heading = (after: string, over = {}) => ({
    kind: 'replace' as const,
    passage: 1,
    before: 'What is LLM SEO',
    after,
    reason: 'answer under the H2',
    ...over,
  });

  it('keeps the question in the heading and inserts its answer after it', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [heading('What is LLM SEO? LLM SEO optimizes pages for large language models & AI.')],
      page,
      new Set(),
    );
    expect(dropped).toEqual([]);
    expect(kept.map((k) => [k.kind, k.block_text, k.after_text])).toEqual([
      ['replace', 'What is LLM SEO', 'What is LLM SEO?'],
      [
        'insert',
        'What is LLM SEO',
        '<p>LLM SEO optimizes pages for large language models &amp; AI.</p>',
      ],
    ]);
  });

  it('turns a FAQ sent as a heading replace into the heading and an insert', () => {
    const { kept } = keepAgentSuggestions(
      [
        heading(
          '<h2>Frequently Asked Questions</h2><h3>What is an AEO tracker?</h3><p>It monitors AI answers.</p>',
          { passage: 3, before: 'FAQ' },
        ),
      ],
      page,
      new Set(),
    );
    expect(kept.map((k) => [k.kind, k.after_text])).toEqual([
      ['replace', 'Frequently Asked Questions'],
      ['insert', '<h3>What is an AEO tracker?</h3><p>It monitors AI answers.</p>'],
    ]);
  });

  it('says when a heading would still run over its length', () => {
    const { kept, dropped } = keepAgentSuggestions(
      [heading('What is LLM SEO '.repeat(10))],
      page,
      new Set(),
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual([{ index: 0, reason: 'heading_too_long' }]);
  });

  it('holds an H1 to 70 characters and other headings to 90, unless they get shorter', () => {
    const run = (html: string, before: string, after: string) =>
      keepAgentSuggestions(
        [{ kind: 'replace', passage: 1, before, after, reason: 'tighten' }],
        draftPassages(html),
        new Set(),
      ).dropped;
    expect(run('<h1>Guide</h1>', 'Guide', 'x'.repeat(70))).toEqual([]);
    expect(run('<h1>Guide</h1>', 'Guide', 'x'.repeat(71))).toEqual([
      { index: 0, reason: 'heading_too_long' },
    ]);
    expect(run('<h2>Guide</h2>', 'Guide', 'x'.repeat(90))).toEqual([]);
    expect(run('<h3>Guide</h3>', 'Guide', 'x'.repeat(91))).toEqual([
      { index: 0, reason: 'heading_too_long' },
    ]);
    // An imported heading already over its limit may still be shortened.
    expect(run(`<h2>${'y'.repeat(120)}</h2>`, 'y'.repeat(20), 'z'.repeat(10))).toEqual([]);
  });

  it('keeps a split suggestion whole, or not at all, at the cap', () => {
    const many = Array.from({ length: 19 }, (_, i) => ({
      kind: 'insert' as const,
      passage: 2,
      after: `<p>Note ${i}.</p>`,
      reason: 'note',
    }));
    const { kept, dropped } = keepAgentSuggestions(
      [...many, heading('What is LLM SEO? LLM SEO optimizes pages for large language models.')],
      page,
      new Set(),
    );
    expect(kept).toHaveLength(19);
    expect(dropped).toEqual([{ index: 19, reason: 'too_many' }]);
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
      ).blocks,
    ).toBe('<p>LLM SEO optimizes pages for large language models.</p><p>More.</p>');
  });

  it('keeps a subtitle that fits, and splits after a full-width ？ with no space', () => {
    const subtitle = 'What is AEO? The Complete Guide to Answer Engine Optimization';
    expect(splitReplace(subtitle, 'h1')).toEqual({ words: subtitle, blocks: '' });
    expect(
      splitReplace(
        'AEOとは？AEOはAIアシスタントの回答に引用されるための最適化の方法です。詳しく順番に説明します。',
        'h2',
      ).words,
    ).toBe('AEOとは？');
    // "?" inside a word is no question's end.
    expect(splitReplace('What?No. A long enough sentence that ends here.', 'h2').blocks).toBe('');
    // Past the heading's limit the rest goes under it, a full stop or not.
    const long = `What is LLM SEO? ${'LLM SEO optimizes pages for large language models '.repeat(2)}`;
    expect(splitReplace(long, 'h2').words).toBe('What is LLM SEO?');
  });

  it('keeps a heading with a second clause, and moves blocks off a paragraph', () => {
    // A short second part is the heading's, not an answer.
    expect(splitReplace("Is AEO worth it? Here's what the data says.", 'h2').blocks).toBe('');
    expect(
      splitReplace(
        'AEO とは？ AEO は AI アシスタントの回答に引用されるための最適化の方法です。説明します。',
        'h2',
      ).words,
    ).toBe('AEO とは？');
    expect(splitReplace('AEO or SEO? Which matters more in 2026', 'h2')).toEqual({
      words: 'AEO or SEO? Which matters more in 2026',
      blocks: '',
    });
    expect(splitReplace('<p>Use 15 g.</p><ul><li>a scale</li></ul>', 'p')).toEqual({
      words: 'Use 15 g.',
      blocks: '<ul><li>a scale</li></ul>',
    });
  });
});
