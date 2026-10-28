import { describe, expect, it } from 'vitest';
import { answersFrom, countryName, isCountryCode, missingEngines } from './tracking-countries';

/** The countries the tracking engines answer from (PROMPT-015e). */

describe('isCountryCode and countryName', () => {
  it('knows any country by its code, and no group', () => {
    expect(isCountryCode('BO')).toBe(true);
    expect(countryName('BO')).toBe('Bolivia');
    expect(isCountryCode('XK')).toBe(true);
    for (const group of ['EU', 'UN', 'ZZ', 'EZ', 'QO']) expect(isCountryCode(group)).toBe(false);
    expect(isCountryCode('bo')).toBe(false);
    expect(isCountryCode('B1')).toBe(false);
  });
});

describe('missingEngines', () => {
  it('names the engines a country is not answered by', () => {
    const all = [
      { code: 'US', models: ['chatgpt', 'copilot', 'aimode'] },
      { code: 'KE', models: ['chatgpt', 'aimode'] },
    ];
    expect(missingEngines(all[1], all)).toEqual(['copilot']);
    expect(missingEngines(all[0], all)).toEqual([]);
  });
});

describe('answersFrom', () => {
  const countries = [
    { code: 'TR', models: ['chatgpt', 'copilot', 'aimode'] },
    { code: 'KE', models: ['chatgpt', 'aimode'] },
  ];

  it("says whether any of the prompt's engines answers from the country", () => {
    expect(answersFrom({ platforms: ['copilot-web'] }, 'KE', false, countries)).toBe(false);
    expect(answersFrom({ platforms: ['copilot-web', 'chatgpt-web'] }, 'KE', false, countries)).toBe(
      true,
    );
    // A country no engine lists.
    expect(answersFrom({ platforms: ['chatgpt-web'] }, 'BO', false, countries)).toBe(false);
  });

  it("asks a city only of Google's engines, and lets the API models answer anywhere", () => {
    expect(answersFrom({ platforms: ['chatgpt-web'] }, 'TR', true, countries)).toBe(false);
    expect(answersFrom({ platforms: ['google-aimode'] }, 'TR', true, countries)).toBe(true);
    expect(answersFrom({ platforms: [], models: ['gpt-5'] }, 'BO', true, countries)).toBe(true);
  });

  it('restricts nothing without the lists, or for an engine the provider does not list', () => {
    expect(answersFrom({ platforms: ['copilot-web'] }, 'KE', false, [])).toBe(true);
    expect(answersFrom({ platforms: ['grok-web'] }, 'KE', false, countries)).toBe(true);
  });
});
