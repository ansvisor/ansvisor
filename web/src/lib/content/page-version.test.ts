import { describe, expect, it } from 'vitest';
import {
  PREVIEW_TEXT,
  htmlText,
  pageChanges,
  pageCounts,
  pagePlaceholders,
  pagePreview,
  pageSections,
} from './page-version';

const FAQ_V1 = [
  '<h1>FAQ: Pricing</h1>',
  '<p>Plans for every team.</p>',
  '<h2>Which AI platforms does it track?</h2>',
  '<p>Starter: ChatGPT and Copilot. Growth: six platforms.</p>',
  '<h2>Can I change plans?</h2>',
  `<p>${'Yes, you can move to another plan at any time from Billing, and the change applies from your next period. '.repeat(2)}</p>`,
].join('');

const FAQ_V2 = [
  '<h1>FAQ: Pricing</h1>',
  '<p>Plans for every team.</p>',
  '<h2>Which AI platforms does it track?</h2>',
  '<p>Starter: ChatGPT and Copilot. Growth: six platforms.</p>',
  '<h2>Can I change plans?</h2>',
  '<p>Yes, any time from Billing.</p>',
  '<h2>Can I get a refund?</h2>',
  '<p>Yes, within [REFUND PERIOD] of your first payment &amp; no fee.</p>',
].join('');

describe('a page’s version (W4-12a)', () => {
  it('reads the text without tags, with the common entities', () => {
    expect(htmlText('<p>Q&amp;A &lt;3&nbsp;<b>now</b></p>')).toBe('Q&A <3 now');
  });

  it('splits the page at its H2 and H3 headings, nothing before the first', () => {
    expect(pageSections(FAQ_V1)).toEqual([
      {
        heading: 'Which AI platforms does it track?',
        text: 'Starter: ChatGPT and Copilot. Growth: six platforms.',
      },
      { heading: 'Can I change plans?', text: expect.stringMatching(/^Yes, you can move/) },
    ]);
    expect(pageSections('<p>No headings.</p>')).toEqual([]);
  });

  it('counts its questions, sections and characters', () => {
    expect(pageCounts(FAQ_V2)).toEqual({
      questions: 3,
      sections: 3,
      characters: expect.any(Number),
    });
    expect(pageCounts(FAQ_V2).characters).toBeGreaterThan(100);
  });

  it('lists each placeholder to fill once, and nothing for lowercase brackets', () => {
    expect(pagePlaceholders(`${FAQ_V2}<p>Again: [REFUND PERIOD], [see note]</p>`)).toEqual([
      '[REFUND PERIOD]',
    ]);
  });

  it('says what changed: shorter sections with their lengths, new headings, placeholders', () => {
    const changes = pageChanges(FAQ_V1, FAQ_V2);
    expect(changes.shortened).toEqual([
      { heading: 'Can I change plans?', before: expect.any(Number), after: 27 },
    ]);
    expect(changes.shortened[0].before).toBeGreaterThan(150);
    expect(changes.added).toEqual(['Can I get a refund?']);
    expect(changes.placeholders).toEqual(['[REFUND PERIOD]']);
    // A first version has nothing before it: every heading is new.
    expect(pageChanges('', FAQ_V1).added).toHaveLength(2);
  });

  it('previews the first two sections, each cut to fit', () => {
    const preview = pagePreview(FAQ_V1);
    expect(preview.map((s) => s.heading)).toEqual([
      'Which AI platforms does it track?',
      'Can I change plans?',
    ]);
    expect(preview[1].text.length).toBe(PREVIEW_TEXT);
    expect(preview[1].text.endsWith('…')).toBe(true);
  });
});
