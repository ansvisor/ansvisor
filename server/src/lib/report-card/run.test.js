import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { reportCardLimits } = await import('./config.js');
const { buildReportCard, costMeter } = await import('./run.js');
const { median, medianCpc } = await import('./cpc.js');

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

const questions = [
  { text: 'en iyi kahve', textEn: 'best coffee', keyword: 'kahve', intent: 'discover' },
  {
    text: 'kahve aboneliği',
    textEn: 'coffee subscription',
    keyword: 'kahve abonelik',
    intent: 'choose',
  },
];

function fakes(patch = {}) {
  return {
    limits: reportCardLimits({}),
    now: () => new Date('2026-11-03T10:00:00Z'),
    fetcher: vi.fn(async () => ({ html: '<title>Acme</title><h1>Fresh coffee</h1>' })),
    detect: vi.fn(async () => ({ siteType: 'ecommerce' })),
    write: vi.fn(async () => ({ questions, costUsd: 0.01 })),
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
    cpcOf: vi.fn(async () => ({ cpc: { usd: 0.42, keywords: 2 }, called: true })),
    ...patch,
  };
}

describe('buildReportCard', () => {
  it('reads the page, writes the questions, asks, reads the answers and prices the keywords', async () => {
    const meter = costMeter();
    const deps = fakes();
    const { payload, questions: kept } = await buildReportCard(card, { ...deps, meter });
    expect(deps.write).toHaveBeenCalledWith(
      expect.objectContaining({
        countryName: expect.stringMatching(/^T/),
        languageName: 'Turkish',
      }),
    );
    expect(deps.ask).toHaveBeenCalledWith(questions, 'TR', { deadline: Infinity });
    // One competitor call for the engine that answered.
    expect(deps.competitors).toHaveBeenCalledTimes(1);
    expect(deps.cpcOf).toHaveBeenCalledWith(['kahve', 'kahve abonelik'], {
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
      engines: [{ engine: 'chatgpt-web', answers: 2, named: 1 }],
      competitors: [{ name: 'Ridge', answers: 2 }],
      citedSites: [{ domain: 'ridge.example', answers: 1, own: false }],
      ownCitations: 0,
      missedCount: 1,
      missedQuestions: [
        { text: 'kahve aboneliği', textEn: 'coffee subscription', competitors: ['Ridge'] },
      ],
      cpc: { usd: 0.42, keywords: 2 },
      dealValue: { amount: 500, currency: 'TRY' },
    });
    expect(kept[0].answers).toEqual({
      'chatgpt-web': { named: true, competitors: ['Ridge'], cited: ['https://ridge.example/a'] },
      'google-aio': { missing: 'no_answer' },
    });
    // $0.01 + $0.004 in models, 3 answers at $0.002, the keyword call $0.075.
    expect(meter.total()).toBeCloseTo(0.014 + 0.006 + 0.075, 6);
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
    expect(meter.total()).toBeCloseTo(0.01 + 0.004, 6);
  });
});

describe('medianCpc', () => {
  it('takes the median of the keywords with a cost per click, in the country', async () => {
    const volumes = vi.fn(async () => ({
      kahve: { cpc: 0.3 },
      'kahve abonelik': { cpc: 0.9 },
      'çekirdek kahve': { cpc: 0.5 },
      'kahve makinesi': { cpc: null },
    }));
    const result = await medianCpc(
      ['Kahve', 'kahve abonelik', 'çekirdek kahve', 'kahve makinesi', 'kahve'],
      {
        country: 'TR',
        language: 'tr',
      },
      { volumes, configured: () => true },
    );
    expect(result).toEqual({ cpc: { usd: 0.5, keywords: 3 }, called: true });
    expect(volumes).toHaveBeenCalledWith(
      ['kahve', 'kahve abonelik', 'çekirdek kahve', 'kahve makinesi'],
      { locationCode: 2792, languageCode: 'tr' },
    );
  });

  it('makes no call for a country it can’t place, or without DataForSEO', async () => {
    const volumes = vi.fn();
    expect(
      await medianCpc(
        ['a'],
        { country: 'IS', language: 'is' },
        { volumes, configured: () => true },
      ),
    ).toEqual({ cpc: null, called: false });
    expect(
      await medianCpc(
        ['a'],
        { country: 'US', language: 'en' },
        { volumes, configured: () => false },
      ),
    ).toEqual({ cpc: null, called: false });
    expect(volumes).not.toHaveBeenCalled();
  });

  it('has no CPC when no keyword has one', async () => {
    const volumes = vi.fn(async () => ({ a: { cpc: null } }));
    expect(
      await medianCpc(
        ['a'],
        { country: 'US', language: 'en' },
        { volumes, configured: () => true },
      ),
    ).toEqual({ cpc: null, called: true });
  });

  it('is the middle value, or the mean of the two middle ones', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
