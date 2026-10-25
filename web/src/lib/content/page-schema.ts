import type { ContentAuthor } from './authors';
import { factValueText, pagePrices, priceRanges } from './brand-facts';
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
 * one price is the product's Offer, a range it writes ("$119–$139") its low
 * and high. Each amount is read by the words around it, so a sentence keeps
 * its price beside one that isn't: "$129 (was $159)", "$129, or 4 payments
 * of $32.25", "€129 inkl. MwSt.". A price on the page is pasted as the
 * product's, so nothing is guessed: prices that differ ("Small: $119",
 * "Large: $139", or one this reading missed) are `several`, for the person
 * to write once or as a range.
 */
export type PageOffer =
  | { price: number; currency: string }
  | { low: number; high: number; currency: string };
export type PageOfferRead = PageOffer | { several: string[] } | null;

/**
 * Just before an amount, words that make it no price of the product's: a
 * threshold ("orders over $50", "spend $75", "minimum $20", "Versand ab
 * 50 €"), an old price ("was", "instead of", "statt", "au lieu de"), a
 * saving, a worth or an extra ("save up to $30", "worth $30", "an extra
 * $10", "earn $13"), an installment ("4 payments of $32"), a bundle ("2 for
 * $30"), or a bill added to it ("+ $9.95", "zzgl. 4,95 €").
 */
const NOT_THE_PRICE_BEFORE =
  /(?:(?<![\p{L}-])(?:over|above|more\s+than|at\s+least|minimum(?:\s+(?:order|spend|purchase))?(?:\s+of)?|(?<!\d\s?)min\.?(?:\s+(?:order|spend|purchase))?(?:\s+of)?|spend(?:ing)?|orders?(?:\s+(?:over|above|of|from|between))?|bestellungen|commandes?|pedidos?|siparişler(?:de)?|über|superior(?:es)?\s+a|supérieure?s?\s+à|plus\s+de|más\s+de|was|were|instead\s+of|statt|bisher|vorher|au\s+lieu\s+de|prix\s+barré|antes|precio\s+anterior|save(?:\s+up\s+to)?|saving|savings(?:\s+of)?|you\s+save\b[^.;$€£¥₹₺]{0,12}|sie\s+sparen|sparen\s+sie|économisez|ahorr(?:a|as|o\s+de)|tasarruf(?:unuz)?|up\s+to|worth|valued\s+at|value\s+of|earn|(?:an?\s+)?extra|additional|discount\s+of|gift\s+cards?|(?:store\s+)?credit|(?:payments?|installments?|instalments?|deposit)\s+of|raten?\s+(?:à|von|zu|a)|plazos\s+de|mensualités\s+de|zzgl|zuzüglich|unit\s+price|grundpreis|prix\s+unitaire|precio\s+unitario|birim\s+fiyat(?:ı)?|members?(?:hip)?(?:\s+price)?|subscri\p{L}*(?:\s+(?:&|and)\s+save)?(?:\s+price)?|with\s+code\b[^.;$€£¥₹₺]{0,15}|balance(?:\s+of)?|remaining|restbetrag)|(?:shipping|delivery|versand|livraison|env[ií]o|kargo)\p{L}*(?:\s+\p{L}+){0,2}\s+(?:ab|dès|desde|from)|(?:^|\(|\bbuy\s+|\bany\s+|\bor\s+)\s*(?:\d{1,2}|two|three|four|five)\s+for|\d\s*[x×]|(?<![\p{L}\p{N}])\+)\s*:?\s*\(?\s*$/iu;
/** "plus $9.95 shipping": lower case, so a model named Plus keeps its price. */
const PLUS_BEFORE = /(?<!\p{L})plus\s*$/u;
/**
 * An old price ("Regular price", "Original price", "reg.", "compare at"):
 * dropped beside a lower price in its block ("Regular price $159 Sale price
 * $129"), else a price like the others. "Regular" alone is a size.
 */
const OLD_PRICE_BEFORE =
  /(?<!\p{L})(?:(?:regular|original|retail|list|eski|liste|piyasa)\s+(?:price|fiyat(?:ı)?)|regularly|originally|reg\.|compare\s+at|msrp|rrp|uvp)\s*:?\s*$/iu;
/**
 * Within its last words before an amount, another bill: shipping (free
 * shipping is no bill: "with free shipping costs $129") or financing
 * ("Shipping: $5.99", "Pay in 4 with Klarna: $32.25").
 */
const ANOTHER_BILL =
  /(?<!(?:free|kostenlose[rn]?|gratuite?|gratis|ücretsiz|bedava)\s+)(?<!\p{L})(?:shipping|delivery|postage|versand(?!kostenfrei)\p{L}*|livraison|env[ií]os?|kargo\p{L}*|frete|affirm|klarna|afterpay|sezzle|paypal|shop\s?pay|taksit\p{L}*|financing|finanzierung|interest[\s-]free)(?!\p{L})/iu;
/**
 * In its clause before an amount, an add-on, an accessory by its label or
 * setup ("Add a waterproof rain cover for $19", "Accessories: rain cover
 * $19", "Installation: $99").
 */
const ADD_ON =
  /(?<!\p{L})(?:sold\s+separately|ayrı\s+satılır|add(?:-ons?|\s+an?|\s+on)|(?:accessor(?:y|ies)|aksesuar\p{L}*|zubehör)\s*:|installation|setup|set-up|kurulum)(?!\p{L})/iu;
/**
 * Right after an amount: a unit price ("$0.50/oz", "€12 pro kg"), a
 * range's period ("$10–$20 a month"), what it isn't ("$30 off", "a $10
 * coupon", "$5 fee", "$30 less", "($30 value)", "$13 in rewards", "500 TL
 * üzeri", "₺1.299 yerine"), another bill ("$9.95 shipping", "$4 tax"), a
 * bundle ("$25 for 2"), financing ("$32.25 with Klarna") or an add-on
 * ("$19, sold separately").
 */
const NOT_THE_PRICE_AFTER =
  /^(?:\+(?!\s?\d)|\s*(?:\/\s*|per\s+|pro\s+|a\s+)(?:per\s+)?(?:\d+\s?)?(?:kg|g|lb|lbs|oz|fl\.?\s?oz|ml|cl|l|unit|ct|count|piece|pc|item|sq\.?\s?ft|m²|m2|stück|adet|serving)(?!\p{L})|\s*(?:\/\s*|per\s+|pro\s+|im\s+|a\s+|an\s+|each\s+|par\s+|al\s+|por\s+)(?:mo|mth|month|monat|mois|mes|yr|year|jahr|an|año|wk|week|day)(?!\p{L})|\s*(?:monthly|yearly|annually|monatlich|jährlich|aylık|yıllık)(?!\p{L})|\s*(?:off|discount|coupon|(?:store\s+)?credits?|gift\s+cards?|fee|surcharge|deposit|rebate|cash\s?back|savings?|less|more|cheaper|value|in\s+(?:rewards?|credit|points)|trade-in|yerine|(?:ve\s+)?üzeri|minimum|or\s+(?:more|above|over))(?!\p{L})|\s*(?:shipping|delivery|postage|s&h|handling|versand\p{L}*|porto|livraison|env[ií]os?|kargo\p{L}*|frete|(?:sales\s+)?tax(?:es)?|vat|mwst|kdv)(?!\p{L})(?!\s+(?:incl\p{L}*|inkl\p{L}*|dahil|included))|\s*(?:with|for)\s+(?:subscri\p{L}*|members?|prime|(?:promo\s+)?code)(?!\p{L})|\s*(?:indirim|kupon)\p{L}*|\s*for\s+(?:\d|two|three|four|five)(?![\p{N}\p{L}])|\s*(?:today\s+)?(?:with|via|through)\s+(?:affirm|klarna|afterpay|sezzle)(?!\p{L})|[^.;]{0,6}(?:sold\s+)?separately|[^.;]{0,6}ayrı\s+satılır)/iu;

/** How an amount reads by the words around it: another bill, an old price, or the product's. */
function amountKind(
  sentence: string,
  at: number,
  end: number,
  since: number,
): 'not' | 'old' | 'price' {
  // Its clause, since the amount before it: "Free shipping, and it's $129" keeps $129.
  const lead = sentence
    .slice(Math.max(since, at - 48), at)
    .split(/,\s|;|\s[–—]\s/u)
    .pop()!;
  const lastWords = lead.trim().split(/\s+/).slice(-5).join(' ');
  if (
    NOT_THE_PRICE_BEFORE.test(lead) ||
    PLUS_BEFORE.test(lead) ||
    ANOTHER_BILL.test(lastWords) ||
    ADD_ON.test(lead) ||
    NOT_THE_PRICE_AFTER.test(sentence.slice(end, end + 40))
  ) {
    return 'not';
  }
  return OLD_PRICE_BEFORE.test(lead) ? 'old' : 'price';
}

/** The prices that differ Before you publish lists, at most. */
const SEVERAL_SHOWN = 5;
/** A sale price this share of the old one or more reads as its sale (60% off at most). */
const SALE_FLOOR = 0.4;

/** Abbreviations a price sits beside, kept from ending a sentence ("$99 (reg. $129)", "zzgl. 4,95 €"). */
const ABBREVIATION =
  /(?<!\p{L})(?<!\d\s?)(reg|min|zzgl|inkl|exkl|incl|excl|approx|ca|uvp|vs)\.(?=\s)/giu;

export function pageOffer(texts: readonly string[]): PageOfferRead {
  const found: {
    low: number;
    high: number;
    currency: string;
    text: string;
    block: number;
    range: boolean;
    old: boolean;
    /** Not sure to be one price: "From $119", "$119 – 139", "119 bis 139 €". */
    unsure: boolean;
  }[] = [];
  texts.forEach((text, block) => {
    // A one-dot leader keeps the abbreviation's dot: sentencesOf puts it back.
    for (const sentence of sentencesOf(text.replace(ABBREVIATION, '$1\u2024'))) {
      const ranges = priceRanges(sentence);
      const inRange = (at: number) => ranges.some((r) => at >= r.at && at < r.at + r.text.length);
      const amounts = [
        // A price by the month or the year is a plan's or a payment's, not a product's.
        ...pagePrices(sentence, { rangeEnds: true })
          .filter((price) => price.period === null && !inRange(price.at))
          .map((price) => ({
            ...price,
            low: price.amount,
            high: price.amount,
            range: false,
            unsure: price.from || price.loose,
          })),
        ...ranges.map((range) => ({ ...range, range: true, unsure: !range.sure })),
      ].sort((a, b) => a.at - b.at);
      let since = 0;
      for (const amount of amounts) {
        const end = amount.at + amount.text.length;
        const kind = amountKind(sentence, amount.at, end, since);
        if (amount.low > 0 && kind !== 'not') {
          found.push({
            low: amount.low,
            high: amount.high,
            currency: amount.currency,
            text: amount.text.trim(),
            block,
            range: amount.range,
            old: kind === 'old',
            unsure: amount.unsure,
          });
        }
        since = end;
      }
    }
  });
  // An old price is dropped beside the one lower price in its block that
  // reads as its sale ("Regular price $159 Sale price $129"), not beside
  // another amount ("Regular price $129 Unit price $12.90").
  const prices = found.filter((p) => {
    if (!p.old) return true;
    const lower = found.filter((q) => !q.old && q.block === p.block && q.high < p.low);
    return !(lower.length === 1 && lower[0].low >= p.low * SALE_FLOOR);
  });
  if (!prices.length) return null;
  const [first] = prices;
  const same = (p: (typeof prices)[number]) => p.currency === first.currency;
  const ranges = prices.filter((p) => p.range);
  const range = ranges[0];
  if (
    !prices.some((p) => p.unsure) &&
    prices.every(same) &&
    (range
      ? ranges.every((r) => r.low === range.low && r.high === range.high) &&
        // A price beside the range is one of its ends: "$200–$400, but the X1 is $299" isn't one.
        prices.every((p) => p.range || p.low === range.low || p.low === range.high)
      : prices.every((p) => p.low === first.low))
  ) {
    return range
      ? { low: range.low, high: range.high, currency: range.currency }
      : { price: first.low, currency: first.currency };
  }
  // Each price once, as the page first writes it ("$129" and "$129.00" are one).
  const seen = new Map<string, string>();
  for (const p of prices) {
    const key = `${p.currency} ${p.low} ${p.high} ${p.unsure}`;
    if (!seen.has(key)) seen.set(key, p.text);
  }
  return { several: [...seen.values()].slice(0, SEVERAL_SHOWN) };
}

/** The Offer's price as a person reads it ("$129", "€119–€139"), for them to check. */
export function offerText(offer: PageOffer): string {
  const money = (amount: number) =>
    factValueText('price', {
      plan: '',
      amount,
      currency: offer.currency,
      period: null,
      billed: null,
      per: null,
    });
  return 'price' in offer ? money(offer.price) : `${money(offer.low)}–${money(offer.high)}`;
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
