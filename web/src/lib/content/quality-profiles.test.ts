import { describe, expect, it } from 'vitest';
import { PAGE_TYPES } from './drafts';
import { EEAT_WEIGHTS, TRUST_WEIGHTS, eeat } from './quality-checks';
import {
  PROFILE_WEIGHTS,
  QUALITY_PROFILES,
  checksOff,
  profileFor,
  weighed,
} from './quality-profiles';
import { READABILITY_WEIGHTS } from './readability';

/**
 * Page types (Quality spec §11, CE-052): what the three scores count, and
 * how much, follows the page's type from Phase 3 on.
 */

describe('profileFor', () => {
  it('reads each page type as its profile in Phase 3, an article for the rest', () => {
    expect(profileFor('product_page', 3)).toBe('product');
    expect(profileFor('category_page', 3)).toBe('category');
    expect(profileFor('collection_page', 3)).toBe('category');
    expect(profileFor('feature_page', 3)).toBe('feature');
    expect(profileFor('pricing', 3)).toBe('feature');
    expect(profileFor('comparison', 3)).toBe('comparison');
    expect(profileFor('best_of', 3)).toBe('comparison');
    expect(profileFor('blog_post', 3)).toBe('article');
    expect(profileFor('destination_page', 3)).toBe('article');
    expect(profileFor(null, 3)).toBe('article');
    for (const type of PAGE_TYPES) expect(QUALITY_PROFILES).toContain(profileFor(type, 3));
  });

  it('keeps every page an article before Phase 3', () => {
    expect(profileFor('product_page', 2)).toBe('article');
    expect(profileFor('comparison', 0)).toBe('article');
  });
});

describe('PROFILE_WEIGHTS', () => {
  it('gives each score 100 points in every profile, the article the blog defaults', () => {
    const sum = (weights: Record<string, number>) =>
      Object.values(weights).reduce((a, b) => a + b, 0);
    for (const profile of QUALITY_PROFILES) {
      const w = PROFILE_WEIGHTS[profile];
      expect([sum(w.eeat), sum(w.trust), sum(w.readability)]).toEqual([100, 100, 100]);
    }
    expect(PROFILE_WEIGHTS.article.eeat).toEqual(EEAT_WEIGHTS);
    expect(PROFILE_WEIGHTS.article.trust).toEqual(TRUST_WEIGHTS);
    expect(PROFILE_WEIGHTS.article.readability).toEqual(READABILITY_WEIGHTS);
  });

  it('asks a product page for no author, and a comparison for balance and a disclosure', () => {
    expect(checksOff('product')).toContain('byline');
    expect(checksOff('product')).toContain('authorBio');
    expect(checksOff('article').size).toBe(0);
    expect(PROFILE_WEIGHTS.comparison.trust.balanced).toBeGreaterThan(
      PROFILE_WEIGHTS.article.trust.balanced,
    );
    expect(checksOff('comparison')).not.toContain('disclosure');
  });
});

describe('weighed', () => {
  const author = {
    id: 'a1',
    name: 'Ada',
    title: null,
    bio: 'Writes.',
    photoUrl: null,
    sameAs: [],
    userId: null,
    createdBy: null,
    defaultFor: [],
    pages: null,
  };

  it('keeps each check’s share of its points, out of the profile’s weight', () => {
    // Byline 15/15, bio 5/10 (no links): 80 as an article.
    const read = eeat({ author, used: { experience: false, data: true } });
    expect(weighed(read, PROFILE_WEIGHTS.article.eeat).score).toBe(read.score);
    // A product page: no author checks; data 20 of experience 20 + data 20.
    const product = weighed(read, PROFILE_WEIGHTS.product.eeat);
    expect(product.checks.map((c) => c.id)).toEqual(['experience', 'originalData']);
    expect(product.score).toBe(50);
  });

  it('leaves a score not given as it was, and none with every check off', () => {
    expect(weighed({ score: null, checks: [] }, PROFILE_WEIGHTS.product.eeat).score).toBeNull();
    const authorOnly = eeat({ author });
    expect(weighed(authorOnly, PROFILE_WEIGHTS.product.eeat)).toEqual({ score: null, checks: [] });
  });
});
