import { describe, expect, it } from 'vitest';
import { countryName, isCountryCode, missingEngines } from './tracking-countries';

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
