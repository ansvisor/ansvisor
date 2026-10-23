import type { ContentAuthor } from './authors';
import type { PageType } from './drafts';

/**
 * The page's JSON-LD for Before you publish (Content Editor Quality spec §7,
 * CE-041): an Article from its title, author, brand and dates, for the
 * person to paste when their CMS doesn't write one. A person byline brings
 * their Person schema (sameAs from their profile links); the organization
 * byline, the brand's Organization. Nothing in it is made up: what isn't
 * known is left out.
 */

/**
 * The page types an Article describes. Others (a product, a pricing or a
 * category page…) take their own schema, a page-type item for later (§11).
 * A page with no type yet reads as one.
 */
export const ARTICLE_PAGE_TYPES: readonly PageType[] = [
  'blog_post',
  'guide',
  'comparison',
  'buying_guide',
  'best_of',
  'definition',
  'alternatives',
  'itinerary',
];

export const isArticlePage = (type: string | null) =>
  type === null || (ARTICLE_PAGE_TYPES as readonly string[]).includes(type);

/**
 * Words in square brackets where a real name, quote or number goes ("[figure,
 * source]"): a placeholder the Content Agent left for the person to fill, as
 * the editor's placeholder to-do reads it (CE-044). Not a footnote ("[1]"),
 * a checkbox ("[x]"), "[sic]" or a Markdown link's text.
 */
const PLACEHOLDER = /\[(?!sic\])(?=[^[\]\n]*\p{L})[^[\]\n]{2,}\](?!\()/iu;

/** Whether the title still has a placeholder: it would ship as the headline. */
export const titleHasPlaceholder = (title: string) => PLACEHOLDER.test(title);

/** The page's first image with a full https address, as JSON-LD's image. */
export function firstImage(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const img of doc.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src') ?? '';
    if (/^https:\/\/[^\s"'<>]+$/i.test(src)) return src;
  }
  return null;
}

export interface ArticleSchemaInput {
  title: string;
  /** The page's author; undefined while the authors aren't read (it is left out). */
  author: ContentAuthor | null | undefined;
  /** The author's page on the brand's site (Site trust), if one was found. */
  authorUrl: string | null;
  brandName: string;
  /** The brand's home page as Site trust read it, if it did. */
  brandUrl: string | null;
  /** The page's own image (firstImage), if it has one. */
  image: string | null;
  /**
   * A new page is published with this version; a page already live keeps
   * the published date it has, so only the updated date is given.
   */
  isNew: boolean;
  /** The local date, YYYY-MM-DD (localDate). */
  today: string;
}

/** A date as JSON-LD gives it here: YYYY-MM-DD, in the person's time zone. */
export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function articleJsonLd({
  title,
  author,
  authorUrl,
  brandName,
  brandUrl,
  image,
  isNew,
  today,
}: ArticleSchemaInput): Record<string, unknown> {
  const organization = {
    '@type': 'Organization',
    name: brandName,
    ...(brandUrl ? { url: brandUrl } : {}),
  };
  const person = author && {
    '@type': 'Person',
    name: author.name,
    ...(author.title ? { jobTitle: author.title } : {}),
    ...(authorUrl ? { url: authorUrl } : {}),
    ...(author.photoUrl ? { image: author.photoUrl } : {}),
    ...(author.sameAs.length ? { sameAs: author.sameAs } : {}),
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    // A placeholder isn't the page's headline: it is left out until filled.
    ...(title.trim() && !titleHasPlaceholder(title) ? { headline: title.trim() } : {}),
    ...(image ? { image } : {}),
    ...(author !== undefined ? { author: person ?? organization } : {}),
    publisher: organization,
    ...(isNew ? { datePublished: today } : {}),
    dateModified: today,
  };
}

/**
 * The JSON-LD as a script tag to paste into the page. A "<" in it is
 * escaped, so a title can't close the tag.
 */
export function jsonLdScript(data: Record<string, unknown>): string {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}
