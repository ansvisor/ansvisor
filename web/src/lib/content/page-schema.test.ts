import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import {
  articleJsonLd,
  firstImage,
  isArticlePage,
  jsonLdScript,
  localDate,
  titleHasPlaceholder,
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
