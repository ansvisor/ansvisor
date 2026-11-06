/**
 * Every word the report card prints, by language (owner decision
 * 2026-11-04: the whole card in the target language). English is the
 * default; another language adds a CardCopy of its own (./copy-*.ts) and
 * is picked by the card's country in cardCopy(). Numbers, money and dates
 * are formatted by the copy's locale. Sentences are functions of their
 * figures, so a language orders them its own way.
 */

import { tr } from './copy-tr';

/** "A", "A and B", "A, B and C". */
export function listEn(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The answers a base falls short of its questions × engines by, said
 * plainly: the product is printed only when every question was answered.
 */
const noAnswer = (missing: number) =>
  missing === 1
    ? '1 question got no answer from one engine'
    : `an engine gave no answer ${missing} times`;

/** Ansvisor's areas, as a finding's tag names them. */
export type FeatureTag =
  | 'contentEditor'
  | 'citations'
  | 'siteAudit'
  | 'competitors'
  | 'brandVisibility';

/** A cited site's kind, as page 3's target list heads it. */
export type TargetKind = 'guide' | 'publication' | 'official' | 'community' | 'reviews';

/** Countries whose English name takes "the": "in the United States". */
const WITH_THE = new Set(['US', 'GB', 'NL', 'AE', 'PH', 'CZ', 'DO', 'BS', 'GM', 'CF', 'KM', 'MV']);

/** A step for a site to get onto, by its kind. */
interface TargetStep {
  title: (company: string, domain: string) => string;
  detail: (cited: number, answers: number) => string;
  week: (company: string, domain: string) => string;
}

export const en = {
  /** BCP 47 locale for numbers, money and dates. */
  locale: 'en-US',
  list: listEn,
  /** The country as a sentence names it: "the United States", "Türkiye". */
  country: (country: { code: string; name: string }) =>
    WITH_THE.has(country.code.toUpperCase()) ? `the ${country.name}` : country.name,
  /** The language the questions were asked in, as the card names it. */
  language: (english: string) => english,
  document: (company: string) => `AI visibility report card: ${company}`,
  footer: (page: number, pages: number) => `${page} / ${pages}`,
  /** The footer's brand line; null keeps Ansvisor's own ("Generated with Ansvisor"). */
  brand: null as string | null,
  engines: {
    count: (n: number) => plural(n, 'AI engine', 'AI engines'),
    /** "the three engines": how many a card made before Starter's headed it asked. */
    the: (n: number) => `the ${{ 2: 'two', 3: 'three', 4: 'four', 5: 'five' }[n] ?? n} engines`,
  },

  // ─── Page 1 ────────────────────────────────────────────────────────────────
  status: {
    eyebrow: 'Free AI visibility report card',
    title: (company: string) => `How visible is ${company} in AI answers?`,
    subtitle: (domain: string, country: string, language: string, date: string) =>
      `${domain} · ${country}, in ${language} · ${date}`,
    oneTime: (date: string) =>
      `A one-time snapshot: we asked each question once, on ${date}. AI answers change from day to day; in Ansvisor they are asked every day.`,
    understood: (domain: string, readers: boolean) =>
      readers
        ? `How we understood ${domain}: a publication on`
        : `How we understood ${domain}: you sell`,
    understoodNote: 'The questions on page 2 are about these.',
    kpiVisibility: 'AI visibility',
    /**
     * The headline's base spelled out: the questions times the engines it
     * counts when each answered them all, else how many got no answer.
     */
    kpiVisibilitySub: (
      engines: string,
      named: number,
      answers: number,
      questions: number,
      engineCount: number,
    ) => {
      const missing = questions * engineCount - answers;
      if (missing === 0) {
        return `named in ${named} of ${answers} answers: ${questions} questions × ${plural(engineCount, 'engine', 'engines')} (${engines})`;
      }
      return `named in ${named} of ${answers} answers from ${engines}${missing > 0 ? ` (${noAnswer(missing)})` : ''}`;
    },
    kpiQuestions: 'Questions asked',
    kpiQuestionsSub: (engines: number, answers: number, unanswered: number) =>
      `in ${plural(engines, 'AI engine', 'AI engines')}: ${answers} answers${unanswered > 0 ? ` (${unanswered} got no answer)` : ''}`,
    kpiLeader: 'Top competitor',
    kpiLeaderNone: 'None named',
    kpiLeaderSub: (answers: number, total: number) =>
      `named in ${answers} of the same ${total} answers`,
    kpiLeaderNoneSub: 'in these answers',
    kpiCited: 'Your site cited',
    kpiCitedSub: (total: number) => `of the same ${total} answers cite a page of yours`,
    startTitle: 'Your starting point',
    startCited: (engines: string, cited: number) =>
      `${engines} don’t name you yet, but AI already reads your site: it cited your pages in ${plural(cited, 'answer', 'answers')} without saying your name. That is where to start.`,
    startNone: (engines: string) =>
      `${engines} don’t name you yet. Every brand in AI answers started here: the steps on page 3 are your first week.`,
    firstStep: 'Your first step:',
    byEngine: 'Visibility by engine',
    engineValue: (named: number, answers: number, pct: number) =>
      `${named} of ${answers} · ${pct}%`,
    growthBand: (starter: string) =>
      `In Ansvisor Growth: Google’s AI engines, measured too. Starter tracks ${starter}; Growth adds these.`,
    whoNamed: 'Who AI names',
    noCompetitor: 'No competitor was named.',
    you: (name: string) => `${name} (you)`,
    answersCount: (n: number) => plural(n, 'answer', 'answers'),
    sitesCited: 'Sites AI cites most',
    noSites: 'No sites were cited.',
    siteTag: {
      own: ' (you)',
      competitor: ' (competitor)',
      marketplace: ' (marketplace)',
    } as Record<string, string>,
    alsoMarketplaces: (names: string) => `Marketplaces also named: ${names}`,
    alsoOthers: (names: string) => `Other businesses named: ${names}`,
    missedTitle: 'Where AI names others, not you',
    missedSub: (missed: number, total: number) =>
      `${missed} of ${total} questions got no answer that names you. The five your competitors win most:`,
    missedInstead: (names: string) => `Named instead: ${names}`,
    missedNone: 'No answer named anyone else.',
    measured: (
      questions: number,
      readers: boolean,
      engines: string,
      country: string,
      date: string,
    ) =>
      `How we measured: ${questions} questions a ${readers ? 'reader' : 'buyer'} might ask, asked once each in ${engines} in ${country}, on ${date}. Visibility is the share of answers that name you, by your name or your site; competitors and sites are counted over the same answers. All the questions are on page 2.`,
  },

  // ─── The findings (pages 1 and 3) ───────────────────────────────────────────
  wins: {
    question: {
      title: (question: string) => `Answer “${question}” on your site`,
      detailNames: (names: string, company: string) =>
        `AI names ${names} for it, and not ${company}.`,
      detailNone: (company: string) => `None of the answers to it names ${company}.`,
      week: (page: string | null) =>
        page
          ? `Write one page that answers it directly, the question as its heading and the answer in the first paragraph, and link it from ${page}.`
          : 'Write one page that answers it directly, the question as its heading and the answer in the first paragraph.',
    },
    target: {
      guide: {
        title: (company, domain) => `Get ${company} reviewed or listed on ${domain}`,
        detail: (cited, answers) =>
          `A guide AI cites in ${cited} of ${answers} answers about your market. A listing or a review there gives it a source that names you.`,
        week: (company, domain) =>
          `Find the page on ${domain} that compares businesses like ${company}, and ask to be added or reviewed.`,
      },
      publication: {
        title: (_company, domain) => `Pitch ${domain} a story or an expert comment`,
        detail: (cited, answers) =>
          `A publication AI cites in ${cited} of ${answers} answers about your market. An article or a quote there is a source it trusts.`,
        week: (_company, domain) =>
          `Send ${domain}’s editors one short pitch: a figure or a story only your business has.`,
      },
      official: {
        title: (company, domain) => `Make sure ${domain} lists ${company} correctly`,
        detail: (cited, answers) =>
          `An official source AI cites in ${cited} of ${answers} answers. Your registrations, memberships and licences there are facts it repeats.`,
        week: (_company, domain) =>
          `Look yourself up on ${domain}, and correct or complete your listing.`,
      },
      community: {
        title: (_company, domain) => `Answer questions about your market on ${domain}`,
        detail: (cited, answers) =>
          `A community AI cites in ${cited} of ${answers} answers. Helpful, open answers from your team are what gets quoted.`,
        week: (_company, domain) =>
          `Answer two open questions about your market on ${domain}, as your team and saying so.`,
      },
      reviews: {
        title: (company, domain) =>
          `Check and answer what customers say about ${company} on ${domain}`,
        detail: (cited, answers) =>
          `A reviews site AI cites in ${cited} of ${answers} answers. What customers say there, and how you answer, is what it reads about you.`,
        week: (_company, domain) =>
          `Reply to the latest reviews and complaints on ${domain}, and complete your profile.`,
      },
      other: {
        title: (company, domain) => `Get ${company} mentioned on ${domain}`,
        detail: (cited, answers) =>
          `AI cites it in ${cited} of ${answers} answers about your market. A mention or a listing there puts you in front of it.`,
        week: (_company, domain) => `Find out how businesses get mentioned on ${domain}, and ask.`,
      },
    } as Record<TargetKind | 'other', TargetStep>,
    ownName: {
      title: 'Put your name where AI already reads you',
      detail: (cited: number, company: string) =>
        `AI cited your pages in ${plural(cited, 'answer', 'answers')} without naming ${company}.`,
      week: 'On the pages AI cites, say who you are: your brand name in the title, the first sentence and the headings.',
    },
    ownPages: {
      title: 'Make your own pages easy to cite',
      detail: (cited: number, answers: number) =>
        `Your site is cited in ${cited} of ${answers} answers.`,
      week: 'Pick the three pages AI should cite: put the answer in the first paragraph, and add a short FAQ with this card’s questions.',
    },
    gap: {
      title: (rival: string) => `Close the gap on ${rival}`,
      detail: (rival: string, rivalNamed: number, company: string, named: number) =>
        `${rival} is named in ${rivalNamed} answers, ${company} in ${named}.`,
      week: (rival: string) =>
        `Open ${rival}’s page for a question it wins, and list what it says that yours doesn’t.`,
    },
    weakest: {
      title: (engine: string) => `Look at what ${engine} says about your market`,
      detail: (named: number, answers: number, engines: string) =>
        `It names you in ${named} of ${answers} answers, the fewest of ${engines}.`,
      week: (engine: string) =>
        `Ask ${engine} three of this card’s questions yourself, and note the sites it cites.`,
    },
    keep: {
      title: (company: string) => `Keep ${company} where it is`,
      detail: (named: number, answers: number) =>
        `AI names you in ${named} of ${answers} answers, alike in every engine.`,
      week: 'Track this card’s questions every day: answers change as engines update.',
    },
  },

  // ─── Page 2 ────────────────────────────────────────────────────────────────
  questions: {
    eyebrow: 'What we asked',
    title: (n: number) => `The ${n} questions, and what each engine said`,
    subtitle: (domain: string, country: string, language: string, products: boolean) =>
      products
        ? `Written from the main products on ${domain}, kept for how closely they match what you sell and how often people search for them, and asked in ${country}, in ${language}.`
        : `As asked in ${country}, in ${language}.`,
    summaryNone: (
      company: string,
      answers: number,
      total: number,
      engines: string,
      engineCount: number,
    ) => {
      const missing = total * engineCount - answers;
      const base =
        missing === 0
          ? `${total} questions × ${plural(engineCount, 'engine', 'engines')}`
          : missing > 0
            ? noAnswer(missing)
            : null;
      return `${company} wasn’t named in any of the ${total} questions: ${answers} answers from ${engines}${base ? ` (${base})` : ''}.`;
    },
    summary: (named: number, answers: number, questions: number, total: number, engines: string) =>
      `Named in ${questions} of the ${total} questions: in ${named} of the ${answers} answers from ${engines}.`,
    legendNamed: 'Named you',
    legendMissed: 'Answered, didn’t name you',
    legendNone: 'No answer',
    colQuestion: 'Question',
    colSearches: 'Searches',
    colInstead: 'Named instead',
    searchesNote: 'Searches: Google searches a month for the question’s keyword in your country.',
    groupCount: (n: number) => plural(n, 'question', 'questions'),
    related: 'a need your buyers also have',
    growthKey: 'Lighter columns: Google’s engines, in Growth',
  },

  // ─── Page 3 ────────────────────────────────────────────────────────────────
  plan: {
    eyebrow: 'Your plan',
    title: 'Three findings, and what you’d do in week one',
    subtitle: (company: string) =>
      `Picked from ${company}’s results by fixed rules: what the card found, the first thing to do about it, and where Ansvisor helps.`,
    finding: 'Finding',
    weekOne: 'Week one',
    inAnsvisor: 'In Ansvisor',
    feature: {
      contentEditor: 'Content Editor',
      citations: 'Citations',
      siteAudit: 'Site Audit',
      competitors: 'Competitors',
      brandVisibility: 'Visibility',
    } as Record<FeatureTag, string>,
    targetsTitle: 'Where AI looks: sites you can get onto',
    targetsSub: 'The sites AI cites in your answers, sorted by what you can do there.',
    targetKind: {
      guide: 'Guides and comparisons',
      publication: 'Publications',
      official: 'Official sources',
      community: 'Communities',
      reviews: 'Reviews',
      other: 'Sites AI cites',
    } as Record<TargetKind | 'other', string>,
    targetsNone: 'None cited',
    targetsLeftOut: (names: string) =>
      `Left out: ${names}. A competitor’s site or a marketplace is no place to get onto.`,
    howTitle: 'How the work gets done',
    approveTitle: 'You approve each step',
    approveBody:
      'Agents start in Ask me first or Auto, ask before changes: a run that would change something shows Needs you and waits for your click. Nothing turns on by itself, and every change is in the Activity log, with Undo. In every plan.',
    autoTitle: 'Or let agents publish on their own',
    autoBody:
      'In Full auto, with two switches an Admin turns on, chosen agents send or publish pages to your CMS without a click, 1 to 20 a day. A page that fails Quality or your brand facts still waits for you. In Growth.',
    examplePrompt: 'A prompt Ansvisor would track for you, every day:',
  },

  // ─── Page 4 ────────────────────────────────────────────────────────────────
  value: {
    eyebrow: 'What it’s worth',
    title: 'What AI visits are worth, and the plan that matches this card',
    subtitle:
      'AI visits priced at what the same clicks cost in Google Ads, and the plan this card measured.',
    demand: (searches: string, country: string, keywords: number) =>
      `Your questions’ keywords get ${searches} Google searches a month in ${country} (${plural(keywords, 'keyword', 'keywords')} with a volume).`,
    cpcLine: (cpc: string, keywords: number, total: number) =>
      `Google Ads’ median cost per click for them: ${cpc} (${keywords} of ${total} keywords had one).`,
    colShare: 'If AI sent you',
    colVisits: 'AI visits a month',
    colAds: 'Same clicks in Ads, a month',
    colYear: 'A year',
    share: (pct: number) => `${pct}% of those searches`,
    buying: 'Buying them',
    buyingBody: (visits: string, ads: string, year: string) =>
      `${visits} visits a month cost about ${ads} in Google Ads, every month: ${year} a year, bought again each month.`,
    earning: 'Earning them',
    earningBody: (plan: string, price: string) =>
      `Ansvisor ${plan} is ${price} a month. Pages AI engines cite keep sending visits for as long as they’re cited.`,
    cheap: (ads: string, plan: string, price: string) =>
      `Clicks are cheap in your market: these visits would cost about ${ads} a month in Ads, less than ${plan} at ${price}. What ads can’t buy is being the name AI recommends when your buyers ask.`,
    slow: 'AI visits build over months: the first month is setup and the first pages, not visits yet.',
    noAds: (country: string) =>
      `Not enough ad data for your questions in ${country}: no visits are priced on this card.`,
    oddAds: (cpc: string, keywords: number) =>
      `The ad prices found for your keywords look wrong (a median of ${cpc} from ${plural(keywords, 'keyword', 'keywords')}): no visits are priced on this card.`,
    tableNote:
      'Scenarios, not a forecast: what these visits would cost in ads if AI answers sent them to you.',
    revenueTitle: 'A revenue scenario',
    revenue: (kind: 'order' | 'deal', value: string, low: string, high: string) =>
      `Your average ${kind} value: ${value}. Assumption: ${low} to ${high} of AI visits ${kind === 'order' ? 'place an order' : 'become a deal'}, no better than other visits.`,
    revenueRow: (visits: string, low: string, high: string) =>
      `${visits} AI visits a month: ${low}–${high} a month`,
    scenarios:
      'Scenarios, not a forecast or a guarantee. AI Traffic in Ansvisor measures your real AI visits once it’s set up.',
    planTitle: 'The plan that matches this card',
    starterMatch: (engines: string, headed: boolean) =>
      headed
        ? `Tracks ${engines} every day: the engines this card’s visibility counts.`
        : `Tracks ${engines} every day.`,
    perMonth: (price: string) => `${price}/month`,
    yearly: (price: string) => `or ${price} a year, paid yearly: 20% off`,
    starterLimits: (prompts: number, brands: number) =>
      `${prompts} prompts tracked every day, ${plural(brands, 'brand', 'brands')}, Chat and Agent Center.`,
    googleEngines: 'Gemini, Google AI Overviews and Google AI Mode',
    growthLine: (engines: string, price: string, yearly: string, prompts: number, brands: number) =>
      `Growth, ${price}/month or ${yearly} a year (20% off), adds ${engines} (the Growth band on page 1), ${prompts} prompts, ${plural(brands, 'brand', 'brands')} and Full auto agents.`,
    ctaTitle: 'Measure your own questions',
    ctaBody: (prompts: number, engines: string, questions: number) =>
      `Start the free trial: Starter tracks ${prompts} prompts every day in ${engines}, so this card’s ${questions} questions and ${Math.max(prompts - questions, 0)} of your own fit in.`,
    steps: (domain: string, questions: number, country: string) => [
      `Add ${domain} as your brand: the setup wizard usually takes a few minutes.`,
      `Track this card’s ${questions} questions as prompts in ${country}, and add your own.`,
      'Open the Action Center after the first run: what to do next, ranked.',
    ],
    ctaLink: 'Start a free trial at app.ansvisor.com',
  },
};

export type CardCopy = typeof en;

const BY_COUNTRY: Record<string, CardCopy> = { TR: tr };

/**
 * The card's words, by its country: Turkish for Türkiye, English
 * elsewhere. Another language adds a ./copy-*.ts and its countries here.
 */
export function cardCopy(card?: { country: { code: string } }): CardCopy {
  const code = card?.country.code.toUpperCase() ?? '';
  return BY_COUNTRY[code] ?? en;
}
