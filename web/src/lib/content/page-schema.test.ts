import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import {
  articleJsonLd,
  firstImage,
  isArticlePage,
  jsonLdScript,
  localDate,
  pageName,
  titleHasPlaceholder,
  openingParagraph,
  pageOffer,
  productJsonLd,
} from './page-schema';

/** Before you publish's JSON-LD (Quality spec §7, CE-041): from the page's facts, nothing made up. */

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: 'Writes about forecasting.',
  photoUrl: 'https://cdn.acme.com/ada.jpg',
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};
const base = {
  title: 'How small teams forecast pipeline',
  author: ada,
  authorUrl: 'https://acme.com/authors/ada-lovelace',
  brandName: 'Acme',
  brandUrl: 'https://acme.com/',
  image: 'https://cdn.acme.com/pour-over.jpg',
  isNew: true,
  today: '2026-10-23',
};

describe('articleJsonLd', () => {
  it('gives an Article by the person, with their profile, published and updated today', () => {
    expect(articleJsonLd(base)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'How small teams forecast pipeline',
      image: 'https://cdn.acme.com/pour-over.jpg',
      author: {
        '@type': 'Person',
        name: 'Ada Lovelace',
        jobTitle: 'Head of Content',
        url: 'https://acme.com/authors/ada-lovelace',
        image: 'https://cdn.acme.com/ada.jpg',
        sameAs: ['https://www.linkedin.com/in/ada'],
      },
      publisher: { '@type': 'Organization', name: 'Acme', url: 'https://acme.com/' },
      datePublished: '2026-10-23',
      dateModified: '2026-10-23',
    });
  });

  it("gives the brand's Organization for the team byline, and leaves out what isn't known", () => {
    const result = articleJsonLd({
      ...base,
      author: null,
      brandUrl: null,
      image: null,
      title: '  ',
    });
    expect(result).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      author: { '@type': 'Organization', name: 'Acme' },
      publisher: { '@type': 'Organization', name: 'Acme' },
      datePublished: '2026-10-23',
      dateModified: '2026-10-23',
    });
    const bare = articleJsonLd({
      ...base,
      author: { ...ada, title: null, photoUrl: null, sameAs: [] },
      authorUrl: null,
    });
    expect(bare.author).toEqual({ '@type': 'Person', name: 'Ada Lovelace' });
  });

  it("leaves the author out while the authors aren't read", () => {
    expect(articleJsonLd({ ...base, author: undefined })).not.toHaveProperty('author');
  });

  it('leaves the headline out while the title has a placeholder', () => {
    const result = articleJsonLd({ ...base, title: 'Forecasting with [figure, source] accuracy' });
    expect(result).not.toHaveProperty('headline');
    expect(result.author).toMatchObject({ name: 'Ada Lovelace' });
    // A footnote, a checkbox or "[sic]" is no placeholder.
    expect(titleHasPlaceholder('Pipeline [1] and [x] [sic]')).toBe(false);
    expect(pageName(' Ridge 28 [1] ')).toBe('Ridge 28 [1]');
    expect(pageName('Ridge [model name]')).toBeNull();
    expect(pageName('  ')).toBeNull();
    expect(titleHasPlaceholder('Interview with [name of a real person]')).toBe(true);
    // The match keeps no state between titles.
    expect(titleHasPlaceholder('Interview with [name of a real person]')).toBe(true);
  });

  it('keeps the published date a live page has: only the updated date', () => {
    const result = articleJsonLd({ ...base, isNew: false });
    expect(result).not.toHaveProperty('datePublished');
    expect(result.dateModified).toBe('2026-10-23');
  });
});

describe('jsonLdScript', () => {
  it("wraps it to paste, so a title can't close the tag", () => {
    const script = jsonLdScript(articleJsonLd({ ...base, title: 'Tags </script> in titles' }));
    expect(script.startsWith('<script type="application/ld+json">\n{')).toBe(true);
    expect(script.endsWith('}\n</script>')).toBe(true);
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(script.slice(36, -10)).headline).toBe('Tags </script> in titles');
  });
});

describe('firstImage', () => {
  it("takes the page's first image with a full https address", () => {
    expect(
      firstImage(
        '<p><img src="/local.png"><img src="data:image/png;base64,AA"></p>' +
          '<img src="https://cdn.acme.com/a.jpg"><img src="https://cdn.acme.com/b.jpg">',
      ),
    ).toBe('https://cdn.acme.com/a.jpg');
    expect(firstImage('<p>No images.</p>')).toBeNull();
  });
});

describe('isArticlePage', () => {
  it('reads articles, and a page with no type yet, as one', () => {
    expect(isArticlePage('blog_post')).toBe(true);
    expect(isArticlePage(null)).toBe(true);
    expect(isArticlePage('product_page')).toBe(false);
    expect(isArticlePage('pricing')).toBe(false);
  });
});

describe('localDate', () => {
  it('gives the local day', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('pageOffer (Phase 3, CE-053)', () => {
  it('reads one price as the Offer, several or a range as low and high, in one currency', () => {
    expect(pageOffer(['The Ridge 28 costs $129.'])).toEqual({ price: 129, currency: 'USD' });
    expect(pageOffer(['Small: $119.', 'Large: $139.', 'Small: $119.'])).toEqual({
      low: 119,
      high: 139,
      currency: 'USD',
    });
    expect(pageOffer(['Sizes run $119–$139.'])).toEqual({ low: 119, high: 139, currency: 'USD' });
    expect(pageOffer(['From $119-139, by size.'])).toEqual({
      low: 119,
      high: 139,
      currency: 'USD',
    });
    expect(pageOffer(['Zwischen 119 und 139 €.'])).toEqual({
      low: 119,
      high: 139,
      currency: 'EUR',
    });
    // A tax-inclusive price is the price.
    expect(pageOffer(['129 € inkl. MwSt.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['Fiyatı 1.299 TL, KDV dahil.'])).toEqual({ price: 1299, currency: 'TRY' });
    // Words that name the product aren't another bill.
    expect(pageOffer(['Extra large: $139.'])).toEqual({ price: 139, currency: 'USD' });
    expect(pageOffer(['The over-ear Ridge headphones cost $199.'])).toEqual({
      price: 199,
      currency: 'USD',
    });
    expect(pageOffer(['A 2-person tent for $249.'])).toEqual({ price: 249, currency: 'USD' });
    expect(pageOffer(['Ridge 28 for $129.'])).toEqual({ price: 129, currency: 'USD' });
  });

  it('keeps the price beside an amount that isn’t it, in the same sentence', () => {
    const ridge = { price: 129, currency: 'USD' };
    // A sale: the price now, not the old one.
    expect(pageOffer(['Now $129, was $159.'])).toEqual(ridge);
    expect(pageOffer(['$129 (was $159).'])).toEqual(ridge);
    expect(pageOffer(['$129 instead of $159.'])).toEqual(ridge);
    expect(pageOffer(['Save $30: it’s $129 this week.'])).toEqual(ridge);
    // A threshold, shipping, financing, a unit price, a bundle, an add-on.
    expect(pageOffer(['It costs $129 and ships free on orders over $50.'])).toEqual(ridge);
    expect(pageOffer(['Free shipping on orders over $50.', 'It costs $129.'])).toEqual(ridge);
    expect(pageOffer(['$129 with free shipping.'])).toEqual(ridge);
    expect(pageOffer(['Shipping: $5.99.', 'Price: $129.'])).toEqual(ridge);
    expect(pageOffer(['$129, or 4 interest-free payments of $32.25 with Klarna.'])).toEqual(ridge);
    expect(pageOffer(['$129, or as low as $12/mo with Affirm.'])).toEqual(ridge);
    expect(pageOffer(['$129 ($0.50/oz).'])).toEqual(ridge);
    expect(pageOffer(['$129 each, or 2 for $239.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Add a rain cover for $19.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Rain cover ($19, sold separately).'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Get a $10 coupon.'])).toEqual(ridge);
    expect(pageOffer(['₺1.299 yerine ₺999.'])).toEqual({ price: 999, currency: 'TRY' });
    expect(pageOffer(['500 TL üzeri kargo bedava.', 'Fiyatı 999 TL.'])).toEqual({
      price: 999,
      currency: 'TRY',
    });
  });

  it('reads none where the page states no price, or whose is which isn’t sure', () => {
    expect(pageOffer(['A sturdy daypack for wet hikes.'])).toBeNull();
    expect(pageOffer(['$129 in the US, €119 in Europe.'])).toBeNull();
    expect(pageOffer(['Save $30 this week.'])).toBeNull();
    // A subscription's price is a plan's, not the product's.
    expect(pageOffer(['$12 a month.'])).toBeNull();
    expect(pageOffer(['$10–$20 a month.'])).toBeNull();
    // A model's number before its price isn't a range.
    expect(pageOffer(['Ridge 28 – $129.'])).toBeNull();
  });
});

describe('openingParagraph', () => {
  it('gives the first paragraph past a byline, cut at a word under 500 characters', () => {
    expect(
      openingParagraph('<h1>Ridge 28</h1><p>By Acme Team</p><p>A daypack for wet hikes.</p>'),
    ).toBe('A daypack for wet hikes.');
    const long = openingParagraph(`<p>${'word '.repeat(150)}end.</p>`)!;
    expect(long.length).toBeLessThanOrEqual(501);
    expect(long.endsWith('…')).toBe(true);
    expect(openingParagraph('<h1>Ridge 28</h1>')).toBeNull();
  });
});

describe('productJsonLd', () => {
  it('gives a Product with its Offer, or an AggregateOffer for a range, and only what the page states', () => {
    expect(
      productJsonLd({
        name: 'Ridge 28 daypack',
        description: 'A daypack for wet hikes.',
        images: ['https://cdn.acme.com/ridge.jpg'],
        brandName: 'Acme',
        offer: { price: 129, currency: 'USD' },
      }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Ridge 28 daypack',
      description: 'A daypack for wet hikes.',
      image: 'https://cdn.acme.com/ridge.jpg',
      brand: { '@type': 'Brand', name: 'Acme' },
      offers: { '@type': 'Offer', price: '129.00', priceCurrency: 'USD' },
    });
    const range = productJsonLd({
      name: 'Ridge 28',
      description: 'A daypack in [color] for wet hikes.',
      images: [],
      brandName: 'Acme',
      offer: { low: 119, high: 139, currency: 'EUR' },
    });
    // A placeholder in the description leaves it out; no availability or reviews are made up.
    expect(range).not.toHaveProperty('description');
    expect(range).not.toHaveProperty('image');
    expect(range.offers).toEqual({
      '@type': 'AggregateOffer',
      lowPrice: '119.00',
      highPrice: '139.00',
      priceCurrency: 'EUR',
    });
  });
});
