import { describe, expect, it } from 'vitest';
import { demandTiers, engineNames, firstNameOf } from './first-day';

describe("a brand's first day", () => {
  it("tiers each prompt's demand against the brand's own, leaving those without a volume out", () => {
    const tiers = demandTiers(
      new Map([
        ['a', 900],
        ['b', 10],
        ['c', 300],
        ['d', 0],
        ['e', 120],
        ['f', 50],
        ['g', 600],
      ]),
    );
    expect(Object.fromEntries(tiers)).toEqual({
      a: 'high',
      g: 'high',
      c: 'medium',
      e: 'medium',
      f: 'low',
      b: 'low',
    });
  });

  it('names the engines the prompts track that the plan allows, in the app’s order', () => {
    expect(engineNames(['gemini-web', 'chatgpt-web', 'chatgpt-shopping'], null)).toEqual([
      'ChatGPT',
      'Google Gemini',
    ]);
    expect(engineNames(['gemini-web', 'grok-web'], ['chatgpt-web', 'gemini-web'])).toEqual([
      'Google Gemini',
    ]);
  });

  it('greets a person by the first word of their name', () => {
    expect(firstNameOf('  Alex  Morgan ')).toBe('Alex');
    expect(firstNameOf('')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
