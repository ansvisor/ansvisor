import { describe, expect, it } from 'vitest';
import {
  fleschBand,
  fleschReadingEase,
  readingBlocks,
  sentencesOf,
  syllablesOf,
} from './readability.js';

/**
 * Site Audit's readability reads a page as the Content Editor's Quality
 * does (web/src/lib/content/readability.ts): the same blocks, sentences,
 * syllables and band. The page both read alike is in audit.test.js.
 */

describe('readability as the editor reads it', () => {
  it('has no score under 30 words, nor for headings alone', () => {
    expect(fleschReadingEase(readingBlocks('<p>Too short.</p>'))).toBeNull();
    expect(fleschReadingEase(readingBlocks(`<h2>${'Word '.repeat(40)}</h2>`))).toBeNull();
  });

  it('reads each prose block on its own: list items yes, headings and cells no', () => {
    expect(
      readingBlocks(
        '<h2>Steps</h2><ul><li>Rinse it.<ul><li>Nested.</li></ul></li></ul><blockquote><p>Taste it.</p></blockquote><table><tr><td><p>Cell.</p></td></tr></table><script>x()</script>',
      ),
    ).toEqual([
      { tag: 'h2', text: 'Steps' },
      { tag: 'li', text: 'Rinse it.' },
      { tag: 'li', text: 'Nested.' },
      { tag: 'blockquote', text: 'Taste it.' },
    ]);
  });

  it('splits sentences as the editor does', () => {
    expect(sentencesOf('Use a ratio, e.g. 1:16. Then brew.')).toEqual([
      'Use a ratio, e.g. 1:16.',
      'Then brew.',
    ]);
    expect(sentencesOf('Say no. Then see No. 5 below.')).toEqual([
      'Say no.',
      'Then see No. 5 below.',
    ]);
    expect(sentencesOf('He said "stop." Then he left. (It was late.) Nobody spoke.')).toEqual([
      'He said "stop."',
      'Then he left.',
      '(It was late.)',
      'Nobody spoke.',
    ]);
    // A lower-case word goes on the sentence.
    expect(sentencesOf('Prices rose 3 pct. in May. Then they fell… and rose.')).toEqual([
      'Prices rose 3 pct. in May.',
      'Then they fell… and rose.',
    ]);
  });

  it('counts syllables as the editor does', () => {
    expect(syllablesOf('the')).toBe(1);
    expect(syllablesOf('readable')).toBe(3);
    expect(syllablesOf('quickly')).toBe(2);
    // "-ted" and "-ded" keep their syllable; a silent final e doesn't count.
    expect(syllablesOf('wanted')).toBe(2);
    expect(syllablesOf('makes')).toBe(1);
  });

  it('reads text left loose in a div, a caption or a definition list as a paragraph', () => {
    expect(
      readingBlocks(
        '<div>Loose <b>words</b> here.<div>Inner words.</div><p>A paragraph.</p></div><figure><figcaption>A caption.</figcaption></figure><dl><dt>Term</dt><dd>Its meaning.</dd></dl><ul><li><div>Item words.</div></li></ul>',
      ),
    ).toEqual([
      { tag: 'p', text: 'Loose words here.' },
      { tag: 'p', text: 'Inner words.' },
      { tag: 'p', text: 'A paragraph.' },
      { tag: 'p', text: 'A caption.' },
      { tag: 'p', text: 'Term' },
      { tag: 'p', text: 'Its meaning.' },
      { tag: 'li', text: 'Item words.' },
    ]);
  });

  it('passes 50–70, warns 30–50 and 70–80, and fails past them, as the score shows', () => {
    expect(fleschBand(50)).toEqual({ status: 'pass', score: 1 });
    expect(fleschBand(70)).toEqual({ status: 'pass', score: 1 });
    expect(fleschBand(45)).toEqual({ status: 'warn', score: 0.5 });
    expect(fleschBand(75)).toEqual({ status: 'warn', score: 0.5 });
    expect(fleschBand(81)).toEqual({ status: 'fail', score: 0 });
    expect(fleschBand(29)).toEqual({ status: 'fail', score: 0 });
    // Rounded, as it shows: 70.4 reads 70, 49.6 reads 50.
    expect(fleschBand(70.4)).toEqual({ status: 'pass', score: 1 });
    expect(fleschBand(49.6)).toEqual({ status: 'pass', score: 1 });
  });
});
