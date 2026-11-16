/**
 * The web's factMismatches (web/src/lib/content/brand-facts.ts, Trust's
 * "consistent with brand facts", CE-047) on the server, for Ads' claims gate
 * (lib/ads/claims.js): a text's prices, trial and founding year against the
 * brand's approved facts still on its site, read so as never to cry wolf.
 * Kept in step with the web's by the same fixtures
 * (web/src/lib/content/__fixtures__/fact-mismatches.json) and the same
 * patterns, which fact-mismatches.test.js reads from both files: change one
 * side, change the other. Only what factMismatches reads is ported.
 */

/** Currency marks, the longest first ("US$" before "$"), as the API reads them. */
const CURRENCY_MARKS = [
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
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARK = `(?:${CURRENCY_MARKS.map(([m]) => escape(m)).join('|')})`;
const CODE = `(?<![\\p{L}])(?:${ISO.join('|')}|TL)(?![\\p{L}])`;
/** Thousands by a comma or a point, or by a space when the currency comes after ("1 299 €"). */
const amount = (groups) =>
  String.raw`(?<![\d.,'’])(?:\d{1,3}(?:${groups}\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?![\d]|[.,'’]\d)`;
/** A currency after an amount, not one written onto the next ("Ridge 28 $129": $129, not 28 $). */
const PRICE = new RegExp(
  `(?<before>${MARK}|${CODE})\\s?(?<a>${amount("[.,'’]")})|(?<b>${amount("[.,'’\\s]")})\\s?(?<after>${MARK}|${CODE}|zł)(?!\\d)`,
  'gu',
);
/** "$129.00 CAD": the code after a sign says whose dollar it is. */
const CODE_AFTER = new RegExp(`^\\s?(?<code>${ISO.join('|')})(?![\\p{L}])`, 'u');
/** "CAD $129", "MX$1,299": a code before a dollar sign says whose too. */
const CODE_BEFORE = /(?<!\p{L})(USD|CAD|AUD|NZD|SGD|HKD|MXN|MX|HK)\s?$/u;
const DOLLAR_OF = { MX: 'MXN', HK: 'HKD' };
const MAGNITUDE =
  /^\s*(?:[kmb](?!\p{L})|bn\b|mn\b|thousand|million|billion|milyon|milyar|mio\b|mrd\b)/iu;
/** "$10–$20", "between $10 and $20": a range, its two ends (a number before the word or dash). */
const RANGE_AFTER =
  /^\s?(?:[–—-]|to\b|bis\b|ile\b|ila\b|and\b|und\b|et\b|ve\b|à(?=\s)|a(?=\s)|y(?=\s))\s?\S{0,4}\d/iu;
const RANGE_BEFORE = /\d\s?(?:\S{1,3}\s)?(?:[–—-]|to|bis|ile|ila|and|und|et|ve|à|a|y)\s?\S{0,4}$/iu;
/** A sentence whose amounts aren't a plan's price: an old price, a saving, a team's bill. */
const NOT_A_PRICE =
  /(?<!\p{L})(?:was|instead\s+of|regularly|originally|sav(?:e|es|ed|ing|ings)|off|discount|coupon|credits?|incl\.?|including\s+(?:vat|tax)|inkl\.?|kdv\s+dahil|statt|rabatt|indirim|tasarruf|économisez|ahorra|refund|money-back|extra|additional|add-ons?|ek\s+ücret|zusätzlich|setup|set-up|onboarding|implementation|installation|one-time|kurulum)(?!\p{L})|\d+[\s-]?(?:person|people|users?|seats?|members?|kişi(?:lik)?|kullanıcı)(?!\p{L})/iu;
const MONTH =
  /^[^\d$€£¥₹₺]{0,20}?(?:\/\s?(?:mo|mth|month|ay|monat|mois|mes)\b|\b(?:per|a|each)\s+month\b|\bmonthly\b|\baylık\b|\bayda\b|\bmonatlich\b|\b(?:pro|im)\s+monat\b|\bpar\s+mois\b|\b(?:al|por)\s+mes\b)/iu;
const YEAR =
  /^[^\d$€£¥₹₺]{0,20}?(?:\/\s?(?:yr|year|yıl|jahr|an|año)\b|\b(?:per|a|each)\s+year\b|\bannually\b|\byearly\b|\byıllık\b|\byılda\b|\bjährlich\b|\b(?:pro|im)\s+jahr\b|\bpar\s+an\b|\b(?:al|por)\s+año\b)/iu;
/** How a sentence says a price is billed: "billed annually", "with annual billing". */
const BILLED_YEAR =
  /billed\s+(?:annually|yearly)|(?:annual|yearly)\s+(?:billing|plan)|paid\s+(?:annually|yearly)|yıllık\s+ödeme|jährliche\s+zahlung/iu;
const BILLED_MONTH =
  /billed\s+monthly|monthly\s+billing|paid\s+monthly|aylık\s+ödeme|monatliche\s+zahlung/iu;
const FROM =
  /\b(?:from|start(?:s|ing)?\s+(?:at|from)|as\s+low\s+as|(?:begins?|starts?)\s+at|ab|[àa]\s+partire?\s+d[ae]|desde|vanaf)(?:\s+(?:just|only|nur|seulement|solo|slechts))?\s*$/iu;
/** "₺499'dan başlayan", "1.299 TL'den başlıyor": Turkish says it after the price. */
const FROM_AFTER = /^['’]?(?:den|dan|ten|tan)\s+(?:başlayan|başlıyor|itibaren)/iu;

const currencyOf = (mark) =>
  mark === 'TL'
    ? 'TRY'
    : mark === 'zł'
      ? 'PLN'
      : (CURRENCY_MARKS.find(([m]) => m === mark)?.[1] ?? (ISO.includes(mark) ? mark : null));

/** An amount as written: a separator before exactly three digits groups thousands. */
const amountOf = (token) => {
  const value = Number(
    token
      .replace(/['’]/g, '')
      .replace(/[.,\s](?=\d{3}(?!\d))/g, '')
      .replace(',', '.'),
  );
  return Number.isFinite(value) ? value : null;
};

/**
 * The prices a sentence gives, as the web's pagePrices reads them: a scale
 * ("$2M"), a range ("$10–$20") and "$10 off" are none; with `rangeEnds`, a
 * range's ends are read too.
 *
 * @returns {{ text: string, amount: number, currency: string,
 *   period: 'month' | 'year' | null, from: boolean, at: number, loose: boolean }[]}
 */
export function pagePrices(sentence, { rangeEnds = false } = {}) {
  const out = [];
  for (const m of sentence.matchAll(PRICE)) {
    const g = m.groups;
    const end = m.index + m[0].length;
    const before = sentence.slice(Math.max(0, m.index - 24), m.index);
    const after = sentence.slice(end, end + 40);
    if (MAGNITUDE.test(after) || /^\s*off(?!\p{L})/iu.test(after)) continue;
    if (!rangeEnds && (RANGE_AFTER.test(after) || RANGE_BEFORE.test(before))) continue;
    const code = g.before && !ISO.includes(g.before) ? CODE_AFTER.exec(after) : null;
    const codeBefore = g.before === '$' ? CODE_BEFORE.exec(before) : null;
    const dollar = codeBefore && (DOLLAR_OF[codeBefore[1]] ?? codeBefore[1]);
    const currency = code ? code.groups.code : (dollar ?? currencyOf(g.before ?? g.after));
    const value = amountOf(g.a ?? g.b);
    if (!currency || value === null) continue;
    out.push({
      text: code ? `${m[0].trim()}${code[0]}` : m[0].trim(),
      amount: value,
      currency,
      period: MONTH.test(after) ? 'month' : YEAR.test(after) ? 'year' : null,
      from: FROM.test(before) || FROM_AFTER.test(after),
      at: m.index,
      loose:
        /\s/u.test(g.b ?? '') ||
        (!!g.after && /^\s\d/u.test(after) && !/[.,]\d{1,2}$/u.test(g.b ?? '')),
    });
  }
  return out;
}

/** A fact's value as a person reads it ("$49", "14", "2015"; a claim is its words), as the web's. */
export function factValueText(kind, value, quote = '') {
  if (kind === 'price') {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: value.currency,
        maximumFractionDigits: Number.isInteger(value.amount) ? 0 : 2,
      }).format(value.amount);
    } catch {
      return `${value.amount} ${value.currency}`;
    }
  }
  if (kind === 'trial') return String(value.days);
  if (kind === 'founded') return String(value.year);
  return quote;
}

/** Plan names that are everyday words: named only beside "plan" or "tier", or with the brand. */
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
const named = (sentence, name) =>
  name.trim().length > 2 &&
  new RegExp(`(?<![\\p{L}\\p{N}])${escape(name.trim())}(?![\\p{L}\\p{N}])`, 'u').test(sentence);
/** Where a plan is named in a sentence, as the page writes it; -1 when it isn't. */
function planAt(sentence, plan, brandNamed) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(plan)}(?![\\p{L}\\p{N}])`, 'gu');
  for (const m of sentence.matchAll(re)) {
    const common = COMMON_PLANS.has(plan.toLowerCase());
    if (!common || brandNamed || PLAN_WORD.test(sentence.slice(m.index + m[0].length))) {
      return m.index;
    }
  }
  return -1;
}
/** The brand's own price, said right after its name ("Ledgerly costs $29 a month"). */
const PRICED_AFTER_NAME =
  /^['’]?s?\s+(?:(?:monthly|annual|yearly|base|basic)\s+)?(?:(?:plans?|pricing|price|subscriptions?|licen[cs]es?|membership)\s+)?(?:(?:now|currently|only|just)\s+)?(?:costs?|charges?|is\s+priced\s+at|priced\s+at|starts?\s+(?:at|from)|starting\s+at|kostet|coûte|cuesta)\s+(?:(?:just|only|from|ab|desde)\s+)?$/iu;
/** A named plan's own price, said right after its name ("Pro: $49", "The Pro plan is $39/mo"). */
const PRICED_AFTER_PLAN =
  /^(?:\s+(?:plan|tier|package|edition|paket|planı|tarif)(?!\p{L}))?(?:['’]s)?\s*(?:(?:is|:|[–—-]|\()\s*)?(?:(?:now|currently)\s+)?(?:(?:costs?|charges?|is\s+priced\s+at|priced\s+at|starts?\s+(?:at|from)|starting\s+at|kostet|coûte|cuesta)\s+)?(?:(?:just|only|from|ab|desde)\s+)?$/iu;
/** Words that compare a price with another ("$30 more than Starter"). */
const COMPARING = new Set([
  'more',
  'less',
  'cheaper',
  'pricier',
  'than',
  'mehr',
  'weniger',
  'günstiger',
  'teurer',
  'als',
  'daha',
  'moins',
  'más',
  'menos',
]);
/** A price compared with another, within a few words after it: no plan's price. */
const comparedAfter = (sentence, price) =>
  sentence
    .slice(price.at + price.text.length)
    .split(/\s+/)
    .slice(0, 5)
    .some((word) => COMPARING.has(word.toLowerCase().replace(/[^\p{L}]/gu, '')));
/** Where a name is in a sentence, as whole words: each start. */
const namedAt = (sentence, name) =>
  name.trim().length > 2
    ? [
        ...sentence.matchAll(
          new RegExp(`(?<![\\p{L}\\p{N}])${escape(name.trim())}(?![\\p{L}\\p{N}])`, 'gu'),
        ),
      ].map((m) => ({ at: m.index, end: m.index + m[0].length }))
    : [];
const TRIAL_DAYS = [
  /(?<!\d)(\d{1,3})[\s-]?days?[\s-]+(?:free\s+)?trial/iu,
  /trial\s+(?:of|for|lasts?|is)\s+(\d{1,3})\s+days?(?!\p{L})/iu,
  /(?<!\d)(\d{1,3})\s+günlük\s+(?:ücretsiz\s+)?deneme/iu,
  /(?<!\d)(\d{1,3})[\s-]?(?:tage|tägige)\s+(?:kostenlose\s+)?(?:testphase|testversion)/iu,
];
const TRIAL_WEEKS = [
  /(?<!\d)(\d{1,2})[\s-]?weeks?[\s-]+(?:free\s+)?trial/iu,
  /trial\s+(?:of|for|lasts?|is)\s+(\d{1,2})\s+weeks?(?!\p{L})/iu,
];
/** "Free for 14 days": a trial only in a sentence that says "trial", or after "try" and the brand. */
const FREE_FOR = [
  [/free\s+for\s+(\d{1,3})\s+days?(?!\p{L})/iu, 1],
  [/free\s+for\s+(\d{1,2})\s+weeks?(?!\p{L})/iu, 7],
];
const SAYS_TRIAL = /trial|deneme|testphase|testversion/iu;
/** A trial said of the brand's plans: "your free trial", "every plan". */
const OWN_TRIAL =
  /\b(?:your|our)\s+(?:free\s+)?trial\b|\b(?:every|all|each)\s+plans?\b|\bher\s+plan|\btüm\s+planlar/iu;
/** Every trial length a text gives, in days; "free for N days" where `tried` says it's a trial. */
const trialLengths = (text, tried) => [
  ...TRIAL_DAYS.flatMap((re) =>
    [...text.matchAll(new RegExp(re.source, 'giu'))].map((m) => ({
      days: Number(m[1]),
      at: m.index,
    })),
  ),
  ...TRIAL_WEEKS.flatMap((re) =>
    [...text.matchAll(new RegExp(re.source, 'giu'))].map((m) => ({
      days: Number(m[1]) * 7,
      at: m.index,
    })),
  ),
  ...FREE_FOR.flatMap(([re, unit]) =>
    [...text.matchAll(new RegExp(re.source, 'giu'))]
      .filter((m) => tried(text.slice(0, m.index)))
      .map((m) => ({ days: Number(m[1]) * unit, at: m.index })),
  ),
];
/** A length said of someone's own: "…; Ledgerly's runs for 14 days". */
const OWNED_LENGTH =
  /(?:['’]s|\b(?:its|theirs|ours|yours))\s+(?:[\p{L}-]+\s+)?(?:runs?|lasts?|is|are)\s+(?:for\s+)?(?:(?:just|only)\s+)?(\d{1,3})[\s-]?(days?|weeks?)(?!\p{L})/giu;
/** Where a sentence turns to another subject: a trial is the brand's only in a part that names it. */
const TURN =
  /[;:–—]|,\s*(?:and|but|while|whereas|which|whose|who)\b|\b(?:but|while|whereas|unlike|than|compared\s+(?:to|with))\b/iu;
/** The brand's own founding year, said right after who, who at the start of its clause. */
const foundedOf = (brandName, we) => {
  const name = brandName.trim().length > 2 ? escape(brandName.trim()) : null;
  const nameStart = `(?:^|[,;:(–—]\\s*|(?<![\\p{L}\\p{N}])(?:and|since|when|after|as|ve)\\s+)`;
  const weStart = `(?:^|(?<![\\p{L}\\p{N}])(?:and|since|when|after|ve)\\s+)`;
  const forms = [
    [
      ['we', 'our\\s+company'],
      `\\s+(?:was|were)\\s+(?:founded|established)\\s+(?:in\\s+)?((?:18|19|20)\\d{2})(?!\\d)`,
    ],
    [
      ['biz', 'şirketimiz'],
      `\\s+((?:18|19|20)\\d{2})['’]?(?:de|da|te|ta)?\\s+(?:yılında\\s+)?kurul(?:du|muştur|duk)`,
    ],
    [['wir'], `\\s+(?:wurde|wurden)\\s+(?:im\\s+jahr\\s+)?((?:18|19|20)\\d{2})\\s+gegründet`],
  ];
  return forms.flatMap(([ours, said]) => {
    const who = [
      ...(name ? [`${nameStart}(?:${name})`] : []),
      ...(we ? [`${weStart}(?:${ours.join('|')})`] : []),
    ];
    return who.length ? [new RegExp(`(?:${who.join('|')})${said}`, 'iu')] : [];
  });
};
/** Quoted speech in a sentence. */
const QUOTED = /["“”«»„]/u;

/**
 * The sentences' prices, trial and founding year against the brand's
 * approved facts still on its site, as the web's factMismatches reads them
 * (its comment has the rules): each sentence once; `compared` is how many
 * were compared.
 *
 * @param {{ sentences: string[], facts: { kind: string, value: object, quote: string,
 *   sourceKind: string, status: string, gone: boolean }[], brandName: string,
 *   competitorDomains: string[] }} input
 * @returns {{ compared: number, mismatches: { kind: 'price' | 'trial' | 'founded',
 *   page: string, fact: string, source: string, sentence: string }[] }}
 */
export function factMismatches({ sentences, facts, brandName, competitorDomains }) {
  const approved = facts.filter((f) => f.status === 'approved' && !f.gone);
  const prices = approved.filter((f) => f.kind === 'price').filter((p) => p.value.amount > 0);
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
  const founded = foundedOf(brandName, true);
  const foundedNamed = foundedOf(brandName, false);
  const same = (a, b) => Math.abs(a - b) < 0.005;
  const shown = (f) => factValueText(f.kind, f.value, f.quote);

  let compared = 0;
  const mismatches = [];
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
      const found = pagePrices(sentence).filter((price) => price.amount > 0);
      const sure = found.length === Math.max(places.length, 1);
      const planOf = new Map();
      const pairs = places
        .flatMap((place) => found.map((price) => ({ place, price })))
        .sort((a, b) => Math.abs(a.price.at - a.place.at) - Math.abs(b.price.at - b.place.at));
      const paired = new Set();
      for (const { place, price } of pairs) {
        if (planOf.has(price.at) || paired.has(place.plan)) continue;
        const [from, to] = [Math.min(place.at, price.at), Math.max(place.at, price.at)];
        if (found.some((other) => other !== price && other.at > from && other.at < to)) continue;
        planOf.set(price.at, place);
        paired.add(place.plan);
      }
      const names = namedAt(sentence, brandName);
      const between = (end, price) => sentence.slice(end, price.at).replace(/[$€£¥₹₺]\s*$/u, '');
      for (const price of sure ? found : []) {
        const nearest = places.length ? (planOf.get(price.at) ?? null) : null;
        if (places.length && !nearest) continue;
        if (
          nearest &&
          !(
            nearest.at < price.at &&
            PRICED_AFTER_PLAN.test(between(nearest.at + nearest.plan.length, price))
          )
        ) {
          continue;
        }
        if (
          !nearest &&
          !names.some((n) => n.end <= price.at && PRICED_AFTER_NAME.test(between(n.end, price)))
        ) {
          continue;
        }
        if (comparedAfter(sentence, price)) continue;
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
      const owned = (text, trial) =>
        [...text.matchAll(OWNED_LENGTH)]
          .filter((m) => !trial || /trial/iu.test(m[0]))
          .map((m) => ({ days: Number(m[1]) * (/^week/i.test(m[2]) ? 7 : 1), at: m.index }));
      const tryBrand =
        brandName.trim().length > 2
          ? new RegExp(`(?:try|use)\\s+${escape(brandName.trim())}\\s+$`, 'iu')
          : null;
      const tried = (before) => SAYS_TRIAL.test(sentence) || !!tryBrand?.test(before);
      const lengths = new Set(
        [...trialLengths(sentence, tried), ...owned(sentence, false)].map((l) => l.days),
      );
      const own = new Set(
        sentence.split(TURN).flatMap((part) => {
          const anchors = [
            ...namedAt(part, brandName).map((n) => n.at),
            ...[...part.matchAll(new RegExp(OWN_TRIAL.source, 'giu'))].map((m) => m.index),
          ];
          if (!anchors.length) return [];
          const from = Math.min(...anchors);
          return [...trialLengths(part, tried), ...owned(part, true)]
            .filter((l) => l.at >= from)
            .map((l) => l.days);
        }),
      );
      const days = lengths.size === 1 && own.size === 1 ? [...own][0] : null;
      if (days) {
        compared += 1;
        const fact = trials.find((f) => f.value.days === days);
        if (!fact) {
          mismatches.push({
            kind: 'trial',
            page: `${days}-day`,
            fact: `${trials[0].value.days}-day`,
            source: trials[0].sourceKind,
            sentence,
          });
        }
      }
    }

    if (years.length) {
      const m = (QUOTED.test(sentence) ? foundedNamed : founded)
        .map((re) => sentence.match(re))
        .find(Boolean);
      const year = m ? m[1] : null;
      if (year) {
        compared += 1;
        if (!years.some((f) => f.value.year === Number(year))) {
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
