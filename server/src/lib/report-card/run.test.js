import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { reportCardLimits } = await import('./config.js');
const { buildReportCard, costMeter } = await import('./run.js');
const { keywordFigures, median, medianCpc } = await import('./cpc.js');

/** A card made with every provider faked: the order of the steps and what they cost. */

const card = {
  companyName: 'Acme',
  domain: 'acme.example',
  site: 'acme.example',
  country: 'TR',
  language: 'tr',
  industry: 'ecommerce',
  dealValue: { amount: 500, currency: 'TRY' },
};

const products = [{ name: 'Kahve', nameEn: 'Coffee', url: 'https://acme.example/kahve' }];
const questions = [
  {
    text: 'en iyi kahve',
    textEn: 'best coffee',
    keyword: 'kahve',
    intent: 'discover',
    product: 0,
    fit: 'core',
  },
  {
    text: 'kahve aboneliği',
    textEn: 'coffee subscription',
    keyword: 'kahve abonelik',
    intent: 'choose',
    product: 0,
    fit: 'core',
  },
];
const figures = new Map([
  ['kahve', { volume: 9900, cpc: 0.4 }],
  ['kahve abonelik', { volume: 320, cpc: 0.44 }],
]);
/** The questions as picked: with their keyword's searches a month. */
const picked = questions.map((q) => ({ ...q, volume: figures.get(q.keyword).volume }));

function fakes(patch = {}) {
  return {
    limits: reportCardLimits({}),
    now: () => new Date('2026-11-03T10:00:00Z'),
    fetcher: vi.fn(async () => ({ html: '<title>Acme</title><h1>Fresh coffee</h1>' })),
    detect: vi.fn(async () => ({ siteType: 'ecommerce' })),
    write: vi.fn(async () => ({
      products,
      candidates: questions,
      audience: 'buyers',
      costUsd: 0.01,
    })),
    ask: vi.fn(async () => ({
      engines: ['chatgpt-web', 'google-aio'],
      tasks: 3,
      answers: [
        {
          question: 0,
          engine: 'chatgpt-web',
          text: 'Acme ve Ridge.',
          citations: [{ url: 'https://ridge.example/a' }],
          missing: null,
        },
        { question: 1, engine: 'chatgpt-web', text: 'Ridge only.', citations: [], missing: null },
        { question: 0, engine: 'google-aio', text: null, citations: [], missing: 'no_answer' },
        { question: 1, engine: 'google-aio', text: null, citations: [], missing: 'failed' },
      ],
    })),
    competitors: vi.fn(async () => ({
      byAnswer: new Map([
        [0, ['Ridge']],
        [1, ['Ridge']],
      ]),
      costUsd: 0.004,
    })),
    figuresOf: vi.fn(async () => ({ figures, called: true })),
    ...patch,
  };
}

describe('buildReportCard', () => {
  it('reads the page, writes the questions, picks them by their keywords, asks and reads the answers', async () => {
    const meter = costMeter();
    const deps = fakes();
    const { payload, questions: kept } = await buildReportCard(card, { ...deps, meter });
    expect(deps.write).toHaveBeenCalledWith(
      expect.objectContaining({
        countryName: expect.stringMatching(/^T/),
        languageName: 'Turkish',
        country: 'TR',
        outline: expect.objectContaining({ text: expect.stringContaining('Fresh coffee') }),
        now: new Date('2026-11-03T10:00:00Z'),
      }),
    );
    expect(deps.ask).toHaveBeenCalledWith(picked, 'TR', { deadline: Infinity });
    // One competitor call for the engine that answered.
    expect(deps.competitors).toHaveBeenCalledTimes(1);
    expect(deps.figuresOf).toHaveBeenCalledWith(['kahve', 'kahve abonelik'], {
      country: 'TR',
      language: 'tr',
    });
    expect(payload).toMatchObject({
      companyName: 'Acme',
      domain: 'acme.example',
      country: { code: 'TR' },
      language: 'Turkish',
      siteType: 'ecommerce',
      generatedAt: '2026-11-03T10:00:00.000Z',
      questionCount: 2,
      products,
      engines: [{ engine: 'chatgpt-web', answers: 2, named: 1 }],
      competitors: [{ name: 'Ridge', answers: 2 }],
      citedSites: [{ domain: 'ridge.example', answers: 1, own: false }],
      ownCitations: 0,
      missedCount: 1,
      audience: 'buyers',
      missedQuestions: [
        {
          text: 'kahve aboneliği',
          textEn: 'coffee subscription',
          product: 0,
          volume: 320,
          competitors: ['Ridge'],
          answers: 1,
        },
      ],
      cpc: { usd: 0.42, keywords: 2 },
      dealValue: { amount: 500, currency: 'TRY' },
      questionRows: [
        {
          text: 'en iyi kahve',
          textEn: 'best coffee',
          product: 0,
          volume: 9900,
          fit: 'core',
          named: { 'chatgpt-web': 'named', 'google-aio': 'none' },
          instead: 'Ridge',
        },
        {
          text: 'kahve aboneliği',
          textEn: 'coffee subscription',
          product: 0,
          volume: 320,
          fit: 'core',
          named: { 'chatgpt-web': 'missed', 'google-aio': 'none' },
          instead: 'Ridge',
        },
      ],
    });
    expect(kept[0].answers).toEqual({
      'chatgpt-web': { named: true, competitors: ['Ridge'], cited: ['https://ridge.example/a'] },
      'google-aio': { missing: 'no_answer' },
    });
    // $0.01 + $0.004 in models, 3 answers at $0.002, the keyword call $0.075.
    expect(meter.total()).toBeCloseTo(0.014 + 0.006 + 0.075, 6);
  });

  it('names the brand named most instead on page 4 under one spelling', async () => {
    const deps = fakes({
      competitors: vi.fn(async () => ({
        byAnswer: new Map([
          [0, ['Jolly Tur']],
          [1, ['Jolly', 'Setur']],
        ]),
        costUsd: 0,
      })),
    });
    const { payload } = await buildReportCard(card, deps);
    expect(payload.competitors[0]).toEqual({ name: 'Jolly Tur', answers: 2 });
    expect(payload.questionRows.map((row) => row.instead)).toEqual(['Jolly Tur', 'Jolly Tur']);
  });

  it('flags a card with fewer than 10 questions for staff, and still makes it', async () => {
    const { payload } = await buildReportCard(card, fakes());
    expect(payload.checkByHand).toEqual({
      reason: 'Only 2 of 2 candidate questions matched the site well enough to ask.',
    });
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...questions[0],
      text: `soru ${i}`,
      keyword: `kahve ${i}`,
    }));
    const deps = fakes({
      write: vi.fn(async () => ({ products, candidates: many, audience: 'buyers', costUsd: 0 })),
    });
    const { payload: full } = await buildReportCard(card, deps);
    expect(full.questionCount).toBe(12);
    expect(full.checkByHand).toBeUndefined();
  });

  it('tells the competitor reader a publisher’s audience', async () => {
    const deps = fakes({
      write: vi.fn(async () => ({
        products,
        candidates: questions,
        audience: 'readers',
        costUsd: 0.01,
      })),
    });
    const { payload } = await buildReportCard(card, deps);
    expect(deps.competitors.mock.calls[0][1]).toMatchObject({ audience: 'readers' });
    expect(payload.audience).toBe('readers');
  });

  it('reads the site’s kind only for a deal value, from the page already read', async () => {
    const deps = fakes();
    await buildReportCard({ ...card, dealValue: null }, deps);
    expect(deps.detect).not.toHaveBeenCalled();
    await buildReportCard(card, deps);
    const { fetcher } = deps.detect.mock.calls[0][1];
    expect(await fetcher()).toEqual({ html: '<title>Acme</title><h1>Fresh coffee</h1>' });
    expect(deps.fetcher).toHaveBeenCalledTimes(2);
  });

  it('goes on without an engine’s competitors when that call fails', async () => {
    const deps = fakes({ competitors: vi.fn().mockRejectedValue(new Error('model down')) });
    const { payload } = await buildReportCard(card, deps);
    expect(payload.competitors).toEqual([]);
  });

  it('fails with no answer at all, having counted what it spent', async () => {
    const meter = costMeter();
    const deps = fakes({
      ask: vi.fn(async () => ({
        engines: ['chatgpt-web'],
        tasks: 2,
        answers: [
          { question: 0, engine: 'chatgpt-web', text: null, citations: [], missing: 'failed' },
        ],
      })),
    });
    await expect(buildReportCard(card, { ...deps, meter })).rejects.toThrow('No engine answered');
    // The model call, the keyword call and 2 answers at $0.002.
    expect(meter.total()).toBeCloseTo(0.01 + 0.075 + 0.004, 6);
  });
});

describe('keywordFigures and medianCpc', () => {
  it('looks every keyword up once, and takes the median of those with a cost per click', async () => {
    const volumes = vi.fn(async () => ({
      kahve: { volume: 9900, cpc: 0.3 },
      'kahve abonelik': { volume: 320, cpc: 0.9 },
      'çekirdek kahve': { volume: 1300, cpc: 0.5 },
      'kahve makinesi': { volume: 0, cpc: null },
    }));
    const keywords = ['Kahve', 'kahve abonelik', 'çekirdek kahve', 'kahve makinesi', 'kahve'];
    const result = await keywordFigures(
      keywords,
      { country: 'TR', language: 'tr' },
      { volumes, configured: () => true },
    );
    expect(result.called).toBe(true);
    expect(result.figures.get('kahve')).toEqual({ volume: 9900, cpc: 0.3 });
    expect(result.figures.get('kahve makinesi')).toEqual({ volume: 0, cpc: null });
    expect(volumes).toHaveBeenCalledWith(
      ['kahve', 'kahve abonelik', 'çekirdek kahve', 'kahve makinesi'],
      { locationCode: 2792, languageCode: 'tr' },
    );
    expect(medianCpc(keywords, result.figures)).toEqual({ usd: 0.5, keywords: 3 });
    expect(medianCpc(['kahve makinesi'], result.figures)).toBeNull();
  });

  it('makes no call for a country it can’t place, or without DataForSEO', async () => {
    const volumes = vi.fn();
    for (const [where, configured] of [
      [{ country: 'IS', language: 'is' }, () => true],
      [{ country: 'US', language: 'en' }, () => false],
    ]) {
      const result = await keywordFigures(['a'], where, { volumes, configured });
      expect(result.called).toBe(false);
      expect(result.figures.size).toBe(0);
    }
    expect(volumes).not.toHaveBeenCalled();
  });

  it('counts the call even when it fails', async () => {
    const volumes = vi.fn().mockRejectedValue(new Error('down'));
    const result = await keywordFigures(
      ['a'],
      { country: 'US', language: 'en' },
      { volumes, configured: () => true },
    );
    expect(result).toEqual({ figures: new Map(), called: true });
  });

  it('is the middle value, or the mean of the two middle ones', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
