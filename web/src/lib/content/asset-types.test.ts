import { describe, expect, it } from 'vitest';
import { assetKind, opportunityPageType } from './asset-types';
import { SITE_PAGE_TYPES, SITE_TYPES } from './page-types';

describe('assetKind', () => {
  it('reads the older types as page types of each kind of site', () => {
    const older = [
      'blog_post',
      'pillar_guide',
      'landing_page',
      'comparison_page',
      'glossary_page',
      'faq_page',
      'product_page',
      'category_page',
    ];
    const read = Object.fromEntries(
      older.map((type) => [type, SITE_TYPES.map((site) => assetKind(type, site))]),
    );
    expect(read).toEqual({
      blog_post: ['blog_post', 'blog_post', 'blog_post', 'blog_post'],
      pillar_guide: ['guide', 'buying_guide', 'guide', 'guide'],
      landing_page: ['solution_page', 'collection_page', 'destination_page', 'feature_page'],
      comparison_page: ['comparison', 'comparison', 'comparison', 'comparison'],
      glossary_page: ['definition', 'definition', 'definition', 'definition'],
      faq_page: ['docs_faq', 'help_faq', 'help_faq', 'help_faq'],
      product_page: ['feature_page', 'product_page', 'guide', 'feature_page'],
      category_page: ['solution_page', 'category_page', 'guide', 'guide'],
    });
    // Each one a type that site writes.
    for (const type of older) {
      for (const site of SITE_TYPES) {
        expect(SITE_PAGE_TYPES[site]).toContain(assetKind(type, site));
      }
    }
  });

  it('keeps page types and earned assets, and knows nothing else', () => {
    expect(assetKind('feature_page', 'b2b')).toBe('feature_page');
    expect(assetKind('alternatives', 'ecommerce')).toBe('alternatives');
    expect(assetKind('backlink', 'b2c')).toBe('backlink');
    expect(assetKind('third_party_article', 'b2b')).toBe('third_party_article');
    expect(assetKind('podcast', 'b2b')).toBeNull();
    expect(assetKind('constructor', 'b2b')).toBeNull();
    expect(assetKind(null, 'b2b')).toBeNull();
    expect(assetKind(undefined, 'b2b')).toBeNull();
  });
});

describe('opportunityPageType', () => {
  it("is the opportunity's type when the site writes it", () => {
    expect(opportunityPageType('comparison', 'b2b')).toBe('comparison');
    expect(opportunityPageType('faq_page', 'ecommerce')).toBe('help_faq');
    expect(opportunityPageType('product_page', 'b2b')).toBe('feature_page');
  });

  it('is the closest type the site writes for one it doesn’t (Content test 2026-11-19)', () => {
    // The "Buying guide" directory opportunity on a software site opened as a blog post.
    expect(opportunityPageType('buying_guide', 'b2b')).toBe('best_of');
    expect(opportunityPageType('buying_guide', 'ecommerce')).toBe('buying_guide');
    expect(opportunityPageType('docs_faq', 'app')).toBe('help_faq');
    expect(opportunityPageType('help_faq', 'b2b')).toBe('docs_faq');
    // A shop's own type has none close: the title tells instead.
    expect(opportunityPageType('sizing_guide', 'b2b')).toBeNull();
  });

  it('is null for earned work, a type the site no longer writes, or none', () => {
    expect(opportunityPageType('backlink', 'b2b')).toBeNull();
    // The older default: the page or its title tells more.
    expect(opportunityPageType('blog_post', 'b2b')).toBeNull();
    expect(opportunityPageType('pricing', 'ecommerce')).toBeNull();
    expect(opportunityPageType(null, 'b2c')).toBeNull();
  });
});
