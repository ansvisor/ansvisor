import type { ContentAuthor } from './authors';
import { pagePrices, priceRanges } from './brand-facts';
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

/** The title as the page's name (Article's headline, Product's name); none while empty or a placeholder's in it. */
export const pageName = (title: string) =>
  title.trim() && !titleHasPlaceholder(title) ? title.trim() : null;

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
    ...(pageName(title) ? { headline: pageName(title) } : {}),
    ...(image ? { image } : {}),
    ...(author !== undefined ? { author: person ?? organization } : {}),
    publisher: organization,
    ...(isNew ? { datePublished: today } : {}),
    dateModified: today,
  };
}

/**
 * A product page's price as the page states it (Quality spec §11, CE-053):
 * one price is the product's Offer; several (sizes, a range) give its low
 * and high. None when the page states none, or in more than one currency
 * (whose is which isn't sure). Each amount is read by the words around it,
 * so a sentence keeps its price beside one that isn't: "$129 (was $159)",
 * "$129, or 4 payments of $32.25", "€129 inkl. MwSt.".
 */
export type PageOffer =
  | { price: number; currency: string }
  | { low: number; high: number; currency: string };

/**
 * Just before an amount, words that make it no price of the product's: a
 * threshold ("orders over $50", "spend $75", "minimum $20"), an old price
 * ("was", "instead of", "statt"), a saving or an extra ("save $30", "an
 * extra $10"), an installment ("4 payments of $32"), a bundle ("2 for $30").
 */
const NOT_THE_PRICE_BEFORE =
  /(?:(?<![\p{L}-])(?:over|above|more\s+than|at\s+least|minimum(?:\s+(?:order|spend|purchase))?(?:\s+of)?|min\.|spend(?:ing)?|orders?\s+(?:over|above|of|from)|was|were|regularly|reg\.|originally|instead\s+of|compare\s+at|list\s+price|msrp|rrp|uvp|statt|save|saving|savings\s+of|(?:an?\s+)?extra|additional|discount\s+of|(?:payments?|installments?|instalments?|deposit)\s+of)|(?:^|\(|\bbuy\s+|\bany\s+|\bor\s+)\s*(?:\d{1,2}|two|three|four|five)\s+for|\d\s*[x×])\s*:?\s*$/iu;
/**
 * Before an amount in its clause, words of another bill: shipping, a
 * financing plan, an add-on or an accessory, setup ("Free shipping on
 * orders over $50", "Pay in 4 with Klarna: $32.25", "Add a rain cover for
 * $19").
 */
const ANOTHER_BILL =
  /(?<!\p{L})(?:shipping|delivery|postage|versand\p{L}*|livraison|env[ií]os?|kargo\p{L}*|frete|affirm|klarna|afterpay|sezzle|taksit\p{L}*|financing|finanzierung|interest[\s-]free|sold\s+separately|ayrı\s+satılır|add(?:-ons?|\s+an?|\s+on)|accessor(?:y|ies)|aksesuar\p{L}*|zubehör|installation|setup|set-up|kurulum)(?!\p{L})/iu;
/**
 * Right after an amount: a unit price ("$0.50/oz", "€12 pro kg"), a
 * range's period ("$10–$20 a month"), what it isn't ("$30 off", "a $10 coupon", "$5 fee", "$30 less", "500 TL
 * üzeri", "₺1.299 yerine"), a bundle ("$25 for 2"), financing ("$32.25
 * with Klarna") or an add-on ("$19, sold separately").
 */
const NOT_THE_PRICE_AFTER =
  /^(?:\s*(?:\/\s*|per\s+|pro\s+|a\s+)(?:100\s?)?(?:kg|g|lb|lbs|oz|fl\.?\s?oz|ml|cl|l|unit|ct|count|piece|pc|item|sq\.?\s?ft|m²|m2|stück|adet|serving)(?!\p{L})|\s*(?:off|discount|coupon|(?:store\s+)?credits?|gift\s+cards?|fee|surcharge|deposit|rebate|cash\s?back|savings?|less|more|cheaper|yerine|(?:ve\s+)?üzeri|minimum|or\s+(?:more|above|over))(?!\p{L})|\s*(?:\/\s*|per\s+|a\s+|an\s+|each\s+)(?:mo|mth|month|yr|year|wk|week|day)(?!\p{L})|\s*for\s+(?:\d|two|three|four|five)(?![\p{N}\p{L}])|\s*(?:today\s+)?(?:with|via|through)\s+(?:affirm|klarna|afterpay|sezzle)(?!\p{L})|[^.;]{0,6}(?:sold\s+)?separately|[^.;]{0,6}ayrı\s+satılır)/iu;

/** Whether an amount, from `at` to `end` in its sentence, is the product's price by the words around it. */
function theProducts(sentence: string, at: number, end: number, since: number): boolean {
  // Its clause, since the amount before it: "Free shipping, and it's $129" keeps $129.
  const lead = sentence
    .slice(Math.max(since, at - 48), at)
    .split(/,\s|;|\s[–—]\s/u)
    .pop()!;
  const after = sentence.slice(end, end + 40);
  return !(
    NOT_THE_PRICE_BEFORE.test(lead) ||
    ANOTHER_BILL.test(lead) ||
    NOT_THE_PRICE_AFTER.test(after)
  );
}

export function pageOffer(texts: readonly string[]): PageOffer | null {
  const amounts: { low: number; high: number; currency: string }[] = [];
  for (const sentence of texts.flatMap((text) => sentencesOf(text))) {
    const found = [
      // A price by the month or the year is a plan's or a payment's, not a product's.
      ...pagePrices(sentence)
        .filter((price) => price.period === null)
        .map((price) => ({ ...price, low: price.amount, high: price.amount })),
      ...priceRanges(sentence),
    ].sort((a, b) => a.at - b.at);
    let since = 0;
    for (const price of found) {
      const end = price.at + price.text.length;
      if (price.low > 0 && theProducts(sentence, price.at, end, since)) {
        amounts.push({ low: price.low, high: price.high, currency: price.currency });
      }
      since = end;
    }
  }
  if (!amounts.length) return null;
  const currencies = new Set(amounts.map((a) => a.currency));
  if (currencies.size > 1) return null;
  const [currency] = currencies;
  const low = Math.min(...amounts.map((a) => a.low));
  const high = Math.max(...amounts.map((a) => a.high));
  return low === high ? { price: low, currency } : { low, high, currency };
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
  /** The page's title (its H1) as pageName gives it: Product needs a name, so there is none without it. */
  name: string;
  /** The opening paragraph: left out while a placeholder's in it. */
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
    name,
    ...(description && !ONE_PLACEHOLDER.test(description) ? { description } : {}),
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
