import { describe, expect, it } from 'vitest';
import { calibrate, parseRows, ranks, spearman, suggestWeights } from './quality-calibration.js';

/** Quality's weights against AI citations (Quality spec §11, CE-055). */

describe('ranks and spearman', () => {
  it('ranks ties by their average, and correlates by rank', () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 400])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    // Too few pairs, or a list of one value: nothing to say.
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2, 3], [1, 2])).toBeNull();
  });
});

describe('parseRows', () => {
  it('keeps the rows as their profile, checks and citations, and counts the lines that aren’t rows', () => {
    const text = [
      JSON.stringify({
        url: 'https://acme.com/blog/x',
        brand: 'Acme',
        profile: 'article',
        checks: { trust: { claimsSourced: 0.5 } },
        citations: 3,
      }),
      '',
      'not json',
      JSON.stringify({ profile: 'blog', checks: {}, citations: 1 }),
      JSON.stringify({ profile: 'article', checks: { eeat: { byline: 2 } }, citations: 1 }),
    ].join('\n');
    const { rows, invalid } = parseRows(text);
    // Nothing of the page but what's counted is kept.
    expect(rows).toEqual([
      { profile: 'article', checks: { trust: { claimsSourced: 0.5 } }, citations: 3 },
    ]);
    expect(invalid).toBe(3);
  });
});

describe('calibrate', () => {
  // Pages whose sourced claims go with their citations, and whose links don't.
  const pages = Array.from({ length: 40 }, (_, i) => ({
    profile: 'article',
    checks: {
      trust: { claimsSourced: i / 39, noBrokenLinks: (i % 2) * 1, expertQuote: 1 },
      eeat: { byline: i < 20 ? 0 : 1 },
    },
    citations: i,
  }));

  it('gives each profile’s pages and each check’s correlation, from enough pages only', () => {
    const report = calibrate([...pages, { profile: 'product', checks: {}, citations: 2 }]);
    expect(report.pages).toBe(41);
    expect(report.profiles.article.pages).toBe(40);
    const trust = report.profiles.article.scores.trust.checks;
    expect(trust.claimsSourced).toEqual({ pages: 40, rho: 1 });
    expect(trust.noBrokenLinks.rho).toBeLessThan(0.2);
    // One value on every page: no correlation.
    expect(trust.expertQuote.rho).toBeNull();
    expect(report.profiles.article.scores.eeat.checks.byline.rho).toBeGreaterThan(0.8);
    expect(report.profiles.product.pages).toBe(1);
    // Fewer pages than the minimum: none read.
    expect(
      calibrate(pages, { minPages: 50 }).profiles.article.scores.trust.checks.claimsSourced,
    ).toEqual({ pages: 40, rho: null });
    // No page or brand in what it gives back.
    expect(JSON.stringify(report)).not.toMatch(/acme|https?:/i);
  });

  it('suggests weights from the weights in use, the score’s total kept', () => {
    const weights = {
      article: {
        trust: { claimsSourced: 30, noBrokenLinks: 10, expertQuote: 8, brandFacts: 12 },
      },
    };
    const suggested = calibrate(pages, { weights }).profiles.article.scores.trust.suggested;
    // Read checks share their 48 points by correlation; brand facts, not read, keep theirs.
    expect(suggested.brandFacts).toBe(12);
    expect(suggested.claimsSourced).toBeGreaterThan(30);
    expect(Object.values(suggested).reduce((a, b) => a + b, 0)).toBe(60);
    // No weights given: no suggestion.
    expect(calibrate(pages).profiles.article.scores.trust).not.toHaveProperty('suggested');
  });
});

describe('suggestWeights', () => {
  it('shares the read checks’ points by positive correlation, and keeps them with none', () => {
    expect(
      suggestWeights(
        { a: 20, b: 20, c: 10 },
        { a: { pages: 40, rho: 0.6 }, b: { pages: 40, rho: 0.2 }, c: { pages: 5, rho: null } },
      ),
    ).toEqual({ a: 30, b: 10, c: 10 });
    // A check that goes with fewer citations gets none of them.
    expect(
      suggestWeights({ a: 20, b: 20 }, { a: { pages: 40, rho: 0.5 }, b: { pages: 40, rho: -0.3 } }),
    ).toEqual({ a: 40, b: 0 });
    // No positive correlation: as they are.
    expect(
      suggestWeights({ a: 20, b: 20 }, { a: { pages: 40, rho: -0.1 }, b: { pages: 40, rho: 0 } }),
    ).toEqual({ a: 20, b: 20 });
    // A check weighed 0 stays out.
    expect(
      suggestWeights({ a: 0, b: 30 }, { a: { pages: 40, rho: 0.9 }, b: { pages: 40, rho: 0.1 } }),
    ).toEqual({
      a: 0,
      b: 30,
    });
  });
});
