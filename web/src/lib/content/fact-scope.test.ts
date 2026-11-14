import { describe, expect, it } from 'vitest';
import { factMismatches, type BrandFact } from './brand-facts';
import { namesScope, pageNames } from './fact-scope';
import { pageFactsOf } from './quality-inputs';

/**
 * Brand facts per destination, operator or route (00539): a page is checked
 * against the brand-wide facts and those whose scope its title, H1, first
 * heading or address names; another place's fact is never a conflict.
 */

const price = (amount: number, scope: string | null): BrandFact => ({
  id: `f-${amount}`,
  kind: 'price',
  value: { plan: 'Yetişkin', amount, currency: 'TRY', period: null, billed: null, per: null },
  quote: `Yetişkin ₺${amount}`,
  sourceUrl: 'https://adalar.example/fiyatlar',
  sourceKind: 'pricing',
  scope,
  status: 'approved',
  reviewedAt: null,
  firstSeenAt: '2026-11-01T00:00:00Z',
  gone: false,
  replaces: null,
});

describe('fact scopes', () => {
  it('reads a page’s names, matched without regard to case, accents or Turkish letters', () => {
    expect(
      pageNames({
        html: '<p>x</p><h2 class="a">Bozcaada &amp; <b>Assos</b></h2><h1>Turlar</h1>',
        title: 'Ferry',
        urls: ['gokceada-turu', null, 'https://adalar.example/tr/%C4%B1s%C4%B1k'],
      }),
    ).toEqual(['Ferry', 'Turlar', 'Bozcaada &  Assos ', '/gokceada-turu', '/tr/ısık']);
    expect(namesScope('GÖKÇEADA FERİBOTU', 'Gökçeada')).toBe(true);
    expect(namesScope('/tr/gokceada-turu', 'Gökçeada')).toBe(true);
    expect(namesScope('Bozcaadalı rehber', 'Bozcaada')).toBe(false);
  });

  it('checks a page against the brand’s facts and its own place’s, never another’s', () => {
    const facts = [price(150, 'Bozcaada'), price(200, 'Gökçeada'), price(90, null)];
    const html = '<h1>GÖKÇEADA feribotu</h1><p>Yetişkin: ₺175.</p>';
    expect(pageFactsOf({ html, brandFacts: facts })?.map((f) => f.scope)).toEqual([
      'Gökçeada',
      null,
    ]);
    const check = (over: Parameters<typeof pageFactsOf>[0]) =>
      factMismatches({
        sentences: ['Yetişkin: ₺175.'],
        facts: pageFactsOf(over) ?? [],
        brandName: 'Adalar',
        competitorDomains: [],
      });
    const bozcaada = { html: '<h1>Feribot</h1>', brandFacts: [price(150, 'Bozcaada')] };
    // Bozcaada's price on a page about Gökçeada (its address): nothing compared.
    expect(check({ ...bozcaada, pageUrls: ['gokceada'] })).toEqual({ compared: 0, mismatches: [] });
    // On Bozcaada's own page, it is.
    expect(check({ ...bozcaada, pageTitle: 'Bozcaada' }).mismatches).toHaveLength(1);
  });
});
