import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Content Agent looks a fact up itself (2026-10-30): a page never keeps a
 * "[price]" for the person to find. Found, the fact is written in with a link
 * to its page; not found, its sentence is written without it; only a fact the
 * brand alone has stays, as "Your input needed". The model is mocked.
 */

const generateText = vi.fn();
const reserveAiBudget = vi.fn();
const webSearchTools = vi.fn();

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal()),
  generateText: (...args) => generateText(...args),
}));
vi.mock('./ai-provider.js', () => ({
  resolveModel: (id) => `model:${id}`,
  webSearchTools: (...args) => webSearchTools(...args),
}));
vi.mock('./plan-guard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reserveAiBudget: (...args) => reserveAiBudget(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const {
  MAX_INPUT_PLACEHOLDERS,
  MAX_RESEARCH_SEARCHES,
  RESEARCH_HOLD_USD,
  RESEARCH_RULE,
  applyEdits,
  editHtml,
  gapsIn,
  linkFacts,
  lookUpFacts,
  lookUpSuggestionFacts,
  placeholdersIn,
  readFindings,
  sentenceSpans,
  settler,
  weakSite,
  withFactLinks,
} = await import('./content-research.js');
const { knownNumbers } = await import('./content-sources.js');
const { NAME_PLACEHOLDER } = await import('./content-people.js');
const { RunStoppedError } = await import('./content-runs.js');

const HAIKU = 'anthropic/claude-haiku-5-5';
const PLANS = 'https://www.hootsuite.com/plans';
const STATS = 'https://www.census.gov/ai-use';

/** A run as content-runs.js starts one, not written anywhere. */
const run = () => ({ id: null, steps: [], signal: new AbortController().signal });

/** The user's page (2026-10-29): each gap the writer left, as it now marks them. */
const PAGE = [
  { text: 'Social media tools compared', heading: true },
  {
    text: 'AI use in social media keeps growing: {{find: share of marketers using AI for social media, 2026}}. Pick a tool that fits.',
  },
  { text: 'Compare seats and profiles: {{find: Hootsuite Professional plan price per month}}.' },
  { text: 'Check client workspace limits: {{find: Hootsuite plan limits for client workspaces}}.' },
];

/** A page as a list of texts, edited as lookUpFacts and the settler edit a written page. */
const mapTexts = (texts) => (editsFor) =>
  texts.map(({ text, heading = false }) => ({
    text: applyEdits(text, editsFor(text, heading)),
    heading,
  }));

/** The pass's answer: some words, then its JSON, as the model ends it. */
const answer = (facts, extra = {}) => ({
  text: `I searched the plans page.\n\n\`\`\`json\n${JSON.stringify({ facts })}\n\`\`\``,
  sources: [
    { sourceType: 'url', url: PLANS, title: 'Plans' },
    { sourceType: 'url', url: STATS, title: 'AI use' },
    { sourceType: 'url', url: 'https://www.reddit.com/r/socialmedia/hootsuite', title: 'r/sm' },
  ],
  usage: { inputTokens: 20_000, outputTokens: 800 },
  providerMetadata: { anthropic: { usage: { server_tool_use: { web_search_requests: 2 } } } },
  ...extra,
});

let budget;

beforeEach(() => {
  generateText.mockReset();
  reserveAiBudget.mockReset();
  webSearchTools.mockReset();
  budget = {
    charge: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    keep: vi.fn(async () => {}),
  };
  reserveAiBudget.mockResolvedValue(budget);
  webSearchTools.mockReturnValue({ web_search: { id: 'anthropic.web_search_20250305' } });
});

/** The pass on the page above, then what stays settled, as content-writer.js runs them. */
async function research(texts = PAGE, known = knownNumbers('2026')) {
  const looked = await lookUpFacts({
    map: mapTexts(texts),
    known,
    orgId: 'org-1',
    draftId: 'd1',
    modelId: HAIKU,
    run: run(),
    context: { brand: 'Ansvisor', title: 'Social media tools', language: 'English' },
  });
  const settled = mapTexts(looked.page)(settler());
  return {
    looked,
    settled,
    html: linkFacts(settled.map((t) => `<p>${t.text}</p>`).join(''), looked.links),
  };
}

describe('the writer is told to look facts up, never to leave a placeholder', () => {
  it('asks for {{find}} for a public fact and {{ask}} for the brand’s own, never square brackets', () => {
    expect(RESEARCH_RULE).toContain('{{find: what to look up}}');
    expect(RESEARCH_RULE).toContain('{{ask: what to add}}');
    expect(RESEARCH_RULE).toContain(`At most ${MAX_INPUT_PLACEHOLDERS} in all`);
    expect(RESEARCH_RULE).toContain('Never write a placeholder in square brackets');
  });
});

describe('gapsIn', () => {
  it('reads each marker, gap and unsourced figure, sentence by sentence', () => {
    const text =
      'Hootsuite costs {{find: Hootsuite price}}. 40% of teams use it [source]. It has 3 plans. It was founded in 2008.';
    const gaps = gapsIn(text, knownNumbers('2026'));
    expect(gaps.map((g) => [g.sentence, g.needs])).toEqual([
      ['Hootsuite costs {{find: Hootsuite price}}.', ['find: Hootsuite price']],
      ['40% of teams use it [source].', ['fill: [source]', 'check: 40%']],
      // "3 plans" is a count, not a claim; 2008 is a figure to check.
      ['It was founded in 2008.', ['check: 2008']],
    ]);
  });

  it('leaves the brand’s own asks, the page’s placeholders, the people guard’s and a heading alone', () => {
    const allowed = new Set(['[your discount code]']);
    expect(
      gapsIn(
        `We serve {{ask: number of customers}} teams. Use [your discount code]. ${NAME_PLACEHOLDER} says so.`,
        new Set(),
        { allowed },
      ),
    ).toEqual([]);
    expect(gapsIn('Pricing in {{find: year}}', new Set(), { heading: true })).toEqual([]);
  });

  it('never ends a sentence inside a marker, and never reads a kept line as a gap', () => {
    expect(sentenceSpans('Costs {{find: price. per month}}. Done.')).toHaveLength(2);
    expect(gapsIn('[[KEEP 1]]', new Set())).toEqual([]);
    expect(placeholdersIn('[[KEEP 2]] and [plan limits]')).toEqual(['[plan limits]']);
  });
});

describe('lookUpFacts', () => {
  it('leaves no placeholder: each fact found is written in, linked to the page it came from', async () => {
    generateText.mockResolvedValue(
      answer([
        {
          id: 'G1',
          text: 'AI use in social media keeps growing: 68% of marketers used AI for social media in 2026.',
          source: STATS,
          words: '68% of marketers',
        },
        {
          id: 'G2',
          text: 'Compare seats and profiles: the Professional plan costs $99 per month.',
          source: `${PLANS}/`,
          words: '$99 per month',
        },
        {
          id: 'G3',
          text: 'Check client workspace limits: each plan sets how many social accounts it holds.',
          source: null,
          words: '',
        },
      ]),
    );
    const { looked, settled, html } = await research();

    // No [ ], no {{ }} anywhere.
    for (const { text } of settled) {
      expect(text).not.toMatch(/\[[^\]]+\]/);
      expect(text).not.toMatch(/\{\{/);
    }
    expect(settled[1].text).toBe(
      'AI use in social media keeps growing: 68% of marketers used AI for social media in 2026. Pick a tool that fits.',
    );
    // Each source, linked on the words it supports; the address as the search returned it.
    expect(html).toContain(`<a href="${STATS}">68% of marketers</a>`);
    expect(html).toContain(`<a href="${PLANS}">$99 per month</a>`);
    expect(looked.found).toBe(2);
    // Its figures are known now: the number guard leaves them.
    expect(looked.learned).toEqual(expect.arrayContaining(['68|%', '99']));
  });

  it('takes a fact it couldn’t find out of its sentence, and a sentence it didn’t settle out of the page', async () => {
    generateText.mockResolvedValue(
      answer([
        // Not found: written without it.
        { id: 'G2', text: 'Compare seats and profiles on each plan.', source: null },
        // G1 and G3 left unanswered.
      ]),
    );
    const { settled, html } = await research();
    expect(settled[1].text).toBe('Pick a tool that fits.');
    expect(settled[2].text).toBe('Compare seats and profiles on each plan.');
    expect(settled[3].text).toBe('');
    expect(html).not.toContain('<a ');
  });

  it('never takes a figure without a source, a page the search didn’t return or a forum', async () => {
    generateText.mockResolvedValue(
      answer([
        // A figure, with no page behind it.
        { id: 'G1', text: 'AI use keeps growing: 70% of marketers use it.', source: null },
        // A page the search never returned.
        {
          id: 'G2',
          text: 'Compare seats and profiles: the Professional plan costs $99 per month.',
          source: 'https://made-up.example/pricing',
          words: '$99 per month',
        },
        // A forum anyone writes in.
        {
          id: 'G3',
          text: 'Check client workspace limits: 5 workspaces on Professional.',
          source: 'https://www.reddit.com/r/socialmedia/hootsuite',
          words: '5 workspaces',
        },
      ]),
    );
    const { settled } = await research();
    expect(settled.map((t) => t.text)).toEqual([
      'Social media tools compared',
      'Pick a tool that fits.',
      '',
      '',
    ]);
    expect(weakSite('https://www.reddit.com/r/x')).toBe(true);
    expect(weakSite(PLANS)).toBe(false);
  });

  it('checks a figure the writer wrote with no source, and keeps it only with one', async () => {
    generateText.mockResolvedValue(
      answer([
        {
          id: 'G1',
          text: 'About 68% of marketers used AI for social media in 2026.',
          source: STATS,
          words: 'About 68% of marketers',
        },
      ]),
    );
    const known = knownNumbers('2026');
    const { settled, html } = await research(
      [{ text: 'About 70% of marketers use AI for social media.' }],
      known,
    );
    expect(generateText.mock.calls[0][0].prompt).toContain('needs: check: 70%');
    expect(settled[0].text).toBe('About 68% of marketers used AI for social media in 2026.');
    expect(html).toContain(`<a href="${STATS}">About 68% of marketers</a>`);
    expect(known.has('68|%')).toBe(true);
  });

  it('searches on the read model, at most five times, charged with its searches on its own hold', async () => {
    generateText.mockResolvedValue(answer([]));
    await research();
    expect(reserveAiBudget).toHaveBeenCalledWith('org-1', {
      feature: 'content',
      modelId: HAIKU,
      draftId: 'd1',
      holdUsd: RESEARCH_HOLD_USD,
    });
    expect(RESEARCH_HOLD_USD).toBeCloseTo(0.06, 6);
    expect(webSearchTools).toHaveBeenCalledWith(HAIKU, { maxUses: MAX_RESEARCH_SEARCHES });
    const call = generateText.mock.calls[0][0];
    expect(call.model).toBe(`model:${HAIKU}`);
    expect(call.tools).toEqual({ web_search: { id: 'anthropic.web_search_20250305' } });
    expect(call.maxOutputTokens).toBe(16_000);
    expect(call.system).toContain('at most 5 searches in all');
    expect(call.system).toContain('Never a forum, a Q&A site, a social post');
    expect(call.prompt).toContain(
      'G2: "Compare seats and profiles: {{find: Hootsuite Professional plan price per month}}."',
    );
    expect(call.prompt).toContain('needs: find: Hootsuite Professional plan price per month');
    // Its tokens and its two searches.
    expect(budget.charge).toHaveBeenCalledWith(
      { inputTokens: 20_000, outputTokens: 800 },
      { searches: 2 },
    );
  });

  it('calls nothing for a page with no gap', async () => {
    const texts = [{ text: 'Pick a tool that fits your team.' }];
    const { looked } = await research(texts);
    expect(generateText).not.toHaveBeenCalled();
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(looked.page).toEqual(texts.map((t) => ({ ...t, heading: false })));
  });

  it('takes the sentences out when the budget is used up, the call fails, or there is no search', async () => {
    reserveAiBudget.mockRejectedValueOnce(Object.assign(new Error('used up'), { code: 'limit' }));
    let { settled } = await research();
    expect(generateText).not.toHaveBeenCalled();
    expect(settled.map((t) => t.text)).toEqual([
      'Social media tools compared',
      'Pick a tool that fits.',
      '',
      '',
    ]);

    generateText.mockRejectedValueOnce(new Error('overloaded'));
    ({ settled } = await research());
    expect(settled[2].text).toBe('');
    expect(budget.release).toHaveBeenCalled();

    // Through OpenRouter: no search, so each is written without what it needs.
    webSearchTools.mockReturnValue(null);
    generateText.mockResolvedValueOnce(
      answer([{ id: 'G2', text: 'Compare seats and profiles.', source: null }]),
    );
    ({ settled } = await research());
    expect(generateText.mock.lastCall[0]).not.toHaveProperty('tools');
    expect(generateText.mock.lastCall[0].system).toContain("You can't search the web now");
    expect(settled[2].text).toBe('Compare seats and profiles.');
  });

  it('lets a Stop through', async () => {
    const stopped = run();
    generateText.mockRejectedValue(new RunStoppedError());

    await expect(
      lookUpFacts({
        map: mapTexts(PAGE),
        known: new Set(),
        orgId: 'org-1',
        draftId: 'd1',
        modelId: HAIKU,
        run: stopped,
      }),
    ).rejects.toBeInstanceOf(RunStoppedError);
    // The call went out: the provider bills it, so its hold stays as its cost.
    expect(budget.keep).toHaveBeenCalled();
  });
});

describe('settler', () => {
  it('asks the person only for the brand’s own facts, at most three a page, as "Your input needed"', () => {
    const settle = settler();
    const texts = mapTexts([
      { text: 'We serve {{ask: number of customers}} teams.' },
      { text: 'Our churn is {{ask: churn rate}} and our NPS is {{ask: NPS}}.' },
      { text: 'Our team grew to {{ask: team size}}. Pick a plan.' },
      { text: 'Plans and {{ask: price}}', heading: true },
    ])(settle);
    expect(texts.map((t) => t.text)).toEqual([
      'We serve [number of customers] teams.',
      'Our churn is [churn rate] and our NPS is [NPS].',
      // Past the three: its sentence goes.
      'Pick a plan.',
      // A heading never keeps one.
      'Plans and',
    ]);
    expect(texts.flatMap((t) => placeholdersIn(t.text))).toHaveLength(MAX_INPUT_PLACEHOLDERS);
  });

  it('takes out a sentence with a gap the search left: a {{find}}, the number guard’s, a claim’s source', () => {
    const texts = mapTexts([
      { text: 'Costs {{find: price}}. Fits small teams.' },
      { text: 'Use [figure, source] g of coffee. Grind it fresh.' },
      { text: 'According to [source], it works. It is fast.' },
      { text: 'It has [your discount code] for you.' },
    ])(settler(new Set(['[your discount code]'])));
    expect(texts.map((t) => t.text)).toEqual([
      'Fits small teams.',
      'Grind it fresh.',
      'It is fast.',
      // The page’s own placeholder stays.
      'It has [your discount code] for you.',
    ]);
  });
});

describe('readFindings', () => {
  const gaps = [{ id: 'G1', sentence: 'It costs {{find: price}}.', needs: ['find: price'] }];
  const sources = [{ url: PLANS }];

  it('reads the JSON at the end of the answer, however it is written', () => {
    const text =
      'Notes first.\n{ "facts": [{"id":"g1","text":"It costs $99 a month.","source":"https://hootsuite.com/plans","words":"$99 a month"}] }';
    expect(readFindings(text, gaps, sources, new Set()).get('G1')).toEqual({
      text: 'It costs $99 a month.',
      link: { words: '$99 a month', url: PLANS },
    });
    expect(readFindings('no JSON at all', gaps, sources, new Set()).size).toBe(0);
  });

  it('never takes a marker, a new placeholder or the words of a page it didn’t find', () => {
    const read = (fact) =>
      readFindings(JSON.stringify({ facts: [{ id: 'G1', ...fact }] }), gaps, sources, new Set());
    expect(read({ text: 'It costs {{find: price}}.', source: null }).size).toBe(0);
    expect(read({ text: 'It costs [price].', source: null }).size).toBe(0);
    // Words it doesn't have: the link goes on the figure.
    expect(
      read({ text: 'It costs $99 a month.', source: PLANS, words: 'ninety-nine' }).get('G1').link,
    ).toEqual({ words: '$99', url: PLANS });
  });
});

describe('suggestions', () => {
  it('looks up a suggestion’s facts and lets its link through the links rule', async () => {
    generateText.mockResolvedValue(
      answer([
        {
          id: 'G1',
          text: 'Hootsuite’s Professional plan costs $99 per month.',
          source: PLANS,
          words: '$99 per month',
        },
      ]),
    );
    const known = new Set();
    const looked = await lookUpSuggestionFacts({
      suggestions: [
        { kind: 'replace', after: 'Hootsuite’s Professional plan costs {{find: price}}.' },
        { kind: 'insert', after: '<p>Read the <a href="https://ansvisor.com/blog">guide</a>.</p>' },
      ],
      known,
      orgId: 'org-1',
      draftId: 'd1',
      modelId: HAIKU,
      run: run(),
    });
    expect(looked.suggestions[0].after).toBe(
      `Hootsuite’s Professional plan costs <a href="${PLANS}">$99 per month</a>.`,
    );
    // Unchanged, as it was.
    expect(looked.suggestions[1].after).toBe(
      '<p>Read the <a href="https://ansvisor.com/blog">guide</a>.</p>',
    );
    const allow = withFactLinks(
      new Map([['ansvisor.com/blog', 'https://ansvisor.com/blog']]),
      looked.links,
    );
    expect(allow.get('hootsuite.com/plans')).toBe(PLANS);
    expect(allow.get('ansvisor.com/blog')).toBe('https://ansvisor.com/blog');
  });
});

describe('editHtml', () => {
  it('edits a line across its bold, and drops a paragraph left with no words', () => {
    const html = '<p>About <strong>70%</strong> of teams use it.</p><p>Keep this.</p>';
    const out = editHtml(html, (text) =>
      text.startsWith('About') ? [{ start: 0, end: text.length, text: '' }] : [],
    );
    expect(out).toBe('<p>Keep this.</p>');
  });
});
