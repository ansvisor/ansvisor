import { pagePrices, priceRanges } from './brand-facts';
import { squeeze } from './quality-checks';
import { sentencesOf } from './readability';

/**
 * A category page's intro facts (Content Editor Quality spec §11, Phase 3,
 * CE-054): Trust counts "correct counts and price range", and the typical
 * to-do is "Confirm intro facts". How many products the category has and
 * what they cost are the brand's own: no source says them, so only the
 * person can confirm them (00280's confirmations, kind intro_fact), as a
 * customer case is confirmed (CE-052).
 */

/** A sentence of the intro that states a count or a price. */
export interface IntroFact {
  sentence: string;
  /** Its confirmation key: the sentence's words, so a changed fact asks again. */
  key: string;
}

/**
 * A count of what the category has: "120+ daypacks", "over 50 styles",
 * "more than 40 models", "choose from 24 colours", "50'den fazla model",
 * "über 30 Modelle", "plus de 20 modèles", "más de 30 modelos".
 */
const COUNT = new RegExp(
  [
    String.raw`\d[\d.,]*\+`,
    String.raw`(?<!\p{L})(?:over|more\s+than|nearly|almost|choose\s+from|shop|browse|explore|discover|über|mehr\s+als|plus\s+de|más\s+de|oltre|mais\s+de|meer\s+dan)\s+\d[\d.,]*(?!\s*(?:%|[$€£¥₹₺]))`,
    String.raw`\d[\d.,]*['’]?(?:den|dan|ten|tan)\s+fazla`,
    String.raw`(?<![\d.,])\d[\d.,]*\s+(?:\p{L}+\s+)?(?:products|items|styles|models|designs|colou?rs|options|brands|ürün|model|çeşit|renk|produkte|modelle|artikel|produits|modèles|productos|modelos|prodotti|modelli)(?!\p{L})`,
  ].join('|'),
  'iu',
);
/**
 * Whether a sentence states a count or a price: an intro fact. A price is
 * an amount with its currency ("from €49", "under $100", "$49–$199"), so
 * "from 20 to 40 litres" isn't one.
 */
const statesFact = (sentence: string) =>
  COUNT.test(sentence) ||
  pagePrices(sentence, { rangeEnds: true }).length > 0 ||
  priceRanges(sentence).length > 0;

/** A fact's confirmation key: its sentence's words, without spaces, lowercased. */
export const introKey = (sentence: string) =>
  `intro:${squeeze(sentence).toLowerCase()}`.slice(0, 400);

/**
 * The facts a category page's intro states: its sentences between the H1
 * and the first H2 (the Rules tab's intro) with a count or a price, each
 * once.
 */
export function introFacts(html: string): IntroFact[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [...doc.body.querySelectorAll('h1, h2, p, li')];
  const h1 = blocks.findIndex((el) => el.tagName === 'H1');
  const intro: string[] = [];
  for (const el of blocks.slice(h1 + 1)) {
    if (el.tagName === 'H2') break;
    if (el.tagName === 'H1') continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) intro.push(text);
  }
  const seen = new Set<string>();
  return intro
    .flatMap((text) => sentencesOf(text))
    .filter(statesFact)
    .flatMap((sentence) => {
      const key = introKey(sentence);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ sentence, key }];
    });
}
