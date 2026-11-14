import { describe, expect, it } from 'vitest';
import { factsForPage, namesScope, pageNames, sameScope, scopeText } from './fact-scope.js';

/**
 * Brand facts per destination, operator or route (00539): a page gets the
 * brand-wide facts and those whose scope its title, H1, first heading or
 * address names, without regard to case, accents or Turkish letters.
 */
describe('fact scopes', () => {
  it('names a place without regard to case or accents, Turkish letters too, as whole words', () => {
    expect(namesScope('İSTANBUL ışık turu', 'Istanbul Işık')).toBe(true);
    expect(namesScope('/tr/gokceada-feribot', 'GÖKÇEADA')).toBe(true);
    expect(namesScope('Geçitkale - Gökçeada', 'Geçitkale → Gökçeada')).toBe(true);
    expect(namesScope('Bozcaadalı rehber', 'Bozcaada')).toBe(false);
    expect(namesScope('Gökçeada → Geçitkale', 'Geçitkale → Gökçeada')).toBe(false);
  });

  it('keeps a scope with a word in it, as the brand already writes it', () => {
    expect(scopeText('  Bozcaada \n ')).toBe('Bozcaada');
    expect(['→', 'x'.repeat(101), null].map(scopeText)).toEqual([null, null, null]);
    expect(sameScope(['Bozcaada', null], 'BOZCAADA')).toBe('Bozcaada');
    expect(sameScope(['Bozcaada'], 'Gökçeada')).toBe('Gökçeada');
  });

  it('gives a page the brand-wide facts and the ones its title, H1, heading or address names', () => {
    const facts = [
      { quote: '14-day trial', scope: null },
      { quote: '₺150', scope: 'Bozcaada' },
      { quote: '₺200', scope: 'Gökçeada' },
      { quote: '45 dakika', scope: 'Geyikli → Bozcaada' },
    ];
    const quotes = (page) => factsForPage(facts, pageNames(page)).map((f) => f.quote);
    expect(quotes({ html: '<h1>BOZCAADA feribotu</h1>' })).toEqual(['14-day trial', '₺150']);
    expect(quotes({ html: '<h2>Geyikli - Bozcaada</h2>' })).toEqual([
      '14-day trial',
      '₺150',
      '45 dakika',
    ]);
    expect(quotes({ urls: ['gokceada-turu', null] })).toEqual(['14-day trial', '₺200']);
    expect(quotes({ title: 'Ferry prices', html: '<p>Bozcaada</p>' })).toEqual(['14-day trial']);
  });
});
