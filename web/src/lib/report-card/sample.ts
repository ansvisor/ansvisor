import type { ReportCardEngine, ReportCardPayload } from './payload';

/**
 * A made-up card for tests and the sample PDF: a coffee shop that sells
 * online, asked in the United States, as a card makes it since Copilot was
 * dropped (25 questions by product, four engines, Starter's two, ChatGPT and
 * Gemini, heading it). Every name and site is invented, and the sites are on
 * the reserved .example domain.
 */

/** The sample's questions: [text, product, searches a month, fit]. */
const QUESTIONS: [string, number, number | null, 'core' | 'related'][] = [
  ['best coffee beans for espresso at home', 0, 2900, 'core'],
  ['where to buy specialty coffee online', 0, 1300, 'core'],
  ['best coffee for cold brew', 0, 2400, 'core'],
  ['best medium roast coffee beans', 0, 880, 'core'],
  ['best decaf coffee beans', 0, 720, 'core'],
  ['best organic coffee brands', 0, 480, 'core'],
  ['best coffee beans for a french press', 0, 390, 'core'],
  ['best light roast coffee for pour over', 0, 320, 'core'],
  ['best whole bean coffee for drip machines', 0, 210, 'core'],
  ['where to buy fresh roasted coffee beans online', 0, 880, 'core'],
  ['best espresso blend for milk drinks', 0, 110, 'core'],
  ['best low acid coffee brands', 0, 590, 'core'],
  ['best fair trade coffee', 0, 480, 'core'],
  ['how long do roasted coffee beans stay fresh', 0, 1000, 'related'],
  ['best coffee subscription services in the US', 1, 1600, 'core'],
  ['freshest coffee delivered to your door', 1, 590, 'core'],
  ['which coffee roasters ship fast', 1, 140, 'core'],
  ['affordable specialty coffee subscription', 1, 260, 'core'],
  ['best coffee subscription for beginners', 1, 170, 'core'],
  ['is a coffee subscription worth it', 1, 320, 'related'],
  ['best coffee gift box', 2, 1900, 'core'],
  ['coffee gift sets for coffee lovers', 2, 590, 'core'],
  ['best coffee gift subscription', 2, 260, 'core'],
  ['corporate coffee gifts for clients', 2, 90, 'core'],
  ['coffee sampler gift box', 2, null, 'core'],
];

const ENGINES = [
  'chatgpt-web',
  'gemini-web',
  'google-aio',
  'google-aimode',
] as const satisfies readonly ReportCardEngine[];
type SampleEngine = (typeof ENGINES)[number];

/** Questions each engine named Brewline in (by index). */
const NAMED: Record<SampleEngine, number[]> = {
  'chatgpt-web': [0, 1, 14, 20, 21, 2],
  'gemini-web': [14, 20],
  'google-aio': [1, 3, 14, 20, 9],
  'google-aimode': [21, 15],
};
/** Google gave no AI Overview for these. */
const NO_OVERVIEW = [12, 18, 24];
const INSTEAD = ['Ridgeline Roasters', 'Copper Kettle Coffee', 'Harborline Beans', 'Sunday Grind'];

const questionRows = QUESTIONS.map(([text, product, volume, fit], i) => ({
  text,
  textEn: null,
  product,
  volume,
  fit,
  named: Object.fromEntries(
    ENGINES.map((engine) => [
      engine,
      engine === 'google-aio' && NO_OVERVIEW.includes(i)
        ? 'none'
        : NAMED[engine].includes(i)
          ? 'named'
          : 'missed',
    ]),
  ) as Record<SampleEngine, 'named' | 'missed' | 'none'>,
  instead: INSTEAD[i % INSTEAD.length],
}));

const engineRow = (engine: SampleEngine) => ({
  engine,
  answers: questionRows.filter((row) => row.named[engine] !== 'none').length,
  named: NAMED[engine].length,
});

export const SAMPLE_REPORT_CARD: ReportCardPayload = {
  companyName: 'Brewline Coffee',
  domain: 'brewlinecoffee.example',
  country: { code: 'US', name: 'United States' },
  language: 'English',
  audience: 'buyers',
  siteType: 'ecommerce',
  generatedAt: '2026-11-04T09:00:00Z',
  questionCount: 25,
  products: [
    { name: 'Whole bean coffee', nameEn: null, url: 'https://brewlinecoffee.example/beans' },
    {
      name: 'Coffee subscriptions',
      nameEn: null,
      url: 'https://brewlinecoffee.example/subscribe',
    },
    { name: 'Gift boxes', nameEn: null, url: null },
  ],
  engines: ENGINES.map(engineRow),
  mainEngines: ['chatgpt-web', 'gemini-web'],
  // Counted over Starter's 50 answers, as the headline (analyze.js summarize).
  competitors: [
    { name: 'Ridgeline Roasters', answers: 21 },
    { name: 'Copper Kettle Coffee', answers: 17 },
    { name: 'Harborline Beans', answers: 13 },
    { name: 'Sunday Grind', answers: 6 },
  ],
  marketplaces: [{ name: 'Bean Market', answers: 5 }],
  otherNames: [{ name: 'Burr & Co Grinders', answers: 3 }],
  citedSites: [
    {
      domain: 'ridgelineroasters.example',
      answers: 13,
      own: false,
      competitor: true,
      kind: 'competitor',
    },
    { domain: 'coffeereview.example', answers: 11, own: false, kind: 'guide' },
    { domain: 'homebarista.example', answers: 9, own: false, kind: 'community' },
    { domain: 'brewguide.example', answers: 7, own: false, kind: 'publication' },
    { domain: 'beanmarket.example', answers: 5, own: false, kind: 'marketplace' },
    { domain: 'brewlinecoffee.example', answers: 2, own: true, kind: 'own' },
    { domain: 'coffeeassociation.example', answers: 2, own: false, kind: 'official' },
    { domain: 'roasterreviews.example', answers: 1, own: false, kind: 'reviews' },
  ],
  ownCitations: 2,
  missedQuestions: [
    {
      text: 'where to buy fresh roasted coffee beans online',
      textEn: null,
      product: 0,
      volume: 880,
      competitors: ['Ridgeline Roasters', 'Harborline Beans', 'Copper Kettle Coffee'],
      answers: 2,
    },
    {
      text: 'best coffee subscription for beginners',
      textEn: null,
      product: 1,
      volume: 170,
      competitors: ['Ridgeline Roasters', 'Copper Kettle Coffee'],
      answers: 2,
    },
    {
      text: 'best organic coffee brands',
      textEn: null,
      product: 0,
      volume: 480,
      competitors: ['Copper Kettle Coffee', 'Sunday Grind'],
      answers: 2,
    },
    {
      text: 'corporate coffee gifts for clients',
      textEn: null,
      product: 2,
      volume: 90,
      competitors: ['Harborline Beans'],
      answers: 2,
    },
    {
      text: 'how long do roasted coffee beans stay fresh',
      textEn: null,
      product: 0,
      volume: 1000,
      competitors: [],
      answers: 2,
    },
  ],
  missedCount: 19,
  questionRows,
  cpc: { usd: 1.85, keywords: 19 },
  dealValue: { amount: 38, currency: 'USD' },
};
