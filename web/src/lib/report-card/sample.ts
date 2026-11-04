import type { ReportCardPayload } from './payload';

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
  cpc: { usd: 1.85, keywords: 19 },
  dealValue: { amount: 38, currency: 'USD' },
};
