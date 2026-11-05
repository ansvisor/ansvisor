import { describe, expect, it } from 'vitest';
import { PLANS } from '@/config/plans';
import type { ReportCardPayload } from './payload';
import {
  MIN_CPC_KEYWORDS,
  PLAN_STEPS_MAX,
  PLAN_STEPS_MIN,
  QUESTION_ROW_MAX,
  actionPlan,
  buyVsEarn,
  competitorSite,
  conversionRange,
  countryName,
  firstDaySteps,
  interCanDraw,
  money,
  planOffers,
  quickWins,
  productLabel,
  questionGroups,
  questionLines,
  questionSummary,
  quotedQuestion,
  revenueRows,
  totals,
  valueRows,
} from './rules';
import { SAMPLE_REPORT_CARD } from './sample';

const card = (patch: Partial<ReportCardPayload> = {}): ReportCardPayload => ({
  ...SAMPLE_REPORT_CARD,
  ...patch,
});

/** A card where the company leads and AI cites it well: little to fix. */
const strong = card({
  engines: SAMPLE_REPORT_CARD.engines.map((e) => ({ ...e, named: 20 })),
  competitors: [{ name: 'Ridgeline Roasters', answers: 30 }],
  citedSites: [{ domain: 'brewlinecoffee.example', answers: 40, own: true }],
  ownCitations: 40,
  missedQuestions: [],
  missedCount: 0,
});

describe('totals', () => {
  it('adds the engines up and takes the share of answers that name the company', () => {
    expect(totals(SAMPLE_REPORT_CARD)).toEqual({ answers: 100, named: 18, visibility: 18 });
  });

  it('is 0% when no engine answered', () => {
    const none = card({ engines: [{ engine: 'chatgpt-web', answers: 0, named: 0 }] });
    expect(totals(none).visibility).toBe(0);
  });
});

describe('quickWins, about competitors and engines', () => {
  it('never sends a company to a competitor’s own site, marked or by its name', () => {
    const wins = quickWins(
      card({
        competitors: [{ name: 'Ridgeline Roasters', answers: 30 }],
        citedSites: [
          { domain: 'ridgelineroasters.example', answers: 30, own: false },
          { domain: 'harborline.example', answers: 25, own: false, competitor: true },
          { domain: 'coffeereview.example', answers: 23, own: false },
        ],
      }),
    );
    expect(wins.map((w) => w.title)).toContain('Get Brewline Coffee onto coffeereview.example');
    expect(wins.map((w) => w.title).join(' ')).not.toMatch(/ridgeline|harborline/i);
  });

  it('matches a competitor by a label of the host, its first word too', () => {
    const rivals = [{ name: 'HubSpot CRM' }, { name: 'Acme Inc.' }];
    expect(competitorSite('hubspot.com', rivals)).toBe(true);
    expect(competitorSite('blog.acme.io', rivals)).toBe(true);
    expect(competitorSite('g2.com', rivals)).toBe(false);
    expect(competitorSite('com', rivals)).toBe(false);
  });

  it('names the weakest engine by how many were asked, and only when the engines differ', () => {
    const three = card({
      engines: [
        { engine: 'chatgpt-web', answers: 25, named: 10 },
        { engine: 'gemini-web', answers: 25, named: 2 },
        { engine: 'google-aio', answers: 20, named: 8 },
      ],
    });
    const line = quickWins({ ...three, missedQuestions: [], citedSites: [], ownCitations: 50 });
    expect(line.find((w) => w.title.includes('Gemini'))?.detail).toContain(
      'the fewest of the three engines',
    );
    const alike = card({
      engines: SAMPLE_REPORT_CARD.engines.map((e) => ({ ...e, answers: 25, named: 5 })),
      missedQuestions: [],
      citedSites: [],
    });
    expect(quickWins(alike).some((w) => w.title.startsWith('Look at what'))).toBe(false);
  });
});

describe('quickWins', () => {
  it('starts with the missed question competitors win, then the cited site, then own pages', () => {
    const wins = quickWins(SAMPLE_REPORT_CARD);
    expect(wins).toHaveLength(3);
    expect(wins[0].title).toBe(
      'Answer “where to buy fresh roasted coffee beans online” on your site',
    );
    expect(wins[0].detail).toContain(
      'AI names Ridgeline Roasters, Harborline Beans and Copper Kettle Coffee for it, and not Brewline Coffee.',
    );
    expect(wins[1].title).toBe('Get Brewline Coffee onto coffeereview.example');
    expect(wins[1].detail).toContain('23 of 100 answers');
    expect(wins[2].title).toBe('Make your own pages easy to cite');
  });

  it('falls back to the question most engines answered when no main competitor wins one', () => {
    const wins = quickWins(
      card({
        missedQuestions: [
          { text: 'how long do beans stay fresh', textEn: null, competitors: [], answers: 2 },
          {
            text: 'is a burr grinder worth it',
            textEn: null,
            competitors: ['Tiny Mill'],
            answers: 4,
          },
        ],
        citedSites: [{ domain: 'brewlinecoffee.example', answers: 30, own: true }],
      }),
    );
    expect(wins.map((w) => w.title)).toEqual([
      'Answer “is a burr grinder worth it” on your site',
      'Make your own pages easy to cite',
      'Close the gap on Ridgeline Roasters',
    ]);
    expect(wins[0].detail).toContain('AI names Tiny Mill for it, and not Brewline Coffee.');
  });

  it('says so when the question picked names no competitor', () => {
    const wins = quickWins(
      card({
        missedQuestions: [
          { text: 'how long do beans stay fresh', textEn: null, competitors: [], answers: 3 },
        ],
      }),
    );
    expect(wins[0].detail).toContain('None of the answers to it names Brewline Coffee.');
  });

  it('picks a question the main competitors win over one with more minor names', () => {
    const wins = quickWins(
      card({
        missedQuestions: [
          {
            text: 'enterprise search platform pricing',
            textEn: null,
            competitors: ['Glean', 'GoSearch', 'Iternal', 'Moveworks'],
            answers: 4,
          },
          {
            text: 'best coffee subscription',
            textEn: null,
            competitors: ['Tiny Mill', 'Copper Kettle Coffee'],
            answers: 4,
          },
        ],
      }),
    );
    expect(wins[0].title).toBe('Answer “best coffee subscription” on your site');
    // The main competitor is named first.
    expect(wins[0].detail).toContain('AI names Copper Kettle Coffee and Tiny Mill for it');
  });

  it('still gives one step when the company leads everywhere, alike in every engine', () => {
    expect(quickWins(strong).map((w) => w.title)).toEqual(['Keep Brewline Coffee where it is']);
    const uneven = {
      ...strong,
      engines: strong.engines.map((e, i) => (i === 0 ? { ...e, named: 15 } : e)),
    };
    expect(quickWins(uneven).map((w) => w.title)).toEqual([
      'Look at what ChatGPT says about your market',
    ]);
  });
});

describe('quotedQuestion', () => {
  it('quotes a question in a script Inter draws as it was asked', () => {
    expect(interCanDraw('Kapadokya’da en iyi balon turu hangisi?')).toBe(true);
    expect(interCanDraw('Где купить свежеобжаренный кофе?')).toBe(true);
    expect(
      quotedQuestion({ text: 'İstanbul’da kahve çekirdeği', textEn: 'Coffee beans in Istanbul' }),
    ).toBe('İstanbul’da kahve çekirdeği');
  });

  it('quotes the English of a question in a script Inter has no letters for', () => {
    for (const text of [
      'オンラインでコーヒー豆を買うならどこ',
      '在哪里买新鲜烘焙的咖啡豆',
      'أين أشتري حبوب القهوة الطازجة',
      'איפה לקנות פולי קפה טריים',
      'ซื้อเมล็ดกาแฟคั่วสดที่ไหนดี',
    ]) {
      expect(interCanDraw(text), text).toBe(false);
      expect(quotedQuestion({ text, textEn: 'Where to buy fresh coffee beans' })).toBe(
        'Where to buy fresh coffee beans',
      );
    }
  });

  it('leaves the question out when it has no English to quote', () => {
    expect(quotedQuestion({ text: '咖啡豆', textEn: null })).toBeNull();
    const card = {
      ...SAMPLE_REPORT_CARD,
      missedQuestions: [
        { text: '在哪里买咖啡豆', textEn: null, competitors: ['Ridgeline Roasters'] },
      ],
    };
    expect(quickWins(card)[0].title).toBe('Get Brewline Coffee onto coffeereview.example');
  });

  it('puts the English in the first thing to do for a Japanese card', () => {
    const card = {
      ...SAMPLE_REPORT_CARD,
      missedQuestions: [
        {
          text: 'オンラインでコーヒー豆を買うならどこ',
          textEn: 'Where to buy coffee beans online',
          competitors: ['Ridgeline Roasters'],
        },
      ],
    };
    expect(quickWins(card)[0].title).toBe('Answer “Where to buy coffee beans online” on your site');
  });
});

describe('actionPlan', () => {
  it('has one step per finding, then the Action Center, AI Traffic and Chat, at most six', () => {
    const steps = actionPlan(SAMPLE_REPORT_CARD);
    expect(steps.map((s) => s.feature)).toEqual([
      'Brand Visibility',
      'Prompts and Content Editor',
      'Competitors and Mentions',
      'Citations and Site Audit',
      'Action Center and Agent Center',
      'AI Traffic',
    ]);
    expect(steps[0].finding).toBe('You appear in 18 of 100 answers; Ridgeline Roasters in 41.');
    expect(steps[1].finding).toBe('11 of 25 questions got no answer that names you.');
    expect(steps[2].finding).toBe('Ridgeline Roasters is named 41 times, 23 more than you.');
    expect(steps[4].finding).toBe('That’s 4 areas to work on at once.');
  });

  it('keeps at least four steps for a card with little to fix', () => {
    const steps = actionPlan(strong);
    expect(steps.length).toBeGreaterThanOrEqual(PLAN_STEPS_MIN);
    expect(steps.map((s) => s.feature)).toEqual([
      'Brand Visibility',
      'Competitors and Mentions',
      'AI Traffic',
      'Chat',
    ]);
    expect(steps[0].finding).toBe('You appear in 80 of 100 answers (80%).');
    expect(steps[1].finding).toBe('You’re named in 80 answers, Ridgeline Roasters in 30.');
  });

  it('has the Action Center when no competitor is named and little is to fix', () => {
    const alone = { ...strong, competitors: [] };
    expect(actionPlan(alone).map((s) => s.feature)).toEqual([
      'Brand Visibility',
      'Action Center and Agent Center',
      'AI Traffic',
      'Chat',
    ]);
  });

  it('never runs past six steps, and every step says what its features do', () => {
    for (const c of [SAMPLE_REPORT_CARD, strong, { ...strong, competitors: [] }]) {
      const steps = actionPlan(c);
      expect(steps.length).toBeLessThanOrEqual(PLAN_STEPS_MAX);
      for (const step of steps) expect(step.lines.length).toBeGreaterThan(0);
    }
  });

  it('promises no outcome', () => {
    const words = actionPlan(SAMPLE_REPORT_CARD)
      .flatMap((s) => [s.finding, s.aim, ...s.lines.map((l) => l.text)])
      .join(' ');
    expect(words).not.toMatch(/guarantee|will (earn|grow|rank|double)|\bensure/i);
  });
});

describe('firstDaySteps', () => {
  it('names the site, the questions and the country', () => {
    expect(firstDaySteps(SAMPLE_REPORT_CARD)).toEqual([
      'Add brewlinecoffee.example as your brand: the setup wizard usually takes a few minutes.',
      'Track this card’s 25 questions as prompts, in the United States.',
      'Open the Action Center after the first run: what to do next, ranked.',
    ]);
  });
});

describe('countryName', () => {
  it('puts "the" before the countries whose name takes it', () => {
    expect(countryName({ code: 'US', name: 'United States' })).toBe('the United States');
    expect(countryName({ code: 'TR', name: 'Türkiye' })).toBe('Türkiye');
  });
});

describe('valueRows', () => {
  it('prices 100, 1,000 and 10,000 visits at the cost per click, a month and a year', () => {
    expect(valueRows(SAMPLE_REPORT_CARD)).toEqual([
      { visits: 100, monthly: 185, yearly: 2_220 },
      { visits: 1_000, monthly: 1_850, yearly: 22_200 },
      { visits: 10_000, monthly: 18_500, yearly: 222_000 },
    ]);
  });

  it('sets 1,000 visits bought in ads against Growth over 12 months', () => {
    expect(buyVsEarn(SAMPLE_REPORT_CARD)).toEqual({
      visits: 1_000,
      adsMonthly: 1_850,
      adsYearly: 22_200,
      growthMonthly: PLANS.growth.pricing?.monthly,
      growthTwelveMonths: (PLANS.growth.pricing?.monthly ?? 0) * 12,
      growthYearly: PLANS.growth.pricing?.annual,
    });
    expect(buyVsEarn(card({ cpc: null }))).toBeNull();
  });

  it('is null without a cost per click, or with fewer than five keywords behind it', () => {
    expect(valueRows(card({ cpc: null }))).toBeNull();
    expect(MIN_CPC_KEYWORDS).toBe(5);
    expect(valueRows(card({ cpc: { usd: 28.27, keywords: 2 } }))).toBeNull();
    expect(valueRows(card({ cpc: { usd: 28.27, keywords: 4 } }))).toBeNull();
    expect(valueRows(card({ cpc: { usd: 1.85, keywords: 5 } }))?.[0].monthly).toBe(185);
  });
});

describe('revenueRows', () => {
  it('uses 1% to 3% of visits for a shop', () => {
    expect(conversionRange('ecommerce')).toEqual({ low: 0.01, high: 0.03, kind: 'order' });
    expect(revenueRows(SAMPLE_REPORT_CARD)).toEqual([
      { visits: 100, low: 38, high: 114 },
      { visits: 1_000, low: 380, high: 1_140 },
      { visits: 10_000, low: 3_800, high: 11_400 },
    ]);
  });

  it('uses 0.5% to 1% for B2B, an app or a site of unknown kind', () => {
    for (const siteType of ['b2b', 'app', null] as const) {
      expect(conversionRange(siteType)).toEqual({ low: 0.005, high: 0.01, kind: 'deal' });
    }
    const b2b = card({ siteType: 'b2b', dealValue: { amount: 12_000, currency: 'EUR' } });
    expect(revenueRows(b2b)?.[1]).toEqual({ visits: 1_000, low: 60_000, high: 120_000 });
  });

  it('is null without a deal value', () => {
    expect(revenueRows(card({ dealValue: null }))).toBeNull();
  });
});

describe('planOffers', () => {
  it('reads Starter and Growth from the plans and the plan cards', () => {
    const [starter, growth] = planOffers();
    expect(starter).toMatchObject({
      plan: 'starter',
      name: 'Starter',
      monthly: PLANS.starter.pricing?.monthly,
      yearly: PLANS.starter.pricing?.annual,
    });
    expect(starter.points).toEqual([
      '1 brand · 50 prompts tracked',
      'ChatGPT & Microsoft Copilot tracking',
    ]);
    expect(growth).toMatchObject({ plan: 'growth', monthly: PLANS.growth.pricing?.monthly });
    expect(growth.points).toEqual([
      '4 brands · 200 prompts tracked',
      'ChatGPT, Perplexity, Gemini, Microsoft Copilot, Google AI Mode and Google AI Overviews tracking',
      'Multi-region tracking',
      'Full auto, with agents that publish on their own',
    ]);
  });
});

describe('questionLines', () => {
  it('quotes each question as page 1 does, cut to two lines', () => {
    const lines = questionLines(
      card({
        questionRows: [
          {
            text: 'kısa soru',
            textEn: 'short question',
            named: { 'chatgpt-web': 'named' },
            instead: null,
          },
          {
            text: '在哪里买咖啡豆',
            textEn: 'Where to buy coffee beans',
            named: {},
            instead: 'Ridge',
          },
          {
            text: 'x '.repeat(80).trim(),
            textEn: null,
            named: {},
            instead: 'A very long competitor name that runs on',
          },
        ],
      }),
    );
    expect(lines[0]).toEqual({
      number: 1,
      text: 'kısa soru',
      named: { 'chatgpt-web': 'named' },
      instead: null,
      volume: null,
      fit: null,
    });
    expect(lines[1].text).toBe('Where to buy coffee beans');
    expect(lines[2].text.length).toBeLessThanOrEqual(QUESTION_ROW_MAX);
    expect(lines[2].text.endsWith('…')).toBe(true);
    expect(lines[2].instead?.length).toBeLessThanOrEqual(28);
  });

  it('has none for a card without its questions', () => {
    expect(questionLines(card({ questionRows: undefined }))).toEqual([]);
    expect(questionGroups(card({ questionRows: undefined }))).toEqual([]);
  });
});

describe('questionGroups', () => {
  it('groups the questions by product, the main one first, with its page', () => {
    const groups = questionGroups(SAMPLE_REPORT_CARD);
    expect(groups.map((g) => [g.product, g.page, g.lines.length])).toEqual([
      ['Whole bean coffee', 'brewlinecoffee.example/beans', 19],
      ['Coffee subscriptions', 'brewlinecoffee.example/subscribe', 5],
      ['Gift boxes', null, 1],
    ]);
    expect(groups[0].lines[0]).toMatchObject({ number: 1, volume: 2900, fit: 'core' });
    expect(groups[0].lines.find((l) => l.number === 17)?.fit).toBe('related');
  });

  it('keeps an older card’s questions in one group without a product', () => {
    const rows = SAMPLE_REPORT_CARD.questionRows?.map((row) => ({ ...row, product: null }));
    const groups = questionGroups(card({ products: undefined, questionRows: rows }));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ product: null, page: null });
    expect(groups[0].lines).toHaveLength(25);
  });

  it('names a product in a script Inter has no letters for by its English', () => {
    expect(productLabel({ name: 'コーヒー豆', nameEn: 'Coffee beans' })).toBe('Coffee beans');
    expect(productLabel({ name: 'Yurt dışı turları', nameEn: 'Tours abroad' })).toBe(
      'Yurt dışı turları',
    );
  });
});

describe('questionSummary', () => {
  it('says how many answers named the company, and in which questions', () => {
    expect(questionSummary(SAMPLE_REPORT_CARD)).toBe(
      'Named in 18 of 100 answers: 14 of the 25 questions.',
    );
    const few = card({
      questionRows: [
        {
          text: 'a',
          textEn: null,
          named: { 'chatgpt-web': 'missed', 'gemini-web': 'none' },
          instead: null,
        },
        {
          text: 'b',
          textEn: null,
          named: { 'chatgpt-web': 'named', 'gemini-web': 'named' },
          instead: null,
        },
        {
          text: 'c',
          textEn: null,
          named: { 'chatgpt-web': 'missed', 'gemini-web': 'missed' },
          instead: null,
        },
        {
          text: 'd',
          textEn: null,
          named: { 'chatgpt-web': 'named', 'gemini-web': 'missed' },
          instead: null,
        },
      ],
    });
    expect(questionSummary(few)).toBe('Named in 3 of 7 answers: questions 2 and 4.');
  });

  it('says so when no answer named the company', () => {
    const none = card({
      questionRows: [
        {
          text: 'a',
          textEn: null,
          named: { 'chatgpt-web': 'missed', 'google-aio': 'none' },
          instead: null,
        },
        {
          text: 'b',
          textEn: null,
          named: { 'chatgpt-web': 'missed', 'google-aio': 'missed' },
          instead: null,
        },
      ],
    });
    expect(questionSummary(none)).toBe('Brewline Coffee wasn’t named in any of the 3 answers.');
  });

  it('has none for a card without its questions', () => {
    expect(questionSummary(card({ questionRows: undefined }))).toBeNull();
  });
});

describe('formats', () => {
  it('writes money in whole units', () => {
    expect(money(1_850)).toBe('$1,850');
    expect(money(380, 'EUR')).toBe('€380');
    expect(money(380, 'TRY')).toBe('TRY\u00a0380');
  });
});
