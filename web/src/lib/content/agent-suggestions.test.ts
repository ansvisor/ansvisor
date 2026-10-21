import { describe, expect, it } from 'vitest';
import { passageKey } from './cited-passages';
import { cleanInsertHtml, draftPassages, keepAgentSuggestions } from './agent-suggestions';

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
