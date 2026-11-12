import { describe, expect, it } from 'vitest';
import {
  factsOf,
  missingFactsIssue,
  placeholdersIn,
  withoutPlaceholderLines,
} from './placeholders';

describe('placeholdersIn', () => {
  it('finds bracketed stand-ins for facts', () => {
    expect(
      placeholdersIn(
        'Fee: [visa fee], from [price]. Dates: [departure dates]. Call [support contact]. Score [real metric]. [TBD] […] [...]',
      ),
    ).toEqual([
      '[visa fee]',
      '[price]',
      '[departure dates]',
      '[support contact]',
      '[real metric]',
      '[TBD]',
      '[…]',
      '[...]',
    ]);
  });

  it('finds them in a draft’s HTML', () => {
    expect(placeholdersIn('<p>The ferry costs [price] per person.</p>')).toEqual(['[price]']);
  });

  it('leaves links, citations, footnotes, task boxes and code alone', () => {
    const text = [
      'See [the visa guide](https://example.com/visa) and [ferries][1].',
      '![Chios harbour](https://example.com/chios.jpg)',
      'As cited [1] and [^2].',
      '- [ ] book ferry',
      '- [x] book hotel',
      'a[href] and arr[index]',
      '[1]: https://example.com/ferries',
      '```',
      'const fee = [price];',
      '```',
    ].join('\n');
    expect(placeholdersIn(text)).toEqual([]);
  });

  it('keeps the ones the person wrote', () => {
    expect(placeholdersIn('Hi [First name], from [price]', 'Use [First name] in it')).toEqual([
      '[price]',
    ]);
  });
});

describe('withoutPlaceholderLines', () => {
  it('drops the lines with a placeholder', () => {
    expect(
      withoutPlaceholderLines(
        'Visibility rose to 16.3.\n\nCitations: [real metric]\n\nNext: refresh the visa page.',
      ),
    ).toBe('Visibility rose to 16.3.\n\nNext: refresh the visa page.');
  });

  it('drops a section it would leave empty, and its emptied sub-sections', () => {
    const text = [
      '## Summary',
      '- Visibility rose from 3.5 to 16.3.',
      '',
      '## Prices',
      '- Visa fee: [visa fee]',
      '',
      '### Ferries',
      '- From [price]',
      '',
      '## Next week',
      '- Refresh the Chios page.',
    ].join('\n');
    expect(withoutPlaceholderLines(text)).toBe(
      [
        '## Summary',
        '- Visibility rose from 3.5 to 16.3.',
        '',
        '## Next week',
        '- Refresh the Chios page.',
      ].join('\n'),
    );
  });

  it('keeps a section with lines left, and one that had nothing cut', () => {
    const text = '## Numbers\n- Mentions: 42\n- Citations: [real metric]\n\n## Notes\n';
    expect(withoutPlaceholderLines(text)).toBe('## Numbers\n- Mentions: 42\n\n## Notes');
  });

  it('returns the text as it is when nothing is cut', () => {
    const text = 'See [the guide](https://example.com).\n\n\n[1] cited.\n';
    expect(withoutPlaceholderLines(text)).toBe(text);
  });
});

describe('factsOf', () => {
  it('names the facts, each once', () => {
    expect(factsOf(['[refund period]', '[price]', '[price]', '[…]'])).toEqual([
      'refund period',
      'price',
    ]);
  });
});

describe('withoutPlaceholderLines with a note', () => {
  const note = (facts: string[]) => `Left out: needs ${facts.join(', ')}.`;

  it('never leaves an answer empty: the note names the missing facts', () => {
    expect(withoutPlaceholderLines('Refunds within [refund period] […].', '', note)).toBe(
      'Left out: needs refund period.',
    );
  });

  it('keeps a section the person asked for, with the note in its place', () => {
    const text =
      '## Summary\n- Up 4 points.\n\n## Prices\n- Visa fee: [visa fee]\n\n## Notes\n- [TBD]';
    expect(withoutPlaceholderLines(text, 'Add a Prices section', note)).toBe(
      '## Summary\n- Up 4 points.\n\n## Prices\nLeft out: needs visa fee.',
    );
  });
});

describe('missingFactsIssue', () => {
  it('names the missing facts and asks for them', () => {
    const issue = missingFactsIssue(['Visa guide', '<p>Fee: [visa fee], ferry [price].</p>']);
    expect(issue).toContain('[visa fee], [price]');
    expect(issue).toContain('Ask the person');
  });

  it('is null for a page with no placeholders', () => {
    expect(
      missingFactsIssue(['Visa guide', undefined, '<p>See [the guide](/visa).</p>']),
    ).toBeNull();
  });
});
