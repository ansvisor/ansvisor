import { REPORT_CARD_ENGINES, type ReportCardPayload } from './payload';

/** The sample's 25 questions: the first 14 name Brewline in some engine, the rest in none. */
const QUESTIONS = [
  'best coffee beans for espresso at home',
  'best coffee subscription services in the US',
  'where to buy specialty coffee online',
  'best medium roast coffee beans',
  'best decaf coffee beans',
  'freshest coffee delivered to your door',
  'best coffee gift box',
  'best organic coffee brands',
  'best coffee for cold brew',
  'best coffee beans for a french press',
  'which coffee roasters ship fast',
  'best light roast coffee for pour over',
  'affordable specialty coffee subscription',
  'best whole bean coffee for drip machines',
  'where to buy fresh roasted coffee beans online',
  'best coffee subscription for beginners',
  'is single origin coffee worth the price',
  'how long do roasted coffee beans stay fresh',
  'best espresso blend for milk drinks',
  'best low acid coffee brands',
  'best fair trade coffee',
  'which coffee beans make the best latte',
  'best coffee for a moka pot',
  'what coffee do baristas recommend',
  'best coffee beans under 20 dollars',
];
const NAMED: Record<(typeof REPORT_CARD_ENGINES)[number], number[]> = {
  'chatgpt-web': [0, 1, 2, 3, 4, 5, 6],
  'gemini-web': [0, 2, 7, 8],
  'google-aio': [1, 3, 9, 10, 11],
  'google-aimode': [12, 13],
};
/** Each question's product: 0 beans, 1 subscriptions, 2 gifts. */
const PRODUCT = [0, 1, 0, 0, 0, 1, 2, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const VOLUME = [
  2900,
  1600,
  1300,
  880,
  720,
  590,
  1900,
  480,
  2400,
  390,
  140,
  320,
  260,
  210,
  880,
  170,
  90,
  1000,
  110,
  590,
  480,
  320,
  260,
  210,
  null,
];
const INSTEAD = ['Ridgeline Roasters', 'Copper Kettle Coffee', 'Harborline Beans', 'Sunday Grind'];

/**
 * A made-up card for tests and the sample PDF: a coffee shop that sells
 * online, asked in the United States. Every name and site is invented, and
 * the sites are on the reserved .example domain.
 */
export const SAMPLE_REPORT_CARD: ReportCardPayload = {
  companyName: 'Brewline Coffee',
  domain: 'brewlinecoffee.example',
  country: { code: 'US', name: 'United States' },
  language: 'English',
  siteType: 'ecommerce',
  generatedAt: '2026-11-03T09:00:00Z',
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
  engines: [
    { engine: 'chatgpt-web', answers: 25, named: 7 },
    { engine: 'gemini-web', answers: 25, named: 4 },
    { engine: 'google-aio', answers: 25, named: 5 },
    { engine: 'google-aimode', answers: 25, named: 2 },
  ],
  competitors: [
    { name: 'Ridgeline Roasters', answers: 41 },
    { name: 'Copper Kettle Coffee', answers: 33 },
    { name: 'Harborline Beans', answers: 27 },
    { name: 'Sunday Grind', answers: 12 },
  ],
  citedSites: [
    { domain: 'coffeereview.example', answers: 23, own: false },
    { domain: 'homebarista.example', answers: 19, own: false },
    { domain: 'brewguide.example', answers: 14, own: false },
    { domain: 'beanmarket.example', answers: 9, own: false },
    { domain: 'brewlinecoffee.example', answers: 4, own: true },
  ],
  ownCitations: 4,
  missedQuestions: [
    {
      text: 'where to buy fresh roasted coffee beans online',
      textEn: null,
      competitors: ['Ridgeline Roasters', 'Harborline Beans', 'Copper Kettle Coffee'],
    },
    {
      text: 'best coffee subscription for beginners',
      textEn: null,
      competitors: ['Ridgeline Roasters', 'Copper Kettle Coffee'],
    },
    {
      text: 'is single origin coffee worth the price',
      textEn: null,
      competitors: ['Copper Kettle Coffee'],
    },
    { text: 'how long do roasted coffee beans stay fresh', textEn: null, competitors: [] },
  ],
  missedCount: 11,
  questionRows: QUESTIONS.map((text, i) => ({
    text,
    textEn: null,
    product: PRODUCT[i],
    volume: VOLUME[i],
    fit: i === 16 ? 'related' : 'core',
    named: Object.fromEntries(
      REPORT_CARD_ENGINES.map((engine) => [engine, NAMED[engine].includes(i) ? 'named' : 'missed']),
    ),
    instead: INSTEAD[i % INSTEAD.length],
  })),
  cpc: { usd: 1.85, keywords: 19 },
  dealValue: { amount: 38, currency: 'USD' },
};
