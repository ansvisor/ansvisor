import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
const { NO_RULES, bannedPhrasesOf, preferredDomains, sourceAllowed, sourceRulesOf } =
  await import('./content-rules.js');

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
