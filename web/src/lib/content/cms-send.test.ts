import { describe, expect, it } from 'vitest';
import type { DraftPage } from '@/lib/actions/content-drafts';
import type { AuthorsRead, ContentAuthor } from './authors';
import {
  cmsFields,
  cmsFieldsProblem,
  cmsPage,
  cmsPageProblem,
  cmsSource,
  type CmsFields,
} from './cms-send';
import type { PageFields } from './ready-to-publish';

/**
 * Send to CMS (#1331): the fields a send starts with, when they can't go,
 * and the page as the server takes it.
 */

const page: PageFields = {
  metaTitle: 'Pour-over coffee',
  metaDescription: 'Brew it slowly.',
  slug: 'pour-over-coffee',
  author: 'Ada Lovelace',
  featuredImage: null,
};
const fields: CmsFields = {
  slug: 'pour-over-coffee',
  metaTitle: 'Pour-over coffee',
  metaDescription: 'Brew it slowly.',
};

describe('cmsFields', () => {
  it('cuts the page’s meta title at a word near 60 characters, not a kept one', () => {
    const cut = (metaTitle: string) => cmsFields({ ...page, metaTitle }, null).metaTitle;
    const long = `${'Pour-over coffee at home: '.repeat(4)}a guide`;
    // At the last space that fits, without the colon the cut leaves.
    expect(cut(long)).toBe('Pour-over coffee at home: Pour-over coffee at home');
    expect(cmsFields({ ...page, metaTitle: long }, { metaTitle: long }).metaTitle).toBe(long);
    // Exactly 60 stays whole.
    expect(cut('a'.repeat(60))).toBe('a'.repeat(60));
    // A no-break space is a space too.
    expect(cut(`${'b'.repeat(40)}\u00a0${'c'.repeat(30)}`)).toBe('b'.repeat(40));
    // No space past half: cut at 60 characters, never inside an emoji.
    const emoji = `${'d'.repeat(59)}☕️☕️`;
    expect(Array.from(cut(emoji))).toHaveLength(60);
    expect(cut(`${'e'.repeat(59)}😀x`)).toBe(`${'e'.repeat(59)}😀`);
  });

  it('starts from what the draft kept, else from the page', () => {
    expect(cmsFields(page, null)).toEqual(fields);
    expect(cmsFields(page, { slug: 'coffee', metaDescription: '' })).toEqual({
      ...fields,
      slug: 'coffee',
    });
  });
});

describe('cmsFieldsProblem', () => {
  it('takes letters of any script, digits, dots, - and _ in a slug', () => {
    expect(cmsFieldsProblem(fields)).toBeNull();
    expect(cmsFieldsProblem({ ...fields, slug: 'çay-demleme_2.0' })).toBeNull();
    expect(cmsFieldsProblem({ ...fields, slug: ' coffee ' })).toBeNull();
  });

  it('names the field that cannot go', () => {
    expect(cmsFieldsProblem({ ...fields, slug: '' })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, slug: 'pour over' })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, slug: 'blog/coffee' })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, slug: '..' })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, slug: 'a'.repeat(201) })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, metaTitle: 'a'.repeat(301) })).toBe('metaTitle');
    expect(cmsFieldsProblem({ ...fields, metaDescription: 'a'.repeat(501) })).toBe(
      'metaDescription',
    );
  });
});

describe('cmsPageProblem', () => {
  it('needs a title the CMS takes, and something under the H1', () => {
    expect(cmsPageProblem('Pour-over', '<h1>Pour-over</h1><p>Brew it.</p>')).toBeNull();
    expect(
      cmsPageProblem('Pour-over', '<h1>Pour-over</h1><img src="https://cdn.example/a.jpg">'),
    ).toBeNull();
    expect(cmsPageProblem('  ', '<p>Brew it.</p>')).toBe('noTitle');
    expect(cmsPageProblem('a'.repeat(301), '<p>Brew it.</p>')).toBe('longTitle');
    // A new page: its H1 and an empty paragraph.
    expect(cmsPageProblem('Pour-over', '<h1>Pour-over</h1><p></p>')).toBe('empty');
    expect(cmsPageProblem('Pour-over', '')).toBe('empty');
  });
});

describe('cmsPage', () => {
  const html =
    '<h1>Pour-over</h1>\n<p>Brew it slowly.</p>\n<img src="https://cdn.example/cup.jpg" alt="A cup">';

  it('sends the page without its H1, its fields trimmed', () => {
    expect(
      cmsPage({
        draftId: 'd1',
        title: ' Pour-over ',
        html,
        fields: { slug: ' coffee ', metaTitle: ' Coffee ', metaDescription: ' Slowly. ' },
        page: { ...page, featuredImage: 'https://cdn.example/cup.jpg' },
        byline: null,
      }),
    ).toEqual({
      draftId: 'd1',
      title: 'Pour-over',
      slug: 'coffee',
      metaTitle: 'Coffee',
      metaDescription: 'Slowly.',
      html: '<p>Brew it slowly.</p>\n<img src="https://cdn.example/cup.jpg" alt="A cup">',
      author: 'Ada Lovelace',
      featuredImage: { src: 'https://cdn.example/cup.jpg', alt: 'A cup' },
    });
  });

  it('keeps the brand’s byline line, which went under the H1', () => {
    const sent = cmsPage({
      draftId: 'd1',
      title: 'Pour-over',
      html,
      fields,
      page,
      byline: 'By Ada',
    });
    expect(sent.html.startsWith('<p>By Ada</p>\n<p>Brew it slowly.</p>')).toBe(true);
  });

  it('sends no author while none is known, and only an https featured image', () => {
    const sent = cmsPage({
      draftId: 'd1',
      title: 'Pour-over',
      html: '<p>Brew it.</p><img src="http://cdn.example/cup.jpg">',
      fields,
      page: { ...page, author: '', featuredImage: 'http://cdn.example/cup.jpg' },
      byline: null,
    });
    expect(sent.author).toBeNull();
    expect(sent.featuredImage).toBeNull();
  });

  it('keeps the author, alt text and image within what the server takes', () => {
    const src = 'https://cdn.example/cup.jpg';
    const sent = cmsPage({
      draftId: 'd1',
      title: 'Pour-over',
      html: `<p>Brew it.</p><img src="${src}" alt="${'a'.repeat(600)}">`,
      fields,
      page: { ...page, author: 'b'.repeat(250), featuredImage: src },
      byline: null,
    });
    expect(sent.author).toBe('b'.repeat(200));
    expect(sent.featuredImage).toEqual({ src, alt: 'a'.repeat(500) });
    const long = `https://cdn.example/${'c'.repeat(2048)}.jpg`;
    expect(
      cmsPage({
        draftId: 'd1',
        title: 'Pour-over',
        html: `<p>Brew it.</p><img src="${long}">`,
        fields,
        page: { ...page, featuredImage: long },
        byline: null,
      }).featuredImage,
    ).toBeNull();
  });
});

describe('cmsSource', () => {
  const stored: DraftPage = {
    id: 'd1',
    title: 'Pour-over',
    bodyHtml: '<h1>Pour-over</h1><p>Brew it slowly.</p>',
    sourceUrl: 'https://acme.example/pour-over',
    authorId: 'a1',
    language: null,
  };
  const ada = { id: 'a1', name: 'Ada Lovelace' } as ContentAuthor;
  const authors = (bylineInContent: boolean): AuthorsRead => ({
    authors: [ada],
    brands: [{ id: 'b1', name: 'Acme', bylineInContent }],
    me: { id: 'u1', role: 'admin' },
  });
  const source = (over: Partial<Parameters<typeof cmsSource>[0]> = {}) =>
    cmsSource({
      page: stored,
      authors: authors(false),
      brandId: 'b1',
      brandName: 'Acme',
      brandLanguage: 'en',
      teamByline: 'Acme Team',
      ...over,
    });

  it('gives the stored page as the editor would: publishable, with its author', () => {
    expect(source()).toEqual({
      draftId: 'd1',
      title: 'Pour-over',
      html: expect.stringContaining('<p>Brew it slowly.</p>'),
      sourceUrl: 'https://acme.example/pour-over',
      author: ada,
      teamByline: 'Acme Team',
      byline: null,
    });
  });

  it('adds the byline line in the page’s language, else the brand’s', () => {
    expect(source({ authors: authors(true) }).byline).toBe('By Ada Lovelace');
    expect(source({ authors: authors(true), brandLanguage: 'tr' }).byline).toBe(
      'Yazar: Ada Lovelace',
    );
    expect(
      source({ authors: authors(true), page: { ...stored, language: 'German', authorId: null } })
        .byline,
    ).toBe('Vom Acme-Team');
  });

  it('gives no author or team byline while Quality is off', () => {
    expect(source({ authors: null })).toMatchObject({ author: null, teamByline: '', byline: null });
  });
});
