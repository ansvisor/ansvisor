import { describe, expect, it } from 'vitest';
import { HANDOFF_KEYS, handOffItems } from './hand-off';

/** Hand off (CE-051): what of Quality's suggestions the agent fixes in one run. */

const suggestion = (key: string, over: Partial<{ gain: number; show: string | null }> = {}) => ({
  key,
  gain: 5,
  line: `${key} line`,
  detail: `${key} detail`,
  show: null as string | null,
  ...over,
});

describe('handOffItems', () => {
  it('sends each fixable suggestion with a gain once, with its line, detail and passage', () => {
    expect(
      handOffItems([
        suggestion('readability:longSentences', { show: 'A very long sentence.' }),
        suggestion('trust:claimsSourced'),
        suggestion('readability:longSentences'),
        // Nothing to gain, or a key it doesn't fix (a to-do's): left out.
        suggestion('readability:avgSentence', { gain: 0 }),
        suggestion('eeat:experience'),
      ]),
    ).toEqual([
      {
        key: 'readability:longSentences',
        detail:
          'readability:longSentences line · readability:longSentences detail · Where: "A very long sentence."',
      },
      {
        key: 'trust:claimsSourced',
        detail: 'trust:claimsSourced line · trust:claimsSourced detail',
      },
    ]);
  });

  it('sends the disclosure only with its line in the page’s language, and keeps each detail short', () => {
    const disclosure = suggestion('trust:disclosure');
    expect(handOffItems([disclosure])).toEqual([]);
    expect(handOffItems([disclosure], { disclosureLine: 'Disclosure: offered by Acme.' })).toEqual([
      {
        key: 'trust:disclosure',
        detail:
          'trust:disclosure line · trust:disclosure detail · The line: "Disclosure: offered by Acme."',
      },
    ]);
    const long = suggestion('trust:claimsSourced', { show: 'x'.repeat(900) });
    expect(handOffItems([long])[0].detail).toHaveLength(500);
  });

  it('knows the 15 checks the API fixes', () => {
    expect(HANDOFF_KEYS.size).toBe(15);
  });
});
