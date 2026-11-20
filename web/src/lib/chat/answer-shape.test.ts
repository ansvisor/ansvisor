import { describe, expect, it } from 'vitest';
import { isContentAnswer, remarkCodeActionRefs } from './answer-shape';

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

describe('what an answer is (UX audit CH-10, CH-11)', () => {
  it('reads a page with a title, or two sections and enough words, as content', () => {
    expect(isContentAnswer(`# Best CRM for startups\n\n${words(40)}`)).toBe(true);
    expect(isContentAnswer(`## Why\n${words(150)}\n\n## How\n${words(150)}`)).toBe(true);
  });

  it('reads a plain answer as no page, even with a heading or two', () => {
    expect(isContentAnswer('Your visibility rose 4 points this week, led by ChatGPT.')).toBe(false);
    expect(isContentAnswer(`## Summary\n${words(60)}\n\n## Next\n${words(40)}`)).toBe(false);
    // A heading inside a code block isn't the answer's.
    expect(isContentAnswer('```md\n# Title\n```\nThat is the format.')).toBe(false);
  });

  it('turns an action code in code marks into text, and leaves other code alone', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'inlineCode', value: 'AC-12' },
            { type: 'text', value: ' and ' },
            { type: 'inlineCode', value: 'AC-12 done' },
          ],
        },
        { type: 'code', value: 'AC-3' },
      ],
    };
    remarkCodeActionRefs()(tree);
    expect(tree.children[0].children!.map((c) => [c.type, c.value])).toEqual([
      ['text', 'AC-12'],
      ['text', ' and '],
      ['inlineCode', 'AC-12 done'],
    ]);
    expect(tree.children[1]).toEqual({ type: 'code', value: 'AC-3' });
  });
});
