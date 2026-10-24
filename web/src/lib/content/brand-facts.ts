/**
 * A brand's facts (Content Editor Quality spec §10, CE-047): its prices and
 * plans, its trial, when it was founded and the claims it makes of itself,
 * read from its own pricing, About and product pages by the API
 * (brand-facts.js), each with its words on the page. A person approves each
 * one in Brand settings › Brand facts; Trust compares a page with the
 * approved ones that are still on the site.
 */

export const FACT_KINDS = ['price', 'trial', 'founded', 'claim'] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const FACT_SOURCES = ['pricing', 'about', 'product'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];
export type FactStatus = 'pending' | 'approved' | 'rejected';
export type FactPageStatus = 'ok' | 'blocked' | 'not_found' | 'failed' | 'missed';

/** A price as the API reads it from its words. */
export interface PriceValue {
  plan: string;
  amount: number;
  currency: string;
  period: 'month' | 'year' | 'once' | null;
  billed: 'monthly' | 'annually' | null;
  per: 'seat' | null;
}

export type FactValue = PriceValue | { days: number } | { year: number } | Record<string, never>;

export interface BrandFact {
  id: string;
  kind: FactKind;
  value: FactValue;
  /** The page's own words, which hold it. */
  quote: string;
  sourceUrl: string;
  sourceKind: FactSource;
  status: FactStatus;
  reviewedAt: string | null;
  firstSeenAt: string;
  /** No longer on the site: left out of the check. */
  gone: boolean;
  /** The approved fact a pending one would replace ("Was $49"). */
  replaces: { id: string; value: FactValue } | null;
}

export interface BrandFactsRead {
  facts: BrandFact[];
  pages: { kind: FactSource; url: string | null; status: FactPageStatus; checkedAt: string }[];
  checkedAt: string | null;
  /** When the site may be read again. */
  recheckAt: string | null;
  /** The workspace's AI budget is spent: pages not read wait. */
  paused: boolean;
  /** The brand has no domain to read. */
  noDomain: boolean;
}

/** Where a brand's facts are approved: Brand settings › Brand facts. */
export const brandFactsPath = (brandId: string) =>
  `/dashboard/brands/${brandId}/settings?tab=facts`;

export const isPrice = (
  fact: Pick<BrandFact, 'kind' | 'value'>,
): fact is BrandFact & {
  value: PriceValue;
} => fact.kind === 'price';

/**
 * A fact's value as a person reads it: "$49", "€49.99", "14 days", "2015";
 * a claim is its words. Amounts in the currency's own format, the app's
 * English otherwise.
 */
export function factValueText(kind: FactKind, value: FactValue, quote = ''): string {
  if (kind === 'price') {
    const price = value as PriceValue;
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: price.currency,
        maximumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
      }).format(price.amount);
    } catch {
      return `${price.amount} ${price.currency}`;
    }
  }
  if (kind === 'trial') return String((value as { days: number }).days);
  if (kind === 'founded') return String((value as { year: number }).year);
  return quote;
}

/** Currency marks, the longest first ("US$" before "$"), as the API reads them. */
const CURRENCY_MARKS: [string, string][] = [
  ['US$', 'USD'],
  ['CA$', 'CAD'],
  ['AU$', 'AUD'],
  ['NZ$', 'NZD'],
  ['HK$', 'HKD'],
  ['R$', 'BRL'],
  ['C$', 'CAD'],
  ['A$', 'AUD'],
  ['S$', 'SGD'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['₺', 'TRY'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
];
const ISO = [
  'USD',
  'EUR',
  'GBP',
  'TRY',
  'JPY',
  'INR',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'BRL',
  'MXN',
  'SGD',
  'HKD',
  'ZAR',
];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARK = `(?:${CURRENCY_MARKS.map(([m]) => escape(m)).join('|')})`;
const CODE = `(?<![\\p{L}])(?:${ISO.join('|')}|TL)(?![\\p{L}])`;
/** Thousands by a comma or a point, or by a space when the currency comes after ("1 299 €"). */
const amount = (groups: string) =>
  String.raw`\d{1,3}(?:${groups}\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?!\d)`;
const PRICE = new RegExp(
  `(?<before>${MARK}|${CODE})\\s?(?<a>${amount('[.,]')})|(?<b>${amount('[.,\\s]')})\\s?(?<after>${MARK}|${CODE}|zł)`,
  'gu',
);
const MAGNITUDE =
  /^\s?(?:[kKmMbB](?!\p{L})|bn\b|mn\b|thousand|million|billion|milyon|milyar|Mio|Mrd)/u;
/** "save $10", "$10 off", "%20 indirim": a discount, not a price. */
const DISCOUNT_BEFORE = /\b(?:save|saving|discount|sparen|économisez|ahorra|indirim)\s*$/iu;
const DISCOUNT_AFTER = /^\s?(?:off\b|indirim|rabatt|de\s+réduction|de\s+descuento)/iu;
/** "$10–$20", "$10 to $20": a range. */
const RANGE_AFTER = /^\s?(?:[–—-]|to\b|bis\b|ile\b|ila\b|à\b|a\b)\s?\S*\d/iu;
const RANGE_BEFORE = /(?:[–—-]|\bto|\bbis)\s?\S{0,4}$/iu;
const MONTH =
  /^[^\d$€£¥₹₺]{0,20}?(?:\/\s?(?:mo|mth|month|ay|monat|mois|mes)\b|\b(?:per|a|each)\s+month\b|\bmonthly\b|\baylık\b|\bayda\b|\bmonatlich\b|\b(?:pro|im)\s+monat\b|\bpar\s+mois\b|\b(?:al|por)\s+mes\b)/iu;
const YEAR =
  /^[^\d$€£¥₹₺]{0,20}?(?:\/\s?(?:yr|year|yıl|jahr|an|año)\b|\b(?:per|a|each)\s+year\b|\bannually\b|\byearly\b|\byıllık\b|\byılda\b|\bjährlich\b|\b(?:pro|im)\s+jahr\b|\bpar\s+an\b|\b(?:al|por)\s+año\b)/iu;
const FROM = /\b(?:from|start(?:s|ing)?\s+(?:at|from)|ab|à\s+partir\s+de|desde)\s*$/iu;
/** "₺499'dan başlayan": Turkish says it after the price. */
const FROM_AFTER = /^['’]?(?:den|dan|ten|tan)\s+(?:başlayan|itibaren)/iu;

const currencyOf = (mark: string) =>
  mark === 'TL'
    ? 'TRY'
    : mark === 'zł'
      ? 'PLN'
      : (CURRENCY_MARKS.find(([m]) => m === mark)?.[1] ?? (ISO.includes(mark) ? mark : null));

/** An amount as written: a separator before exactly three digits groups thousands. */
const amountOf = (token: string) => {
  const value = Number(token.replace(/[.,\s](?=\d{3}(?!\d))/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

/** A price a page's sentence gives: as written, its amount, currency and period, and whether it is "from". */
export interface PagePrice {
  text: string;
  amount: number;
  currency: string;
  period: 'month' | 'year' | null;
  from: boolean;
}

/**
 * The prices a sentence gives, the way the API reads a brand's: a scale
 * ("$2M"), a discount ("save $10", "$10 off") and a range ("$10–$20") are
 * none.
 */
export function pagePrices(sentence: string): PagePrice[] {
  const out: PagePrice[] = [];
  for (const m of sentence.matchAll(PRICE)) {
    const g = m.groups!;
    const end = m.index + m[0].length;
    const before = sentence.slice(Math.max(0, m.index - 24), m.index);
    const after = sentence.slice(end, end + 40);
    if (MAGNITUDE.test(after) || DISCOUNT_BEFORE.test(before) || DISCOUNT_AFTER.test(after))
      continue;
    if (RANGE_AFTER.test(after) || RANGE_BEFORE.test(before)) continue;
    const currency = currencyOf(g.before ?? g.after);
    const value = amountOf(g.a ?? g.b);
    if (!currency || value === null) continue;
    out.push({
      text: m[0].trim(),
      amount: value,
      currency,
      period: MONTH.test(after) ? 'month' : YEAR.test(after) ? 'year' : null,
      from: FROM.test(before) || FROM_AFTER.test(after),
    });
  }
  return out;
}

/** A page's fact that differs from an approved one: Trust's suggestion names both. */
export interface FactMismatch {
  kind: 'price' | 'trial' | 'founded';
  /** The page's value, as written ("$39"). */
  page: string;
  /** The approved value ("$49"). */
  fact: string;
  /** The page the approved one was read from. */
  source: FactSource;
  /** The sentence it is in: Show goes there. */
  sentence: string;
}

const words = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
const names = (sentence: string, name: string) =>
  name.trim().length > 2 && words(sentence).includes(words(name));
const SELF = /\b(?:we|our|us)\b|\b(?:biz|bizim)\b|\b(?:wir|unser\w*)\b/iu;
const TRIAL = /\btrial\b|deneme|testphase|essai|prueba/iu;
const TRIAL_DAYS = /(\d{1,3})[\s-]?(?:days?|gün|tage?n?|jours?|días?)(?!\p{L})/iu;
const TRIAL_WEEKS = /(\d{1,2})[\s-]?(?:weeks?|hafta|wochen?|semaines?|semanas?)(?!\p{L})/iu;
const FOUNDED = /\bfounded\b|\bestablished\b|\bstarted\s+in\b|kuruldu|gegründet|fondée?|fundada?/iu;
const YEAR_NUMBER = /(?<!\d)(1[89]\d{2}|20\d{2})(?!\d)/;

/**
 * The page's prices, trial and founding year against the brand's approved
 * facts still on its site (Trust's "consistent with brand facts", CE-047),
 * read so as not to cry wolf:
 *
 *   * a price is compared in its currency only, and with a known period
 *     only against the same period's (or a period-less) price;
 *   * a sentence naming a plan compares with that plan's prices, any of
 *     them (monthly and annual billing both count);
 *   * one naming no plan only when it names the brand (or "we") and a
 *     period; "from $29" with the lowest such price;
 *   * a sentence naming a competitor isn't read;
 *   * a trial in days against the approved trial, a founding year beside
 *     the brand's name against the approved one.
 *
 * `compared` is how many were compared: the check's points are the share
 * that matched.
 */
export function factMismatches({
  sentences,
  facts,
  brandName,
  competitorDomains,
}: {
  /** The page's sentences (its Trust blocks', sentencesOf). */
  sentences: string[];
  facts: BrandFact[];
  brandName: string;
  competitorDomains: string[];
}): { compared: number; mismatches: FactMismatch[] } {
  const approved = facts.filter((f) => f.status === 'approved' && !f.gone);
  const prices = approved.filter(isPrice);
  const trials = approved.filter((f) => f.kind === 'trial');
  const years = approved.filter((f) => f.kind === 'founded');
  if (!prices.length && !trials.length && !years.length) return { compared: 0, mismatches: [] };
  const rivals = competitorDomains
    .map(
      (d) =>
        d
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/^www\./, '')
          .split('/')[0],
    )
    .flatMap((d) => [d, d.split('.')[0]])
    .filter((d) => d.length >= 3);
  const plans = [...new Set(prices.map((p) => p.value.plan))]
    .filter((plan) => plan.trim().length > 2)
    .sort((a, b) => b.length - a.length);
  const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const shown = (f: BrandFact) => factValueText(f.kind, f.value, f.quote);

  let compared = 0;
  const mismatches: FactMismatch[] = [];
  const differs = (m: FactMismatch) => {
    if (!mismatches.some((x) => x.sentence === m.sentence && x.page === m.page)) mismatches.push(m);
  };
  for (const sentence of sentences) {
    if (rivals.some((r) => names(sentence, r))) continue;
    const self = names(sentence, brandName) || SELF.test(sentence);
    const plan = plans.find((p) => names(sentence, p));
    for (const price of pagePrices(sentence)) {
      let pool = prices.filter((p) => p.value.currency === price.currency);
      if (plan) pool = pool.filter((p) => p.value.plan === plan);
      else if (!self || (!price.period && !price.from)) continue;
      if (price.period)
        pool = pool.filter((p) => !p.value.period || p.value.period === price.period);
      if (!pool.length) continue;
      if (!plan && price.from) {
        const lowest = pool.reduce((low, p) => (p.value.amount < low.value.amount ? p : low));
        pool = [lowest];
      }
      compared += 1;
      if (!pool.some((p) => same(p.value.amount, price.amount))) {
        differs({
          kind: 'price',
          page: price.text,
          fact: shown(pool[0]),
          source: pool[0].sourceKind,
          sentence,
        });
      }
    }
    if (trials.length && TRIAL.test(sentence)) {
      const d = sentence.match(TRIAL_DAYS);
      const w = d ? null : sentence.match(TRIAL_WEEKS);
      const days = d ? Number(d[1]) : w ? Number(w[1]) * 7 : null;
      if (days) {
        compared += 1;
        if (!trials.some((f) => (f.value as { days: number }).days === days)) {
          differs({
            kind: 'trial',
            page: (d ?? w)![0],
            // The approved trial as its page writes it ("14-day").
            fact: trials[0].quote.match(TRIAL_DAYS)?.[0] ?? shown(trials[0]),
            source: trials[0].sourceKind,
            sentence,
          });
        }
      }
    }
    if (years.length && self && FOUNDED.test(sentence)) {
      const year = sentence.match(YEAR_NUMBER);
      if (year) {
        compared += 1;
        if (!years.some((f) => (f.value as { year: number }).year === Number(year[1]))) {
          differs({
            kind: 'founded',
            page: year[1],
            fact: shown(years[0]),
            source: years[0].sourceKind,
            sentence,
          });
        }
      }
    }
  }
  return { compared, mismatches };
}
