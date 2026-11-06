import { describe, expect, it } from 'vitest';
import { PLANS } from '@/config/plans';
import { cardCopy, en } from './copy';
import { tr } from './copy-tr';
import type { CitedSiteKind, ReportCardPayload } from './payload';
import {
  MAX_CPC_USD,
  MIN_CPC_KEYWORDS,
  QUESTION_ROW_MAX,
  adsVerdict,
  alsoNamed,
  brandKey,
  buyVsEarn,
  competitorSite,
  conversionRange,
  engineList,
  examplePrompt,
  growthEngineRows,
  interCanDraw,
  isTargetSite,
  mainEngineRows,
  mainTotals,
  money,
  planYearly,
  productLabel,
  questionDemand,
  questionGroups,
  questionLines,
  questionSummary,
  quickWins,
  quotedQuestion,
  revenueRows,
  siteBrandKey,
  startingPoint,
  targetGroups,
  targetSite,
  topMissed,
  totals,
  valueRows,
} from './rules';
import { SAMPLE_REPORT_CARD } from './sample';

const card = (patch: Partial<ReportCardPayload> = {}): ReportCardPayload => ({
  ...SAMPLE_REPORT_CARD,
  ...patch,
});

describe('totals', () => {
  it('counts every engine’s answers, and Starter’s for the headline', () => {
    expect(totals(SAMPLE_REPORT_CARD)).toEqual({ answers: 97, named: 15, visibility: 15 });
    // ChatGPT 6 of 25 and Google Gemini 2 of 25.
    expect(mainTotals(SAMPLE_REPORT_CARD)).toEqual({ answers: 50, named: 8, visibility: 16 });
    expect(mainEngineRows(SAMPLE_REPORT_CARD).map((e) => e.engine)).toEqual([
      'chatgpt-web',
      'gemini-web',
    ]);
    expect(growthEngineRows(SAMPLE_REPORT_CARD).map((e) => e.engine)).toEqual([
      'google-aio',
      'google-aimode',
    ]);
    expect(engineList(mainEngineRows(SAMPLE_REPORT_CARD))).toBe('ChatGPT and Google Gemini');
  });

  it('heads with every engine on a card made before the engines were split', () => {
    const old = card({ mainEngines: undefined });
    expect(mainTotals(old)).toEqual(totals(old));
    expect(growthEngineRows(old)).toEqual([]);
  });
});

describe('one card, one visibility figure', () => {
  // Every "N of M answers" the findings and the questions page state about
  // the company: the headline's M answers.
  const bases = (texts: (string | null)[]) =>
    texts.flatMap((text) => [...(text ?? '').matchAll(/(\d+) of (?:the )?(\d+) answers/g)]);

  it('counts the findings and the questions page over the headline’s engines', () => {
    const headline = mainTotals(SAMPLE_REPORT_CARD);
    expect(headline).toEqual({ answers: 50, named: 8, visibility: 16 });
    const wins = quickWins(SAMPLE_REPORT_CARD).map((win) => win.detail);
    // The guide AI cites and your own citations, of the same 50 answers.
    expect(wins.join(' ')).toContain('A guide AI cites in 11 of 50 answers about your market.');
    expect(wins.join(' ')).toContain('Your site is cited in 2 of 50 answers.');
    const found = bases([...wins, questionSummary(SAMPLE_REPORT_CARD)]);
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(new Set(found.map((m) => Number(m[2])))).toEqual(new Set([headline.answers]));
    expect(questionSummary(SAMPLE_REPORT_CARD)).toContain(
      `in ${headline.named} of the ${headline.answers} answers`,
    );
  });

  it('sets the leading competitor against the headline’s count of the company', () => {
    const { named } = mainTotals(SAMPLE_REPORT_CARD);
    const gap = quickWins(card({ missedQuestions: [], citedSites: [] })).find(
      (win) => win.feature === 'competitors',
    );
    expect(gap?.detail).toBe(
      `Ridgeline Roasters is named in 21 answers, Brewline Coffee in ${named}.`,
    );
  });

  it('counts every engine on a card made before the split', () => {
    const old = card({ mainEngines: undefined });
    const found = bases(quickWins(old).map((win) => win.detail));
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found.map((m) => Number(m[2])))).toEqual(new Set([totals(old).answers]));
  });
});

describe('quickWins', () => {
  it('answers the question competitors win, then a guide, then own pages: each with week one', () => {
    const wins = quickWins(SAMPLE_REPORT_CARD);
    expect(wins.map((w) => [w.title, w.feature])).toEqual([
      ['Answer “where to buy fresh roasted coffee beans online” on your site', 'contentEditor'],
      ['Get Brewline Coffee reviewed or listed on coffeereview.example', 'citations'],
      ['Make your own pages easy to cite', 'siteAudit'],
    ]);
    expect(wins[0].detail).toBe(
      'AI names Ridgeline Roasters, Harborline Beans and Copper Kettle Coffee for it, and not Brewline Coffee.',
    );
    // The question's product page, where the new page is linked from.
    expect(wins[0].week).toContain('link it from brewlinecoffee.example/beans');
    expect(wins[1].week).toBe(
      'Find the page on coffeereview.example that compares businesses like Brewline Coffee, and ask to be added or reviewed.',
    );
    expect(wins.every((w) => w.week.length > 20)).toBe(true);
  });

  it('starts where AI already reads a brand it never names', () => {
    const zero = card({
      engines: SAMPLE_REPORT_CARD.engines.map((e) => ({ ...e, named: 0 })),
      ownCitations: 2,
    });
    expect(startingPoint(zero)).toEqual({ cited: 2 });
    expect(startingPoint(SAMPLE_REPORT_CARD)).toBeNull();
    const own = quickWins(zero).find((w) => w.feature === 'siteAudit');
    expect(own?.title).toBe('Put your name where AI already reads you');
    expect(own?.detail).toBe('AI cited your pages in 2 answers without naming Brewline Coffee.');
  });

  it('names the weakest of Starter’s engines, only when they differ', () => {
    const lean = { missedQuestions: [], citedSites: [], ownCitations: 60 };
    const wins = quickWins(card({ ...lean, competitors: [] }));
    expect(wins[0].title).toBe('Look at what Google Gemini says about your market');
    expect(wins[0].detail).toBe(
      'It names you in 2 of 25 answers, the fewest of ChatGPT and Google Gemini.',
    );
    const alike = card({
      ...lean,
      competitors: [],
      engines: SAMPLE_REPORT_CARD.engines.map((e) => ({ ...e, answers: 25, named: 5 })),
    });
    expect(quickWins(alike).map((w) => w.title)).toEqual(['Keep Brewline Coffee where it is']);
  });

  it('promises no outcome', () => {
    const text = quickWins(SAMPLE_REPORT_CARD)
      .map((w) => `${w.title} ${w.detail} ${w.week}`)
      .join(' ');
    expect(text).not.toMatch(/guarantee|will (rank|grow|increase)|double/i);
  });
});

describe('page 1', () => {
  it('lists the five questions competitors win most, with who is named instead', () => {
    const missed = topMissed(SAMPLE_REPORT_CARD);
    expect(missed).toHaveLength(5);
    expect(missed[0]).toEqual({
      text: 'where to buy fresh roasted coffee beans online',
      instead: ['Ridgeline Roasters', 'Harborline Beans', 'Copper Kettle Coffee'],
    });
    expect(missed[4].instead).toEqual([]);
  });

  it('lists marketplaces and other businesses apart from competitors', () => {
    expect(alsoNamed(SAMPLE_REPORT_CARD)).toEqual([
      'Marketplaces also named: Bean Market',
      'Other businesses named: Burr & Co Grinders',
    ]);
    expect(alsoNamed(card({ marketplaces: undefined, otherNames: [] }))).toEqual([]);
  });
});

describe('page 2', () => {
  it('sums up the main engines’ answers', () => {
    expect(questionSummary(SAMPLE_REPORT_CARD)).toBe(
      'Named in 6 of the 25 questions: in 8 of the 50 answers from ChatGPT and Google Gemini.',
    );
    const none = card({
      questionRows: SAMPLE_REPORT_CARD.questionRows?.map((row) => ({
        ...row,
        named: Object.fromEntries(Object.keys(row.named).map((e) => [e, 'missed'])),
      })),
    });
    expect(questionSummary(none)).toBe(
      'Brewline Coffee wasn’t named in any of the 25 questions: 50 answers from ChatGPT and Google Gemini (25 questions × 2 engines).',
    );
  });

  it('says how many got no answer instead of a questions × engines the answers fall short of', () => {
    // ChatGPT gave no answer to the first question; then to the second too.
    const unanswered = (count: number) =>
      card({
        questionRows: SAMPLE_REPORT_CARD.questionRows?.map((row, i) => ({
          ...row,
          named: Object.fromEntries(
            Object.keys(row.named).map((e) => [
              e,
              e === 'chatgpt-web' && i < count ? 'none' : 'missed',
            ]),
          ),
        })),
      });
    expect(questionSummary(unanswered(1))).toBe(
      'Brewline Coffee wasn’t named in any of the 25 questions: 49 answers from ChatGPT and Google Gemini (1 question got no answer from one engine).',
    );
    expect(questionSummary(unanswered(2))).toBe(
      'Brewline Coffee wasn’t named in any of the 25 questions: 48 answers from ChatGPT and Google Gemini (an engine gave no answer 2 times).',
    );
  });
});

describe('page 3', () => {
  it('sorts the cited sites by what you can do there, and says which are left out', () => {
    const { groups, leftOut } = targetGroups(SAMPLE_REPORT_CARD);
    expect(groups.map((g) => [g.kind, g.sites.map((s) => s.domain)])).toEqual([
      ['guide', ['coffeereview.example']],
      ['publication', ['brewguide.example']],
      ['official', ['coffeeassociation.example']],
      ['community', ['homebarista.example']],
      ['reviews', ['roasterreviews.example']],
    ]);
    expect(leftOut).toEqual(['ridgelineroasters.example', 'beanmarket.example']);
  });

  it('lists an older card’s sites it may suggest, without a competitor’s', () => {
    const old = card({
      competitors: [{ name: 'Jolly Tur', answers: 18 }],
      citedSites: [
        { domain: 'jollytur.com', answers: 13, own: false },
        { domain: 'gezimall.com.tr', answers: 10, own: false },
        { domain: 'sikayetvar.com', answers: 9, own: false },
      ],
    });
    const { groups, leftOut } = targetGroups(old);
    expect(groups.map((g) => [g.kind, g.sites.map((s) => s.domain)])).toEqual([
      ['reviews', ['sikayetvar.com']],
      ['other', ['gezimall.com.tr']],
    ]);
    expect(leftOut).toEqual(['jollytur.com']);
  });

  it('shows the question competitors win as a prompt Ansvisor would track', () => {
    expect(examplePrompt(SAMPLE_REPORT_CARD)).toBe(
      'where to buy fresh roasted coffee beans online',
    );
  });
});

describe('page 4: value', () => {
  it('prices 2%, 5% and 10% of the questions’ own searches at the median cost per click', () => {
    expect(questionDemand(SAMPLE_REPORT_CARD)).toEqual({ searches: 18580, keywords: 24 });
    expect(valueRows(SAMPLE_REPORT_CARD)).toEqual([
      { share: 0.02, visits: 372, monthly: 688, yearly: 8256 },
      { share: 0.05, visits: 929, monthly: 1719, yearly: 20628 },
      { share: 0.1, visits: 1858, monthly: 3437, yearly: 41244 },
    ]);
  });

  it('prices the fixed rows on a card without search volumes', () => {
    const old = card({
      questionRows: SAMPLE_REPORT_CARD.questionRows?.map((row) => ({ ...row, volume: null })),
    });
    expect(valueRows(old)?.map((row) => [row.share, row.visits])).toEqual([
      [null, 100],
      [null, 1000],
      [null, 10000],
    ]);
  });

  it('prices nothing on too few keywords, or on a median too high to trust', () => {
    expect(adsVerdict(card({ cpc: null }))).toEqual({ kind: 'none' });
    expect(adsVerdict(card({ cpc: { usd: 2, keywords: MIN_CPC_KEYWORDS - 1 } }))).toEqual({
      kind: 'none',
    });
    // A real B2B card's $47.10 from 8 keywords is priced, scaled to its own searches.
    expect(adsVerdict(card({ cpc: { usd: 47.1, keywords: 8 } }))).toEqual({
      kind: 'ok',
      usd: 47.1,
      keywords: 8,
    });
    expect(adsVerdict(card({ cpc: { usd: 150, keywords: 8 } }))).toMatchObject({ kind: 'odd' });
    expect(valueRows(card({ cpc: { usd: MAX_CPC_USD + 0.01, keywords: 20 } }))).toBeNull();
  });

  it('says clicks are cheap when the ads cost less than Starter, instead of a saving', () => {
    const compare = buyVsEarn(SAMPLE_REPORT_CARD);
    expect(compare).toMatchObject({ visits: 929, adsMonthly: 1719, starterMonthly: 49 });
    expect(compare?.cheap).toBe(false);
    // A real Turkish card: $0.41 a click.
    const cheap = buyVsEarn(card({ cpc: { usd: 0.041, keywords: 8 } }));
    expect(cheap?.cheap).toBe(true);
  });

  it('runs the revenue scenario over the same visits', () => {
    expect(conversionRange('ecommerce')).toEqual({ low: 0.01, high: 0.03, kind: 'order' });
    expect(revenueRows(SAMPLE_REPORT_CARD)?.[1]).toEqual({ visits: 929, low: 353, high: 1059 });
    expect(revenueRows(card({ dealValue: null }))).toBeNull();
  });

  it('prices yearly plans 20% off twelve months', () => {
    for (const plan of ['starter', 'growth'] as const) {
      const monthly = PLANS[plan].pricing?.monthly ?? 0;
      expect(Math.abs(planYearly(plan) - monthly * 12 * 0.8)).toBeLessThan(1);
    }
  });
});

describe('copy', () => {
  it('puts "the" before the countries whose name takes it', () => {
    expect(en.country({ code: 'US', name: 'United States' })).toBe('the United States');
    expect(en.country({ code: 'TR', name: 'Türkiye' })).toBe('Türkiye');
  });

  it('spells the headline’s base as questions × engines only when every question was answered', () => {
    const engines = 'ChatGPT and Google Gemini';
    expect(en.status.kpiVisibilitySub(engines, 8, 50, 25, 2)).toBe(
      'named in 8 of 50 answers: 25 questions × 2 engines (ChatGPT and Google Gemini)',
    );
    expect(en.status.kpiVisibilitySub(engines, 8, 49, 25, 2)).toBe(
      'named in 8 of 49 answers from ChatGPT and Google Gemini (1 question got no answer from one engine)',
    );
    expect(en.status.kpiVisibilitySub(engines, 8, 47, 25, 2)).toBe(
      'named in 8 of 47 answers from ChatGPT and Google Gemini (an engine gave no answer 3 times)',
    );
    expect(en.status.kpiVisibilitySub(engines, 8, 49, 25, 2)).not.toContain('×');
  });
});

describe('target sites', () => {
  it('suggests guides, publications, official sources and communities, by kind', () => {
    const site = (domain: string, kind: CitedSiteKind | null) => ({
      domain,
      answers: 5,
      own: false,
      kind,
    });
    const titles = (['guide', 'publication', 'official', 'community'] as const).map(
      (kind) => quickWins(card({ citedSites: [site(`${kind}.example`, kind)] }))[1]?.title,
    );
    expect(titles).toEqual([
      'Get Brewline Coffee reviewed or listed on guide.example',
      'Pitch publication.example a story or an expert comment',
      'Make sure official.example lists Brewline Coffee correctly',
      'Answer questions about your market on community.example',
    ]);
    for (const kind of ['competitor', 'marketplace', 'other'] as const) {
      expect(isTargetSite(site('x.example', kind), SAMPLE_REPORT_CARD)).toBe(false);
    }
  });

  it('on an older card, never suggests a site whose address names a competitor', () => {
    const old = card({
      competitors: [{ name: 'Jolly Tur', answers: 18 }],
      citedSites: [
        { domain: 'jollytur.com', answers: 34, own: false },
        { domain: 'businessofapps.com', answers: 20, own: false },
        { domain: 'sikayetvar.com', answers: 11, own: false },
      ],
    });
    expect(isTargetSite(old.citedSites[0], old)).toBe(false);
    // Şikayetvar is a complaints site: never "get mentioned" there.
    expect(isTargetSite(old.citedSites[2], old)).toBe(false);
    // Any other cited site comes before the complaints site.
    expect(quickWins(old)[1].title).toBe('Get Brewline Coffee mentioned on businessofapps.com');
    const mmr = card({
      competitors: [{ name: 'Business of Apps', answers: 33 }],
      citedSites: [{ domain: 'www.businessofapps.com', answers: 31, own: false }],
    });
    expect(isTargetSite(mmr.citedSites[0], mmr)).toBe(false);
    expect(brandKey('Jolly')).toBe(brandKey('Jolly Tur'));
    expect(siteBrandKey('jollytur.com.tr')).toBe('jolly');
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
    expect(wins.map((w) => w.title)).toContain(
      'Get Brewline Coffee mentioned on coffeereview.example',
    );
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
    // A card made before Starter's engines headed it: every engine counts.
    const three = card({
      mainEngines: undefined,
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

describe('the reviews site', () => {
  it('comes only when no guide, publication, official source or community is cited', () => {
    const reviews = {
      domain: 'www.sikayetvar.com',
      answers: 11,
      own: false,
      kind: 'guide' as const,
    };
    const guide = { domain: 'gezirehberi.example', answers: 3, own: false, kind: 'guide' as const };
    expect(targetSite(card({ citedSites: [reviews, guide] }))?.domain).toBe('gezirehberi.example');
    expect(targetSite(card({ citedSites: [reviews] }))?.domain).toBe('www.sikayetvar.com');
    expect(quickWins(card({ citedSites: [reviews] }))[1].title).toBe(
      'Check and answer what customers say about Brewline Coffee on www.sikayetvar.com',
    );
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
    expect(quickWins(card)[0].title).toBe(
      'Get Brewline Coffee reviewed or listed on coffeereview.example',
    );
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
      ['Whole bean coffee', 'brewlinecoffee.example/beans', 14],
      ['Coffee subscriptions', 'brewlinecoffee.example/subscribe', 6],
      ['Gift boxes', null, 5],
    ]);
    expect(groups[0].lines[0]).toMatchObject({ number: 1, volume: 2900, fit: 'core' });
    expect(groups[0].lines.find((l) => l.number === 14)?.fit).toBe('related');
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

describe('formats', () => {
  it('writes money in whole units', () => {
    expect(money(1_850)).toBe('$1,850');
    expect(money(380, 'EUR')).toBe('€380');
    expect(money(380, 'TRY')).toBe('TRY\u00a0380');
  });
});

describe('the card’s language', () => {
  const turkish = card({
    country: { code: 'TR', name: 'Türkiye' },
    language: 'Turkish',
  });

  it('is Turkish for Türkiye and English elsewhere', () => {
    expect(cardCopy(turkish)).toBe(tr);
    expect(cardCopy(SAMPLE_REPORT_CARD)).toBe(en);
    expect(cardCopy({ country: { code: 'GB' } })).toBe(en);
  });

  it('writes the findings in Turkish without a case ending on a name', () => {
    const wins = quickWins(turkish, tr);
    expect(wins[0].title).toBe(
      'Sitenizde şu soruyu yanıtlayın: “where to buy fresh roasted coffee beans online”',
    );
    expect(wins[0].detail).toBe(
      'Yapay zekâ bu soruda Ridgeline Roasters, Harborline Beans ve Copper Kettle Coffee markalarını öneriyor, Brewline Coffee markasını değil.',
    );
    expect(wins[1].title).toBe(
      'coffeereview.example sitesinde Brewline Coffee markasını listeletin',
    );
    expect(questionSummary(turkish, tr)).toBe(
      '25 sorunun 6 tanesinde adınız geçti: ChatGPT ve Google Gemini motorlarının 50 yanıtından 8 tanesinde.',
    );
  });

  it('prints soru × motor only when every question was answered, in Turkish too', () => {
    const engines = 'ChatGPT ve Google Gemini';
    expect(tr.status.kpiVisibilitySub(engines, 8, 50, 25, 2)).toBe(
      '50 yanıtın 8 tanesinde adınız geçiyor: 25 soru × 2 motor (ChatGPT ve Google Gemini)',
    );
    expect(tr.status.kpiVisibilitySub(engines, 8, 49, 25, 2)).toBe(
      'ChatGPT ve Google Gemini motorlarının 49 yanıtından 8 tanesinde adınız geçiyor (1 soruya bir motordan yanıt gelmedi)',
    );
    expect(tr.status.kpiVisibilitySub(engines, 8, 47, 25, 2)).toBe(
      'ChatGPT ve Google Gemini motorlarının 47 yanıtından 8 tanesinde adınız geçiyor (3 kez yanıt gelmedi)',
    );
    expect(tr.questions.summaryNone('Brewline Coffee', 49, 25, engines, 2)).toBe(
      'Brewline Coffee markası 25 sorunun hiçbirinde anılmadı: ChatGPT ve Google Gemini motorlarından 49 yanıt (1 soruya bir motordan yanıt gelmedi).',
    );
    expect(tr.questions.summaryNone('Brewline Coffee', 50, 25, engines, 2)).toBe(
      'Brewline Coffee markası 25 sorunun hiçbirinde anılmadı: ChatGPT ve Google Gemini motorlarından 50 yanıt (25 soru × 2 motor).',
    );
  });

  it('counts the competitor and the citations over the headline’s answers, in Turkish too', () => {
    expect(tr.status.kpiLeaderSub(21, 50)).toBe('aynı 50 yanıtın 21 tanesinde geçiyor');
    expect(tr.status.kpiCitedSub(50)).toBe('aynı 50 yanıttan sayfanızı kaynak gösterenler');
    expect(tr.status.measured(25, false, 'ChatGPT', 'Türkiye', '4 Kas 2026')).toContain(
      'rakipler ve siteler aynı yanıtlar üzerinden sayıldı',
    );
  });

  it('writes dollar amounts the card’s language’s way', () => {
    expect(money(2390, 'USD', 'tr-TR')).toBe('$2.390');
    expect(money(2390)).toBe('$2,390');
  });
});
