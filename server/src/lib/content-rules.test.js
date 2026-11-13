import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
const {
  NO_RULES,
  bannedPhrasesIn,
  bannedPhrasesOf,
  preferredDomains,
  sourceAllowed,
  sourceRulesOf,
} = await import('./content-rules.js');

describe('content rules for sources', () => {
  it('reads an unset or odd value as no rules', () => {
    expect(sourceRulesOf(null)).toEqual(NO_RULES);
    expect(sourceRulesOf({ blockedDomains: 'x', onlyAllowedDomains: 'yes' })).toEqual(NO_RULES);
  });

  it('never allows a blocked domain, subdomains included', () => {
    const ok = sourceAllowed(sourceRulesOf({ blockedDomains: ['https://www.Bad.example/'] }));
    expect(ok('https://blog.bad.example/post')).toBe(false);
    expect(ok('https://good.example/post')).toBe(true);
  });

  it('with only-allowed on, allows the allowed domains and the brand’s own', () => {
    const rules = sourceRulesOf({ allowedDomains: ['gov.example'], onlyAllowedDomains: true });
    const ok = sourceAllowed(rules, ['acme.example']);
    expect(ok('https://visit.gov.example/x')).toBe(true);
    expect(ok('https://www.acme.example/')).toBe(true);
    expect(ok('https://other.example/')).toBe(false);
  });

  it('prefers the allowed domains only while only-allowed is off', () => {
    expect(preferredDomains(sourceRulesOf({ allowedDomains: ['a.example'] }))).toEqual([
      'a.example',
    ]);
    expect(
      preferredDomains(sourceRulesOf({ allowedDomains: ['a.example'], onlyAllowedDomains: true })),
    ).toEqual([]);
  });
});

describe('banned phrases', () => {
  it('reads the stored list, trimmed; anything odd is none', () => {
    expect(bannedPhrasesOf({ bannedPhrases: [' cheapest ', '', 3, 'best price'] })).toEqual([
      'cheapest',
      'best price',
    ]);
    expect(bannedPhrasesOf(null)).toEqual([]);
    expect(bannedPhrasesOf({ bannedPhrases: 'x' })).toEqual([]);
  });
});

describe('bannedPhrasesIn', () => {
  it('matches a word or a phrase in any case, once each', () => {
    expect(
      bannedPhrasesIn(
        ['The CHEAPEST fares. Cheapest!', '<p>Best  <b>price</b> yet</p>'],
        ['cheapest', 'best price', 'guaranteed'],
      ),
    ).toEqual(['cheapest', 'best price']);
  });

  it('ignores a phrase inside another word', () => {
    expect(
      bannedPhrasesIn(['A cheaper, uncheapest-ish deal; guaranteeds'], ['cheap', 'guaranteed']),
    ).toEqual([]);
    expect(bannedPhrasesIn(['Only cheap-ish'], ['cheap'])).toEqual(['cheap']);
  });

  it('treats regex characters in a phrase as text', () => {
    expect(bannedPhrasesIn(['Book now (limited)!'], ['now (limited)', '.*'])).toEqual([
      'now (limited)',
    ]);
  });

  it('finds nothing without phrases or text', () => {
    expect(bannedPhrasesIn([undefined, ''], ['x'])).toEqual([]);
    expect(bannedPhrasesIn(['x'], [])).toEqual([]);
  });
});
