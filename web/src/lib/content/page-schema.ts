import type { ContentAuthor } from './authors';
import { notAPrice, pagePrices } from './brand-facts';
import type { PageType } from './drafts';
import { PLACEHOLDER } from './placeholders';
import { isByline, sentencesOf } from './readability';

/**
 * The page's JSON-LD for Before you publish (Content Editor Quality spec §7,
 * CE-041): an Article from its title, author, brand and dates, for the
 * person to paste when their CMS doesn't write one; a product page's
 * Product with its Offer in Phase 3 (CE-053). A person byline brings
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

/** One placeholder (placeholders.ts's, without its global flag: a test keeps no state). */
const ONE_PLACEHOLDER = new RegExp(PLACEHOLDER.source, 'iu');

/** Whether the title still has a placeholder: it would ship as the headline. */
export const titleHasPlaceholder = (title: string) => ONE_PLACEHOLDER.test(title);

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
 * A product page's price as the page states it (Quality spec §11, CE-053):
 * one price is the product's Offer; several (sizes, plans) its range. None
 * when the page states none, or in more than one currency (whose is which
 * isn't sure). Amounts that aren't the product's price are left out: an old
 * price, a saving, an add-on (brand facts' rules), a shipping threshold or a
 * minimum order ("free shipping over $50").
 */
export type PageOffer =
  | { price: number; currency: string }
  | { low: number; high: number; currency: string; count: number };

const THRESHOLD =
  /\b(?:shipping|delivery|orders?|over|above|spend|minimum|min\.|kargo|versand|livraison|env[ií]o)\b/iu;

export function pageOffer(texts: readonly string[]): PageOffer | null {
  const prices = texts
    .flatMap((text) => sentencesOf(text))
    .filter((sentence) => !notAPrice(sentence) && !THRESHOLD.test(sentence))
    .flatMap((sentence) => pagePrices(sentence))
    .filter((price) => price.amount > 0);
  if (!prices.length) return null;
  const currencies = new Set(prices.map((p) => p.currency));
  if (currencies.size > 1) return null;
  const [currency] = currencies;
  const amounts = [...new Set(prices.map((p) => p.amount))].sort((a, b) => a - b);
  return amounts.length === 1
    ? { price: amounts[0], currency }
    : { low: amounts[0], high: amounts[amounts.length - 1], currency, count: amounts.length };
}

/** The page's opening paragraph (past a byline or a date), as Product's description: up to 500 characters. */
export function openingParagraph(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const p of doc.body.querySelectorAll('p')) {
    const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text || isByline(text)) continue;
    if (text.length <= 500) return text;
    const cut = text.slice(0, 500);
    return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : 500)}…`;
  }
  return null;
}

export interface ProductSchemaInput {
  /** The page's title (its H1): the product's name. */
  name: string;
  description: string | null;
  /** The person's own images on the page first (CE-049), else its first image. */
  images: string[];
  brandName: string;
  offer: PageOffer;
}

/**
 * A product page's JSON-LD (CE-053): Product with its Offer, from the page
 * as written. Only what the page states: availability, SKU, GTIN and
 * reviews come from a product feed and connected reviews, which aren't
 * connected yet; a price the page doesn't state gives none (pageOffer).
 */
export function productJsonLd({
  name,
  description,
  images,
  brandName,
  offer,
}: ProductSchemaInput): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    // A placeholder isn't the product's name: it is left out until filled.
    ...(name.trim() && !titleHasPlaceholder(name) ? { name: name.trim() } : {}),
    ...(description ? { description } : {}),
    ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),
    ...(brandName.trim() ? { brand: { '@type': 'Brand', name: brandName.trim() } } : {}),
    offers:
      'price' in offer
        ? { '@type': 'Offer', price: offer.price.toFixed(2), priceCurrency: offer.currency }
        : {
            '@type': 'AggregateOffer',
            lowPrice: offer.low.toFixed(2),
            highPrice: offer.high.toFixed(2),
            priceCurrency: offer.currency,
            offerCount: offer.count,
          },
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
