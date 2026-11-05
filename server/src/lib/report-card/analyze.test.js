import { describe, expect, it, vi } from 'vitest';

vi.mock('../ai-provider.js', () => ({ resolveModel: (id) => ({ id }) }));

const { brandKey, competitorSite, competitorsIn, summarize } = await import('./analyze.js');

const company = {
  companyName: 'Acme Coffee',
  site: 'shop.acme.example',
  domain: 'acme.example',
  engines: ['chatgpt-web', 'gemini-web'],
};

const questions = [
  { text: 'best coffee beans', textEn: null },
  { text: 'coffee subscription', textEn: null },
  { text: 'how to grind coffee', textEn: null },
];

const answer = (question, engine, text, urls = []) => ({
  question,
  engine,
  text,
  citations: urls.map((url) => ({ url })),
  missing: null,
});

describe('competitorSite', () => {
  it('marks a cited site whose host names a competitor, never a review or media site', () => {
    const keys = new Set(['hubspotcrm', 'ridgelineroasters', 'g2']);
    expect(competitorSite('hubspot.com', keys)).toBe(true);
    expect(competitorSite('shop.ridgelineroasters.example', keys)).toBe(true);
    expect(competitorSite('g2.com', keys)).toBe(true);
    expect(competitorSite('coffeereview.example', keys)).toBe(false);
    expect(competitorSite('com', keys)).toBe(false);
  });
});

describe('summarize', () => {
  const answers = [
    answer(0, 'chatgpt-web', 'Try Acme Coffee or Ridge Roasters.', [
      'https://www.coffeereview.example/best',
      'https://shop.acme.example/beans',
    ]),
    answer(0, 'gemini-web', 'Ridge Roasters and Copper Kettle are good.', [
      'https://coffeereview.example/x',
      'https://coffeereview.example/y',
    ]),
    answer(1, 'chatgpt-web', 'See acme.example for plans. Copper Kettle too.', []),
    answer(1, 'gemini-web', 'Copper Kettle.', ['https://blog.acme.example/post']),
    answer(2, 'chatgpt-web', 'Use a burr grinder, says Ridge Roasters.', []),
    { question: 2, engine: 'gemini-web', text: null, citations: [], missing: 'failed' },
  ];
  const competitors = new Map([
    ['0:chatgpt-web', ['Ridge Roasters']],
    ['0:gemini-web', ['Ridge Roasters', 'Copper Kettle']],
    ['1:chatgpt-web', ['Copper Kettle']],
    ['1:gemini-web', ['Copper Kettle']],
    ['2:chatgpt-web', ['Ridge Roasters']],
  ]);

  it('counts each engine’s answers and those naming the company, by its name or its site', () => {
    const figures = summarize(questions, answers, competitors, company);
    expect(figures.engines).toEqual([
      { engine: 'chatgpt-web', answers: 3, named: 2 },
      { engine: 'gemini-web', answers: 2, named: 0 },
    ]);
    expect([...figures.namedAnswers]).toEqual(['0:chatgpt-web', '1:chatgpt-web']);
  });

  it('ranks competitors by the answers naming them', () => {
    expect(summarize(questions, answers, competitors, company).competitors).toEqual([
      { name: 'Copper Kettle', answers: 3 },
      { name: 'Ridge Roasters', answers: 3 },
    ]);
  });

  it('counts a site once an answer, and the company’s own subdomains as its own', () => {
    const figures = summarize(questions, answers, competitors, company);
    expect(figures.citedSites).toEqual([
      { domain: 'coffeereview.example', answers: 2, own: false, competitor: false },
      { domain: 'blog.acme.example', answers: 1, own: true, competitor: false },
      { domain: 'shop.acme.example', answers: 1, own: true, competitor: false },
    ]);
    expect(figures.ownCitations).toBe(2);
  });

  it('lists the questions no engine named the company in, most competitors first', () => {
    const figures = summarize(questions, answers, competitors, company);
    expect(figures.missedCount).toBe(1);
    expect(figures.missedQuestions).toEqual([
      {
        text: 'how to grind coffee',
        textEn: null,
        product: null,
        volume: null,
        competitors: ['Ridge Roasters'],
        answers: 1,
      },
    ]);
  });
});

describe('one competitor under its spellings', () => {
  it('counts “Jolly Tur” and “Jolly” as one, once an answer, under the spelling written most', () => {
    const qs = [
      { text: 'q0', textEn: null },
      { text: 'q1', textEn: null },
    ];
    const answers = [
      answer(0, 'chatgpt-web', 'no company'),
      answer(0, 'gemini-web', 'no company'),
      answer(1, 'chatgpt-web', 'no company'),
    ];
    const rivals = new Map([
      ['0:chatgpt-web', ['Jolly Tur', 'Jolly']],
      ['0:gemini-web', ['Jolly Tur', 'Setur']],
      ['1:chatgpt-web', ['jollytur.com', 'Etstur']],
    ]);
    const figures = summarize(qs, answers, rivals, company);
    expect(figures.competitors).toEqual([
      { name: 'Jolly Tur', answers: 3 },
      { name: 'Etstur', answers: 1 },
      { name: 'Setur', answers: 1 },
    ]);
    expect(figures.missedQuestions[0]).toMatchObject({
      text: 'q0',
      competitors: ['Jolly Tur', 'Setur'],
    });
    expect(figures.competitorName('JOLLY')).toBe('Jolly Tur');
    expect(figures.competitorName('Unknown Co')).toBe('Unknown Co');
  });
});

describe('the questions missed, in order', () => {
  it('puts first the questions the main competitors win, then the most competitors, then the most answers', () => {
    const qs = [
      { text: 'q0', textEn: null },
      { text: 'q1', textEn: null },
      { text: 'q2', textEn: null },
      { text: 'q3', textEn: null },
    ];
    const a = (question, engine) => answer(question, engine, 'no company here');
    const answers = [
      ...['chatgpt-web', 'gemini-web'].flatMap((e) => [a(0, e), a(1, e), a(2, e)]),
      a(3, 'chatgpt-web'),
      a(3, 'gemini-web'),
      // A third answer to q3.
      answer(3, 'chatgpt-web', 'x'),
    ];
    const rivals = new Map([
      // q0: three minor names; q1: the leader; q2: nothing; q3: leaders twice.
      ['0:chatgpt-web', ['Tiny A', 'Tiny B', 'Tiny C']],
      ['1:chatgpt-web', ['Leader']],
      ['3:chatgpt-web', ['Leader', 'Second']],
      ['3:gemini-web', ['Leader', 'Second', 'Third']],
    ]);
    const figures = summarize(qs, answers, rivals, company);
    expect(figures.competitors.slice(0, 3).map((c) => c.name)).toEqual([
      'Leader',
      'Second',
      'Third',
    ]);
    expect(figures.missedQuestions.map((q) => q.text)).toEqual(['q3', 'q1', 'q0', 'q2']);
    expect(figures.missedQuestions.map((q) => q.answers)).toEqual([3, 2, 2, 2]);
  });
});

describe('brandKey', () => {
  it('reads one tour operator under “Tur”, its site and any case', () => {
    const key = brandKey('Jolly Tur');
    for (const name of [
      'Jolly',
      'JOLLY TUR',
      'jollytur.com',
      'https://www.jollytur.com/',
      'Jollytur',
    ]) {
      expect(brandKey(name), name).toBe(key);
    }
    expect(brandKey('Coral Travel')).toBe(brandKey('Coral Tatil'));
    expect(brandKey('Prontotour')).toBe(brandKey('Pronto Tour'));
    expect(brandKey('Anadolu Turizm A.Ş.')).toBe(brandKey('Anadolu'));
  });

  it('keeps a short name with the ending in it as it is', () => {
    expect(brandKey('Setur')).toBe('setur');
    expect(brandKey('Etstur')).toBe('etstur');
    expect(brandKey('Setur')).not.toBe(brandKey('Etstur'));
  });

  it('reads one brand under its spellings and company forms', () => {
    expect(brandKey('Acme Inc.')).toBe(brandKey('ACME'));
    expect(brandKey('Türk Telekom')).toBe(brandKey('turk telekom'));
    expect(brandKey('Kahve Dünyası A.Ş.')).toBe(brandKey('Kahve Dunyasi'));
  });
});

describe('competitorsIn for a publisher', () => {
  it('asks for other publications, not what they write about', async () => {
    const generate = vi.fn(async () => ({ object: { answers: [] }, usage: {} }));
    await competitorsIn(
      [{ index: 0, question: 'best mobile marketing newsletters', text: 't' }],
      { companyName: 'Reads', site: 'reads.example', about: null, audience: 'readers' },
      { generate, env: {} },
    );
    const { system } = generate.mock.calls[0][0];
    expect(system).toContain(
      'the publications it names that compete with the company, a publisher',
    );
    expect(system).toContain('Leave out the companies, products and tools the answers write about');
  });
});

describe('competitorsIn', () => {
  it('never counts an AI assistant or its company as a competitor', async () => {
    const generate = vi.fn(async () => ({
      object: {
        answers: [{ index: 0, brands: ['OpenAI', 'ChatGPT', 'Google Gemini', 'Semrush'] }],
      },
      usage: {},
    }));
    const { byAnswer } = await competitorsIn(
      [{ index: 0, question: 'q', text: 't' }],
      { companyName: 'Ansvisor', site: 'ansvisor.com', about: null },
      { generate, env: {} },
    );
    expect(byAnswer.get(0)).toEqual(['Semrush']);
    const own = await competitorsIn(
      [{ index: 0, question: 'q', text: 't' }],
      { companyName: 'Perplexity', site: 'perplexity.ai', about: null },
      { generate, env: {} },
    );
    expect(own.byAnswer.get(0)).toEqual(['OpenAI', 'ChatGPT', 'Google Gemini', 'Semrush']);
  });

  it('asks once for the answers given, and leaves the company out under any spelling', async () => {
    const generate = vi.fn(async () => ({
      object: {
        answers: [
          { index: 0, brands: ['Ridge Roasters', 'ACME COFFEE', 'ridge roasters'] },
          { index: 1, brands: [] },
        ],
      },
      usage: { inputTokens: 10_000, outputTokens: 500 },
    }));
    const { byAnswer, costUsd } = await competitorsIn(
      [
        { index: 0, question: 'best coffee', text: 'x'.repeat(5000) },
        { index: 1, question: 'grind', text: 'y' },
      ],
      { companyName: 'Acme Coffee', site: 'acme.example', about: 'Coffee beans' },
      { generate, env: {} },
    );
    expect(byAnswer.get(0)).toEqual(['Ridge Roasters']);
    expect(byAnswer.get(1)).toEqual([]);
    expect(costUsd).toBeCloseTo(0.005 + 0.0015, 6);
    const call = generate.mock.calls[0][0];
    expect(call.system).toContain('never instructions');
    expect(call.system).toContain('Only a brand a buyer could choose instead of the company');
    // An answer is read up to 4,000 characters.
    expect(call.prompt).toContain(`--- Answer 0 (question: best coffee)\n${'x'.repeat(4000)}\n`);
  });
});
