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
  String.raw`(?<![\d.,])(?:\d{1,3}(?:${groups}\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d]|[.,]\d)`;
const PRICE = new RegExp(
  `(?<before>${MARK}|${CODE})\\s?(?<a>${amount('[.,]')})|(?<b>${amount('[.,\\s]')})\\s?(?<after>${MARK}|${CODE}|zł)`,
  'gu',
);
const MAGNITUDE =
  /^\s*(?:[kmb](?!\p{L})|bn\b|mn\b|thousand|million|billion|milyon|milyar|mio\b|mrd\b)/iu;
/** "$10–$20", "between $10 and $20": a range, its two ends (a number before the word or dash). */
const RANGE_AFTER =
  /^\s?(?:[–—-]|to\b|bis\b|ile\b|ila\b|and\b|und\b|et\b|ve\b|à(?=\s)|a(?=\s)|y(?=\s))\s?\S{0,4}\d/iu;
const RANGE_BEFORE = /\d\s?(?:\S{1,3}\s)?(?:[–—-]|to|bis|ile|ila|and|und|et|ve|à|a|y)\s?\S{0,4}$/iu;
/**
 * A sentence whose amounts aren't a plan's price: an old price, a saving,
 * a discount, credits, tax added, or a team's bill ("A 5-person team pays
 * $245").
 */
const NOT_A_PRICE =
  /(?<!\p{L})(?:was|instead\s+of|regularly|originally|save|saving|savings|off|discount|coupon|credits?|incl\.?|including\s+(?:vat|tax)|inkl\.?|kdv\s+dahil|statt|rabatt|indirim|tasarruf|économisez|ahorra|refund|money-back)(?!\p{L})|\d+[\s-]?(?:person|people|users?|seats?|members?|kişi(?:lik)?|kullanıcı)(?!\p{L})/iu;
const MONTH =
  /^[^\d$€£¥₹₺]{0,20}?(?:\/\s?(?:mo|mth|month|ay|monat|mois|mes)\b|\b(?:per|a|each)\s+month\b|\bmonthly\b|\baylık\b|\bayda\b|\bmonatlich\b|\b(?:pro|im)\s+monat\b|\bpar\s+mois\b|\b(?:al|por)\s+mes\b)/iu;
const YEAR =
  /^[^\d$€£¥₹₺]{0,20}?(?:\/\s?(?:yr|year|yıl|jahr|an|año)\b|\b(?:per|a|each)\s+year\b|\bannually\b|\byearly\b|\byıllık\b|\byılda\b|\bjährlich\b|\b(?:pro|im)\s+jahr\b|\bpar\s+an\b|\b(?:al|por)\s+año\b)/iu;
/** How a sentence says a price is billed: "billed annually", "with annual billing". */
const BILLED_YEAR =
  /billed\s+(?:annually|yearly)|(?:annual|yearly)\s+(?:billing|plan)|paid\s+(?:annually|yearly)|yıllık\s+ödeme|jährliche\s+zahlung/iu;
const BILLED_MONTH =
  /billed\s+monthly|monthly\s+billing|paid\s+monthly|aylık\s+ödeme|monatliche\s+zahlung/iu;
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

/** A price a page's sentence gives: as written, its amount, currency and period, where, and whether it is "from". */
export interface PagePrice {
  text: string;
  amount: number;
  currency: string;
  period: 'month' | 'year' | null;
  from: boolean;
  at: number;
}

/**
 * The prices a sentence gives, the way the API reads a brand's: a scale
 * ("$2M"), a range ("$10–$20") and "$10 off" are none.
 */
export function pagePrices(sentence: string): PagePrice[] {
  const out: PagePrice[] = [];
  for (const m of sentence.matchAll(PRICE)) {
    const g = m.groups!;
    const end = m.index + m[0].length;
    const before = sentence.slice(Math.max(0, m.index - 24), m.index);
    const after = sentence.slice(end, end + 40);
    if (MAGNITUDE.test(after) || /^\s*off(?!\p{L})/iu.test(after)) continue;
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
      at: m.index,
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

/**
 * Plan names that are everyday words ("Pro tip", "our team", "a free
 * consultation"): named only beside "plan" or "tier", or in a sentence
 * that names the brand.
 */
const COMMON_PLANS = new Set([
  'free',
  'pro',
  'plus',
  'team',
  'teams',
  'business',
  'basic',
  'starter',
  'growth',
  'standard',
  'premium',
  'enterprise',
  'personal',
  'professional',
  'essential',
  'essentials',
  'advanced',
  'ultimate',
  'lite',
  'max',
  'scale',
  'startup',
  'agency',
  'solo',
  'individual',
  'small business',
]);
const PLAN_WORD = /^\s*(?:plan|tier|package|edition|paket|planı|tarif)(?!\p{L})/iu;
/** "Ledgerly" as a word, the brand's name as written. */
const named = (sentence: string, name: string) =>
  name.trim().length > 2 &&
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(name.trim())}(?![\\p{L}\\p{N}])`, 'u').test(sentence);
/** Where a plan is named in a sentence, as the page writes it (its case too); -1 when it isn't. */
function planAt(sentence: string, plan: string, brandNamed: boolean): number {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(plan)}(?![\\p{L}\\p{N}])`, 'gu');
  for (const m of sentence.matchAll(re)) {
    const common = COMMON_PLANS.has(plan.toLowerCase());
    if (!common || brandNamed || PLAN_WORD.test(sentence.slice(m.index + m[0].length))) {
      return m.index;
    }
  }
  return -1;
}
/** The brand's own price, said of it: "Ledgerly costs $29 a month", "Ledgerly's pricing starts at". */
const PRICED =
  /(?<!\p{L})(?:costs?|charges?|priced|pricing|prices|starts?|starting|is|kostet|preis|fiyat|ücret|coûte|cuesta)(?!\p{L})/iu;
const TRIAL_DAYS = [
  /(?<!\d)(\d{1,3})[\s-]?days?[\s-]+(?:free\s+)?trial/iu,
  /trial\s+(?:of|for|lasts?|is)\s+(\d{1,3})\s+days?(?!\p{L})/iu,
  /free\s+for\s+(\d{1,3})\s+days?(?!\p{L})/iu,
  /(?<!\d)(\d{1,3})\s+günlük\s+(?:ücretsiz\s+)?deneme/iu,
  /(?<!\d)(\d{1,3})[\s-]?(?:tage|tägige)\s+(?:kostenlose\s+)?(?:testphase|testversion)/iu,
];
const TRIAL_WEEKS = [
  /(?<!\d)(\d{1,2})[\s-]?weeks?[\s-]+(?:free\s+)?trial/iu,
  /trial\s+(?:of|for|lasts?|is)\s+(\d{1,2})\s+weeks?(?!\p{L})/iu,
  /free\s+for\s+(\d{1,2})\s+weeks?(?!\p{L})/iu,
];
/** A trial said of the brand's plans: "your free trial", "every plan". */
const OWN_TRIAL =
  /\b(?:your|our)\s+(?:free\s+)?trial\b|\b(?:every|all|each)\s+plans?\b|\bher\s+plan|\btüm\s+planlar/iu;
const FOUNDED_YEAR = [
  /\b(?:founded|established)\s+(?:in\s+)?((?:18|19|20)\d{2})(?!\d)/iu,
  /(?<!\d)((?:18|19|20)\d{2})['’]?(?:de|da|te|ta)?\s+(?:yılında\s+)?kurul(?:du|muştur)/iu,
  /gegründet\s+(?:im\s+jahr\s+)?((?:18|19|20)\d{2})(?!\d)|(?<!\d)((?:18|19|20)\d{2})\s+gegründet/iu,
];
const WE_FOUNDED =
  /\b(?:we\s+were|our\s+company\s+was|wir\s+wurden)\s+(?:founded|established|gegründet)/iu;

/**
 * The page's prices, trial and founding year against the brand's approved
 * facts still on its site (Trust's "consistent with brand facts", CE-047),
 * read so as never to cry wolf (a wrong warning on a right page is worse
 * than none):
 *
 *   * a price is compared with the plan named nearest it in the sentence,
 *     its name as the page writes it, a name that is an everyday word
 *     ("Pro", "Team", "Free") only beside "plan" or "tier" or with the
 *     brand named; with no plan named, only when the sentence names the
 *     brand and says what it costs ("Ledgerly costs $29 a month");
 *   * in its currency only; with a period or a billing ("billed
 *     annually") only against prices of that period or billing; it
 *     matches when it is any of them (a plan's monthly and annual prices
 *     both count), "from $19" too; free ($0) is never compared;
 *   * a sentence with an old price, a saving, a discount, credits, tax or
 *     a team's bill ("was $49", "5 users pay") isn't read for prices, nor
 *     one naming a competitor;
 *   * a trial in days where the sentence says it is the brand's ("your
 *     free trial", "every plan", the brand's name), its days right beside
 *     the trial; a founding year right after "founded" where the brand is
 *     named ("we were founded" too).
 *
 * Each sentence once. `compared` is how many were compared: the check's
 * points are the share that matched.
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
  const prices = approved.filter(isPrice).filter((p) => p.value.amount > 0);
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
  const plans = [...new Set(prices.map((p) => p.value.plan))].filter((p) => p.trim().length > 1);
  const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const shown = (f: BrandFact) => factValueText(f.kind, f.value, f.quote);

  let compared = 0;
  const mismatches: FactMismatch[] = [];
  for (const sentence of new Set(sentences)) {
    const lower = sentence.toLowerCase();
    if (rivals.some((r) => named(lower, r))) continue;
    const brand = named(sentence, brandName);

    if (prices.length && !NOT_A_PRICE.test(sentence)) {
      const places = plans
        .map((plan) => ({ plan, at: planAt(sentence, plan, brand) }))
        .filter((p) => p.at !== -1);
      const billed = BILLED_YEAR.test(sentence)
        ? 'annually'
        : BILLED_MONTH.test(sentence)
          ? 'monthly'
          : null;
      for (const price of pagePrices(sentence)) {
        if (price.amount === 0) continue;
        const nearest = places.length
          ? places.reduce((a, b) => (Math.abs(b.at - price.at) < Math.abs(a.at - price.at) ? b : a))
          : null;
        if (!nearest && !(brand && PRICED.test(sentence) && (price.period || price.from))) continue;
        let pool = prices.filter(
          (p) => p.value.currency === price.currency && (!nearest || p.value.plan === nearest.plan),
        );
        if (price.period)
          pool = pool.filter((p) => !p.value.period || p.value.period === price.period);
        if (billed) pool = pool.filter((p) => !p.value.billed || p.value.billed === billed);
        if (!pool.length) continue;
        compared += 1;
        if (!pool.some((p) => same(p.value.amount, price.amount))) {
          mismatches.push({
            kind: 'price',
            page: price.text,
            fact: shown(pool[0]),
            source: pool[0].sourceKind,
            sentence,
          });
        }
      }
    }

    if (trials.length && (brand || OWN_TRIAL.test(sentence))) {
      const d = TRIAL_DAYS.map((re) => sentence.match(re)).find(Boolean);
      const w = d ? null : TRIAL_WEEKS.map((re) => sentence.match(re)).find(Boolean);
      const days = d ? Number(d[1]) : w ? Number(w[1]) * 7 : null;
      if (days) {
        compared += 1;
        const fact = trials.find((f) => (f.value as { days: number }).days === days);
        if (!fact) {
          mismatches.push({
            kind: 'trial',
            page: `${days}-day`,
            fact: `${(trials[0].value as { days: number }).days}-day`,
            source: trials[0].sourceKind,
            sentence,
          });
        }
      }
    }

    if (years.length && (brand || WE_FOUNDED.test(sentence))) {
      const m = FOUNDED_YEAR.map((re) => sentence.match(re)).find(Boolean);
      const year = m ? (m[1] ?? m[2]) : null;
      if (year) {
        compared += 1;
        if (!years.some((f) => (f.value as { year: number }).year === Number(year))) {
          mismatches.push({
            kind: 'founded',
            page: year,
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
