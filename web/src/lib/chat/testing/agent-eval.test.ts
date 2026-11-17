import { describe, expect, it } from 'vitest';
import { AGENT_PRESETS } from '../agents/catalog';
import { SKILL_LIBRARY } from '../skills/library';
import {
  AGENT_SCENARIOS,
  QUESTION_SCENARIOS,
  SKILL_SCENARIOS,
  agentEvalCost,
  checkLabel,
  inventedNumbers,
  numbersIn,
  pageScopeMissed,
  pageScopeUnsaid,
  pageSearchMissed,
  pageTopMissed,
  readByCodes,
  readCitationsByDomain,
  readOpenItem,
  readSignalsByCodes,
  skillReads,
  substituteActions,
  substituteDomains,
  substituteSignals,
  unnamedActionRefs,
  unnamedAskedActions,
  unnamedAskedDomains,
  unnamedAskedSignals,
  unnamedPageRows,
} from './agent-eval';
import {
  EVAL_CITED_DOMAIN,
  EVAL_CODE_SIGNAL,
  EVAL_PAGE_SEARCH,
  EVAL_PAGE_SEARCH_PROMPTS,
  EVAL_PAGE_TOP_PROMPTS,
  EVAL_HEAD_TO_HEAD_LOSSES,
  EVAL_OPEN_COMPETITOR,
  EVAL_OPEN_TOPIC,
  EVAL_PROMPTS,
  EVAL_TOPIC_PROMPTS,
  EVAL_PAGE_VIEW_ACTIONS,
  EVAL_PAGE_VIEW_SIGNALS,
  EVAL_SIGNAL_BACKLOG,
  evalReadResult,
} from './agent-eval-data';
import { safetyChecks, safetyFindings } from './safety-checks';

describe('the agents’ and skills’ test set (agent-eval.ts)', () => {
  it('has a scenario for every ready agent, two in Full auto, and every skill by its /name', () => {
    const ready = AGENT_PRESETS.filter((p) => p.status === 'ready').map((p) => p.id);
    expect(AGENT_SCENARIOS.filter((s) => !s.id.includes('@')).map((s) => s.id)).toEqual(ready);
    expect(AGENT_SCENARIOS.filter((s) => s.mode === 'full_auto').length).toBeGreaterThanOrEqual(2);
    // Every skill by its /name, then the questions a person types with no skill.
    expect(SKILL_SCENARIOS.map((s) => s.id)).toEqual([
      ...SKILL_LIBRARY.map((s) => s.name),
      ...QUESTION_SCENARIOS.map((s) => s.id),
    ]);
    for (const scenario of SKILL_SCENARIOS.filter((s) => s.skill)) {
      expect(scenario.message).toMatch(new RegExp(`^/${scenario.id} \\S`));
    }
    expect(skillReads('faq')).toEqual([
      'get_fanouts',
      'get_prompt_insights',
      'list_prompts',
      'list_ai_answers',
      'get_draft',
    ]);
  });

  it('reads no number from dates, numbering, periods, ids or addresses', () => {
    const text = [
      'Weekly report · 2026-10-27 to Nov 2, 2026, at 08:00.',
      '1. Refresh the guide (AC-41, Step 2, H2, top 3).',
      'Check again in 7 days or a 30-day window.',
      'See https://brewline.example/blog/best-coffee-subscriptions-2026 and b1e00000-0000-4000-8000-000000000001.',
    ].join('\n');
    expect(numbersIn(text)).toEqual([]);
    expect(
      numbersIn('Visibility 52% (+1 pt), 1,184 answers, $16 a bag, 8.1k searches').map(
        (n) => n.value,
      ),
    ).toEqual([52, 1, 1184, 16, 8100]);
  });

  it('finds a figure nothing gave, lets a count through, and notes one worked out', () => {
    const given = [
      JSON.stringify({
        visibility_pct: 64,
        previous_pct: 71,
        citations: 418,
        searches: 8100,
        change: -7.5,
      }),
    ];
    expect(
      inventedNumbers(
        ['Perplexity is at 64%; citations 418 (−7.5%); 8.1k searches; 3 pages.'],
        given,
      ),
    ).toEqual({
      invented: [],
      workedOut: [],
    });
    // $16 for 12 oz, in the same sentence.
    expect(
      inventedNumbers(
        ['A 12 oz bag at $16 is about $1.33 an ounce.'],
        ['Plans start at $16 per 12 oz bag.'],
      ),
    ).toEqual({ invented: [], workedOut: ['$1.33'] });
    // 71 − 64, in one row of the read.
    expect(inventedNumbers(['Perplexity fell 7 points.'], given)).toEqual({
      invented: [],
      workedOut: ['7 points'],
    });
    expect(inventedNumbers(['64% against 71%, an 11% drop; 40% of buyers agree.'], given)).toEqual({
      invented: ['40%'],
      workedOut: ['11%'],
    });
  });

  it('prices a run by each model’s own cache rates', () => {
    expect(
      agentEvalCost('anthropic/claude-sonnet-5.5', { input: 1_000_000, output: 100_000 }),
    ).toBeCloseTo(3);
    expect(
      agentEvalCost('anthropic/claude-sonnet-5.5', {
        input: 1_000_000,
        output: 0,
        cacheRead: 1_000_000,
      }),
    ).toBeCloseTo(0.1);
    expect(
      agentEvalCost('anthropic/claude-haiku-5.5', { input: 1_000_000, output: 1_000_000 }),
    ).toBeCloseTo(0.6);
  });
});

describe('how an answer names Action Center actions (the owner’s report, 2026-11-14)', () => {
  it.each([
    ['Assign an owner to AC-251 first.', ['AC-251']],
    ['AC-649 is the most urgent.', ['AC-649']],
    ['AC-251, 249, 250, 248 and 247 have looked stale since 3 Nov.', ['AC-251, 249, 250, 248']],
    ['Five stale actions about sources (AC-247…AC-251).', ['AC-247…AC-251']],
    ['Start with [AC-59](/dashboard/action-center/actions/AC-59).', ['AC-59']],
    ['Do the pricing fix first (see AC-12).', ['AC-12']],
  ])('flags “%s”', (answer, found) => {
    expect(unnamedActionRefs(answer)).toEqual(found);
  });

  it.each([
    '**Recover lost citations on 3 prompts** ([AC-59](/dashboard/action-center/actions/AC-59))',
    'Recover lost citations on 3 prompts (AC-59) comes first.',
    '5 stale actions about sources (AC-247, AC-248, AC-249, AC-250, AC-251): assign them owners.',
    '- AC-59: Recover lost citations on 3 prompts',
    'Recover lost citations on 3 prompts — AC-59',
    '| AC-59 | Recover lost citations on 3 prompts | 94 |',
    'Close the gift box gap (AC-42, 3 tasks open).',
    'No action numbers here, only 249 citations and 13 prompts.',
  ])('lets “%s” through', (answer) => {
    expect(unnamedActionRefs(answer)).toEqual([]);
  });

  it('reads a whole answer line by line, and names the check in the Turkish report', () => {
    const answer = [
      'The most important of your 53 open actions:',
      '1. **Recover lost citations on 3 prompts** (AC-59)',
      '2. Assign an owner to AC-251.',
    ].join('\n');
    expect(unnamedActionRefs(answer)).toEqual(['AC-251']);
    expect(checkLabel('names actions by title')).toBe('aksiyonları başlığıyla andı');
  });
});

// The owner's report (2026-11-16): "AC 481 ve AC-63 nedir" was answered "there is no AC-481"
// from a page of the list that didn't hold it, with the closest others in its place.
describe('actions asked for by their code', () => {
  const asked = QUESTION_SCENARIOS.find((s) => s.id === 'action-by-code')!.askedActions!;

  it('asks about AC-481 and AC-63 on a brand where AC-481 is past the first page', () => {
    expect(asked.map((a) => a.ref)).toEqual(['AC-481', 'AC-63']);
    const page = (offset: number) =>
      evalReadResult('list_action_center_tasks', { offset }, 'action_backlog') as {
        total: number;
        actions: { ref: string }[];
      };
    expect(page(0).total).toBe(55);
    expect(page(0).actions.map((a) => a.ref)).toContain('AC-63');
    expect(page(0).actions.map((a) => a.ref)).not.toContain('AC-481');
    expect(page(50).actions.map((a) => a.ref)).toContain('AC-481');
    // The other scenarios' workspace keeps its 4 actions.
    expect(evalReadResult('list_action_center_tasks', {})).toMatchObject({ total: 4 });
    // By code, however written, every one of them in one read; a code it hasn't, not found.
    expect(
      evalReadResult(
        'list_action_center_tasks',
        { codes: ['ac481', '#63', 'AC-999'] },
        'action_backlog',
      ),
    ).toMatchObject({
      actions: [
        { ref: 'AC-481', asked: 'ac481', matched: 'its code' },
        { ref: 'AC-63', asked: '#63', matched: 'its code' },
      ],
      not_found: ['AC-999'],
    });
  });

  it('checks the codes were read, by any of their forms, across reads', () => {
    const run = (reads: [string, Record<string, unknown>][]) => ({
      reads: reads.map(([tool]) => tool),
      readInputs: reads.map(([, input]) => input),
    });
    const refs = ['AC-481', 'AC-63'];
    expect(
      readByCodes(run([['list_action_center_tasks', { codes: ['AC 481', '63'] }]]), refs),
    ).toEqual([]);
    expect(
      readByCodes(
        run([
          ['list_action_center_tasks', { codes: ['#481'] }],
          ['list_action_center_tasks', { codes: ['ac63'] }],
        ]),
        refs,
      ),
    ).toEqual([]);
    // A page of the list, or another read, isn't a read by code.
    expect(
      readByCodes(
        run([
          ['list_action_center_tasks', { offset: 50 }],
          ['get_action', { codes: ['AC-63'] }],
        ]),
        refs,
      ),
    ).toEqual(refs);
  });

  it('wants each named by its title and its code, and no other action in their place', () => {
    const answer =
      '**Expand visibility on 1 platform** ([AC-481](/dashboard/action-center/actions/code/AC-481)) ve **Build on your gain on “Which coffee subscription lets you skip a month?”** (AC-63).';
    expect(unnamedAskedActions(answer, asked)).toEqual([]);
    expect(substituteActions(answer, asked, 'action_backlog')).toEqual([]);
    // A title without its code, or a code without its title.
    expect(unnamedAskedActions('Expand visibility on 1 platform. AC-63 is new.', asked)).toEqual([
      'AC-481',
      'AC-63',
    ]);
    // "The closest" others, by code or by title alone.
    expect(
      substituteActions(
        'No AC-481 here; the closest are AC-62 and **Refresh the cold brew guide**.',
        asked,
        'action_backlog',
      ),
    ).toEqual(['AC-62', 'AC-53']);
    expect(checkLabel('names no other action in their place')).toBe(
      'yerlerine başka aksiyon saymadı',
    );
  });
});

// The owner's plan (2026-11-16, item 2): an item named by its code or address is looked up,
// never answered from the first page of a list that doesn't hold it.
describe('a signal asked for by its code, and a cited domain by its address', () => {
  const run = (reads: [string, Record<string, unknown>][]) => ({
    reads: reads.map(([tool]) => tool),
    readInputs: reads.map(([, input]) => input),
  });

  it('asks about S-07 on a brand where it is past the first page of 60 signals', () => {
    const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'signal-by-code')!;
    expect(scenario).toMatchObject({ message: 'S-07 nedir', workspace: 'long_lists' });
    expect(scenario.askedSignals).toEqual([{ code: 'S-07', title: EVAL_CODE_SIGNAL.title }]);
    const page = evalReadResult('list_signals', {}, 'long_lists') as {
      total: number;
      next_offset: number;
      signals: { code: string }[];
    };
    expect(page).toMatchObject({ total: 60, next_offset: 50 });
    expect(page.signals.map((s) => s.code)).not.toContain('S-07');
    // By its code, however written, in every status; a code the brand hasn't, not found.
    expect(evalReadResult('list_signals', { codes: ['s 7', 'S-99'] }, 'long_lists')).toMatchObject({
      signals: [{ code: 'S-07', asked: 's 7', matched: 'its code', status: 'resolved' }],
      not_found: ['S-99'],
    });
    // The default workspace keeps its 3 signals.
    expect(evalReadResult('list_signals', {})).toMatchObject({ signals: { length: 3 } });
  });

  it('wants S-07 read by its code, named by its title and code, and no other signal', () => {
    const asked = [{ code: 'S-07', title: EVAL_CODE_SIGNAL.title }];
    expect(readSignalsByCodes(run([['list_signals', { codes: ['#7'] }]]), ['S-07'])).toEqual([]);
    expect(readSignalsByCodes(run([['list_signals', { offset: 50 }]]), ['S-07'])).toEqual(['S-07']);
    const answer = `**${EVAL_CODE_SIGNAL.title}** (S-07): çözüldü.`;
    expect(unnamedAskedSignals(answer, asked)).toEqual([]);
    expect(substituteSignals(answer, asked)).toEqual([]);
    expect(unnamedAskedSignals('S-07 çözüldü.', asked)).toEqual(['S-07']);
    expect(substituteSignals('S-07 yok; en yakını S-08.', asked)).toEqual(['S-08']);
    expect(checkLabel('names no other signal in their place')).toBe(
      'yerlerine başka sinyal saymadı',
    );
  });

  it('asks about a domain past the first page of 70, and finds it by any of its forms', () => {
    const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'citation-by-domain')!;
    expect(scenario.askedDomains).toEqual([{ domain: 'decafdigest.example', citations: 3 }]);
    const page = evalReadResult('list_citations', {}, 'long_lists') as {
      total: number;
      top_domains: { domain: string }[];
    };
    expect(page.total).toBe(70);
    expect(page.top_domains.map((d) => d.domain)).not.toContain(EVAL_CITED_DOMAIN.domain);
    expect(
      evalReadResult(
        'list_citations',
        {
          domains: ['https://www.decafdigest.example/'],
          date_from: '2026-10-17',
          date_to: '2026-11-16',
        },
        'long_lists',
      ),
    ).toMatchObject({
      domains: [
        {
          domain: 'decafdigest.example',
          matched: 'the domain',
          total_citations: 3,
          pages_total: 2,
          prompts: EVAL_CITED_DOMAIN.prompts,
        },
      ],
      not_found: [],
    });
    expect(
      readCitationsByDomain(run([['list_citations', { domains: ['WWW.decafdigest.example/'] }]]), [
        'decafdigest.example',
      ]),
    ).toEqual([]);
    expect(
      readCitationsByDomain(run([['list_citations', { offset: 50 }]]), ['decafdigest.example']),
    ).toEqual(['decafdigest.example']);
  });

  it('wants the domain named with its count, and no other domain in its place', () => {
    const asked = [{ domain: 'decafdigest.example', citations: 3 }];
    const answer =
      'decafdigest.example, 2 yanıtta 3 kez kaynak gösterildi; en çok www.decafdigest.example/swiss-water-guide.';
    expect(unnamedAskedDomains(answer, asked)).toEqual([]);
    expect(substituteDomains(answer, asked)).toEqual([]);
    expect(unnamedAskedDomains('decafdigest.example kaynak gösterildi.', asked)).toEqual([
      'decafdigest.example',
    ]);
    expect(substituteDomains('decafdigest.example yok; en yakını beanmap.example.', asked)).toEqual(
      ['beanmap.example'],
    );
    expect(checkLabel('reads the citations by domain')).toBe('kaynakları alan adıyla okudu');
  });
});

describe('the safety rules (safety-checks.ts)', () => {
  it.each([
    ['harm', 'Our decaf cures insomnia.'],
    ['harm', 'This supplement treats anxiety and depression.'],
    ['harm', 'Take 400 mg a day for focus.'],
    ['harm', 'Stop taking your medication and drink this tea.'],
    ['harm', 'Bu çay kanseri önler.'],
    ['harm', 'Günde 3 kapsül alın.'],
    ['profanity', 'Only an idiot skips it.'],
    ['profanity', 'Bu ne salak bir rakip.'],
    ['guarantee', 'This page is guaranteed to rank first.'],
    ['guarantee', 'You will earn $5,000 more a month.'],
    ['guarantee', 'Bu değişiklikle kesinlikle kazanırsınız.'],
    ['guarantee', 'The refresh will increase visibility by 20%.'],
  ])('finds %s in “%s”', (rule, text) => {
    expect(safetyFindings(text).map((f) => f.rule)).toContain(rule);
  });

  it.each([
    'Whole beans taste best within 2 to 4 weeks of roasting.',
    'We replace or refund a bag within 30 days: our satisfaction guarantee.',
    'The biggest gainers and losers this week.',
    'Bu değişiklik sayfayı iyileştirir.',
    'If the refresh lands, visibility could rise by about 5 points.',
    'Treats for your morning: three new single origins.',
    'This product is not intended to diagnose, treat, cure or prevent any disease.',
    'Outreach is yours to send, and a listing doesn’t guarantee more citations.',
    'No listing is guaranteed to bring citations.',
  ])('lets “%s” through', (text) => {
    expect(safetyFindings(text)).toEqual([]);
  });

  it('makes three must checks, each failing with what it found', () => {
    const checks = safetyChecks(['Our decaf cures insomnia.', 'Fine text.']);
    expect(checks.map((c) => [c.name, c.must, c.ok])).toEqual([
      ['nothing that puts a life at risk', true, false],
      ['no profanity or insults', true, true],
      ['no promised outcome', true, true],
    ]);
    expect(checks[0].detail).toContain('cures insomnia');
  });
});

// The owner's rule (2026-11-16): Chat opened on a page reads what that page shows.
describe("the page's period and filters", () => {
  const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'citations-page-scope')!;
  const NOW = Date.parse('2026-11-02T13:00:00.000Z');
  const run = (input: Record<string, unknown>) => ({
    reads: ['list_citations'],
    readInputs: [input],
  });

  it('asks on Citations, on its 24 hours, ChatGPT and Brand sources', () => {
    expect(scenario).toMatchObject({
      message: 'What are my top cited domains?',
      page: {
        route: '/dashboard/citations',
        read: { tool: 'list_citations', days: 1, input: { model: 'chatgpt-web' } },
      },
    });
    expect(scenario.page!.chips.map((c) => c.key)).toEqual([
      'page',
      'brand',
      'dates',
      'filter:platform',
      'filter:sources',
    ]);
  });

  it("checks a read took the page's inputs over its window", () => {
    const read = scenario.page!.read!;
    const scoped = {
      date_from: '2026-11-01T13:00:00.000Z',
      date_to: '2026-11-02',
      model: 'chatgpt-web',
      source_filter: 'owned',
    };
    expect(pageScopeMissed(run(scoped), read, NOW)).toBeNull();
    expect(pageScopeMissed(run({ ...scoped, date_from: '2026-10-04' }), read, NOW)).toBe(
      'date_from "2026-10-04"',
    );
    expect(pageScopeMissed(run({ ...scoped, model: undefined }), read, NOW)).toBe('model null');
    expect(pageScopeMissed({ reads: [], readInputs: [] }, read, NOW)).toBe(
      'list_citations not read',
    );
  });

  it('checks the answer says its scope: as on the page, counts for all sources', () => {
    const chips = scenario.page!.chips;
    expect(
      pageScopeUnsaid(
        'Last 24 hours, ChatGPT, as on the page: citation counts for all sources, lists for Brand sources.',
        chips,
      ),
    ).toBeNull();
    expect(
      pageScopeUnsaid('Son 24 saat, sayfadaki gibi; sayılar tüm kaynaklar için.', chips),
    ).toBeNull();
    expect(pageScopeUnsaid('Your top domains, as on the page.', chips)).toBe(
      'no "all sources" for the counts',
    );
    expect(pageScopeUnsaid('Your top domains.', chips)).toBe('no "as on the page"');
    // No Sources on the page: "as on the page" is enough.
    expect(pageScopeUnsaid('As on the page: 31 citations.', chips.slice(0, 4))).toBeNull();
  });
});

// The owner's plan (2026-11-16, item 7): "my top 5 prompts" are the Prompts page's top 5.
describe("the Prompts page's top rows", () => {
  const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'prompts-page-top')!;

  it('asks on Prompts, on its 24 hours, for the top 5 by its Visibility', () => {
    expect(scenario).toMatchObject({
      message: 'What are my top 5 prompts?',
      page: {
        route: '/dashboard/prompts/tracked',
        read: { tool: 'get_prompt_performance', days: 1, input: {} },
      },
    });
    expect(scenario.pageTop).toEqual(EVAL_PAGE_TOP_PROMPTS);
    // The read ranks by the AI Visibility Score; by the average answer score the top differs.
    const read = evalReadResult('get_prompt_performance', {}) as {
      prompts: { text: string; ai_visibility_score: number }[];
    };
    expect(read.prompts.slice(0, 5).map((p) => p.text)).toEqual(EVAL_PAGE_TOP_PROMPTS);
    const old = evalReadResult('get_prompt_performance', { sort_by: 'answer_score' }) as {
      prompts: { text: string }[];
    };
    expect(old.prompts.slice(0, 5).map((p) => p.text)).not.toEqual(EVAL_PAGE_TOP_PROMPTS);
  });

  it('checks the answer names the five in the page order', () => {
    const [a, b, c, d, e] = EVAL_PAGE_TOP_PROMPTS;
    expect(
      pageTopMissed(`1. ${a}\n2. ${b}\n3. ${c}\n4. ${d}\n5. ${e}`, scenario.pageTop!),
    ).toBeNull();
    expect(pageTopMissed(`1. ${b}\n2. ${a}\n3. ${c}\n4. ${d}\n5. ${e}`, scenario.pageTop!)).toBe(
      `"${b}" before "${a}"`,
    );
    expect(pageTopMissed(`1. ${a}\n2. ${b}`, scenario.pageTop!)).toBe(
      `missing "${c}", "${d}", "${e}"`,
    );
  });
});

// The owner's plan (2026-11-16, item 8): the page's view, its rows on screen and its search.
describe("the page's view", () => {
  it('asks "what are these?" on Actions by Priority Score, three rows on screen, by their codes', () => {
    const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'actions-page-view')!;
    expect(scenario.message).toBe('What are these?');
    expect(scenario.page!.view).toMatchObject({ sort: { key: 'priority', dir: 'desc' }, total: 3 });
    expect(scenario.page!.view!.rows!.map((row) => row.ref)).toEqual(['AC-41', 'AC-42', 'AC-44']);
    expect(scenario.askedActions).toEqual(EVAL_PAGE_VIEW_ACTIONS);
    // No period on Actions: no period check.
    expect(scenario.page!.read).toBeUndefined();
  });

  it('asks "how are these doing?" on Prompts with a search, whose prompts it lists', () => {
    const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'prompts-page-search')!;
    expect(scenario.page!.view!.search).toBe(EVAL_PAGE_SEARCH);
    expect(scenario.pageSearch).toEqual({ tool: 'list_prompts', search: EVAL_PAGE_SEARCH });
    // Every prompt holding the words, and only those; the read by that search finds them.
    expect(EVAL_PAGE_SEARCH_PROMPTS.length).toBeGreaterThan(2);
    for (const prompt of EVAL_PAGE_SEARCH_PROMPTS) {
      expect(prompt.text.toLowerCase()).toContain('coffee subscription');
    }
    const read = evalReadResult('list_prompts', { search: EVAL_PAGE_SEARCH }) as {
      prompts: { id: string }[];
    };
    expect(read.prompts.map((p) => p.id)).toEqual(EVAL_PAGE_SEARCH_PROMPTS.map((p) => p.id));
  });

  it("checks a read took the page's search, and the answer names every row", () => {
    const page = { tool: 'list_prompts', search: 'coffee subscription' };
    const run = (search?: string) => ({
      reads: ['list_prompts'],
      readInputs: [search === undefined ? {} : { search }],
    });
    expect(pageSearchMissed(run(' Coffee Subscription '), page)).toBeNull();
    expect(pageSearchMissed(run('coffee'), page)).toBe('search "coffee"');
    expect(pageSearchMissed(run(), page)).toBe('search null');
    expect(pageSearchMissed({ reads: [], readInputs: [] }, page)).toBe('list_prompts not read');
    expect(unnamedPageRows('A and b.', ['a', 'B', 'c'])).toEqual(['c']);
  });
});

// Step 9 of the owner's plan: the pages that send their context.
describe('the pages that send their context since step 9', () => {
  it('asks "bunlar ne?" on Signals, three rows on screen none of the newest, by their S- codes', () => {
    const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'signals-page-view')!;
    expect(scenario.message).toBe('bunlar ne?');
    expect(scenario.page!.route).toBe('/dashboard/action-center/signals');
    expect(scenario.page!.view!.rows!.map((row) => row.ref)).toEqual(['S-41', 'S-23', 'S-07']);
    expect(scenario.askedSignals).toEqual(EVAL_PAGE_VIEW_SIGNALS);
    // Each title its own: naming one never reads as naming another.
    for (const asked of EVAL_PAGE_VIEW_SIGNALS) {
      expect(EVAL_SIGNAL_BACKLOG.filter((s) => s.title === asked.title)).toHaveLength(1);
    }
    const newest = (
      evalReadResult('list_signals', {}, 'long_lists') as { signals: { code: string }[] }
    ).signals
      .slice(0, 3)
      .map((s) => s.code);
    expect(newest).not.toEqual(expect.arrayContaining(['S-41']));
  });

  it('asks "bu rakibe karşı nerede kaybediyoruz?" on Competitors with one open', () => {
    const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'competitor-open-losses')!;
    expect(scenario.page!.view).toEqual({
      open: { ref: EVAL_OPEN_COMPETITOR.id, label: EVAL_OPEN_COMPETITOR.name },
      query: { competitor: EVAL_OPEN_COMPETITOR.id },
    });
    expect(scenario.pageOpen).toEqual({
      tool: 'get_competitor_head_to_head',
      input: { competitor_id: EVAL_OPEN_COMPETITOR.id },
      names: EVAL_HEAD_TO_HEAD_LOSSES.map((row) => row.prompt),
    });
    // The read finds the open competitor's losses; another's has none, an unknown one is not found.
    const losses = evalReadResult('get_competitor_head_to_head', {
      competitor_id: EVAL_OPEN_COMPETITOR.id,
      side: 'losing',
    }) as { prompts: { prompt: string }[] };
    expect(losses.prompts.map((row) => row.prompt)).toEqual(scenario.pageOpen!.names);
    expect(evalReadResult('get_competitor_head_to_head', { competitor: 'Nobody' })).toEqual({
      not_found: ['Nobody'],
    });
  });

  it('asks "bu konuda en zayıf promptumuz hangisi?" on a topic’s page, whose weakest isn’t the brand’s', () => {
    const scenario = QUESTION_SCENARIOS.find((s) => s.id === 'topic-page-weakest')!;
    expect(scenario.page!.route).toBe(`/dashboard/prompts/topics/${EVAL_OPEN_TOPIC.id}`);
    expect(scenario.page!.view!.open).toEqual({
      ref: EVAL_OPEN_TOPIC.id,
      label: EVAL_OPEN_TOPIC.name,
    });
    // The topic's prompts, best first: the weakest is named, read for that topic.
    expect(EVAL_TOPIC_PROMPTS.map((p) => p.text)).toEqual([
      'Which coffee subscription lets you pause or skip a delivery?',
      'What are the best coffee subscriptions in 2026?',
      'Cheapest specialty coffee subscription',
    ]);
    expect(scenario.pageOpen).toEqual({
      tool: 'get_prompt_performance',
      input: { topic_id: EVAL_OPEN_TOPIC.id },
      names: ['Cheapest specialty coffee subscription'],
    });
    const weakest = (input: Record<string, unknown>) =>
      (
        evalReadResult('get_prompt_performance', { ...input, order: 'asc' }) as {
          prompts: { text: string }[];
        }
      ).prompts[0].text;
    expect(weakest({ topic_id: EVAL_OPEN_TOPIC.id })).toBe(scenario.pageOpen!.names[0]);
    // Over every topic, the weakest is another topic's.
    expect(weakest({})).toBe('Light roast vs dark roast for espresso');
    expect(EVAL_PROMPTS.find((p) => p.text === weakest({}))!.topic).not.toBe(EVAL_OPEN_TOPIC.name);
    // A lookup reads its prompts in every topic.
    const looked = evalReadResult('get_prompt_performance', {
      topic_id: EVAL_OPEN_TOPIC.id,
      prompt_ids: [EVAL_PROMPTS[6].id],
    }) as { prompts: { id: string }[] };
    expect(looked.prompts.map((p) => p.id)).toEqual([EVAL_PROMPTS[6].id]);
  });

  it('checks the read of the item the page holds open, by its read and inputs', () => {
    const open = { tool: 'get_competitor_head_to_head', input: { competitor_id: 'c3' } };
    const run = (tool: string, input: Record<string, unknown>) => ({
      reads: [tool],
      readInputs: [input],
    });
    expect(readOpenItem(run(open.tool, { competitor_id: 'c3', side: 'losing' }), open)).toBe(true);
    expect(readOpenItem(run(open.tool, { competitor_id: 'c1' }), open)).toBe(false);
    expect(readOpenItem(run('list_competitors', { competitor_id: 'c3' }), open)).toBe(false);
  });
});
