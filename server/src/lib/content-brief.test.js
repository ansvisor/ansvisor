import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Rebuild outline (Content Editor CE-007): the brief written from the
 * sources the person kept, metered from the AI usage budget.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';
const PROMPT = '55555555-5555-5555-5555-555555555555';

let rows;
let writes;
let filters;
const generateObject = vi.fn();
const reserveAiBudget = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      filters.push(call);
      const result = () => ({ data: rows[table] ?? null, error: null });
      const chain = {
        select: () => chain,
        eq: (col, v) => (call.filters.push(['eq', col, v]), chain),
        in: (col, v) => (call.filters.push(['in', col, v]), chain),
        insert: async (value) => (writes.push({ table, op: 'insert', value }), { error: null }),
        update: (value) => (writes.push({ table, op: 'update', value }), chain),
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve) => resolve(result()),
      };
      return chain;
    },
  },
}));
/** The writes but the run's own steps (content_agent_runs, 00249). */
const draftWrites = () => writes.filter((w) => w.table !== 'content_agent_runs');
class NoObjectGeneratedError extends Error {
  static isInstance(err) {
    return err instanceof NoObjectGeneratedError;
  }
}
vi.mock('ai', () => ({
  generateObject: (...args) => generateObject(...args),
  NoObjectGeneratedError,
}));
vi.mock('./ai-provider.js', () => ({ resolveModel: vi.fn((id) => `model:${id}`) }));
vi.mock('./plan-guard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reserveAiBudget: (...args) => reserveAiBudget(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const citedPagesLength = vi.fn();
vi.mock('./content-cited-length.js', () => ({
  citedPagesLength: (...args) => citedPagesLength(...args),
}));
const stopIfStopped = vi.fn();
vi.mock('./content-runs.js', async (importOriginal) => ({
  ...(await importOriginal()),
  stopIfStopped: (...args) => stopIfStopped(...args),
}));

const {
  BRIEF_FORMATS,
  BRIEF_V2_LIMITS,
  FACT_SOURCES,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_V2,
  briefGuard,
  buildBriefPrompt,
  mapOutline,
  outlineSchema,
  outlineSchemaV2,
  briefNumbered,
  briefRules,
  rebuildDraftBrief,
  rebuildSources,
} = await import('./content-brief.js');
const { NAME_PLACEHOLDER, QUOTE_PLACEHOLDER } = await import('./content-people.js');
const { NUMBER_PLACEHOLDER } = await import('./content-sources.js');
const { PlanLimitError } = await import('./plan-guard.js');
// The real hold: self-hosted here, so it reserves nothing and writes each charge.
const realGuard = await vi.importActual('./plan-guard.js');

const sources = (over = {}) => ({
  promptIds: [PROMPT],
  fanouts: [
    { query: 'Best espresso machine under 500', platforms: ['perplexity-web', 'copilot-web'] },
    { query: 'home espresso grinder', platforms: ['copilot-web'] },
  ],
  pages: [{ url: 'https://www.reddit.com/r/espresso/x', kind: 'forum' }],
  queries: ['espresso machine under 500'],
  headings: ['Choosing a machine'],
  length: 3000,
  ...over,
});

/** The rules in effect, as Fix sends them. */
const RULES = [{ key: 'h2Answer', name: 'Answer under each H2', detail: 'aim: 60 words' }];

const outline = [
  {
    heading: 'The best espresso machines under $500',
    keyPoints: ['Price bands', ' '],
    fanout: 'best espresso machine UNDER 500',
    platform: 'copilot-web',
  },
  {
    heading: 'Grinders',
    keyPoints: ['Burr vs blade'],
    fanout: 'home espresso grinder',
    platform: 'chatgpt',
  },
  { heading: 'Care', keyPoints: [], fanout: 'made up search', platform: 'copilot-web' },
];

beforeEach(() => {
  stopIfStopped.mockReset().mockResolvedValue(undefined);
  citedPagesLength.mockReset().mockResolvedValue({ characters: 4300, pages: 1 });
  writes = [];
  filters = [];
  rows = {
    content_drafts: {
      id: DRAFT,
      brand_id: BRAND,
      title: 'The home espresso guide',
      page_type: 'buying_guide',
      method: 'optimize',
      source_url: 'https://acme.example/guides/espresso',
    },
    brands: {
      name: 'Acme Coffee',
      industry: 'Food & Beverage',
      description: null,
      organization_id: 'o1',
      language: 'tr',
    },
    prompts: [{ id: PROMPT, text: 'Best espresso machines under $500?' }],
  };
  generateObject.mockReset().mockResolvedValue({
    object: {
      goal: ' Help buyers pick ',
      audience: 'Home baristas',
      outline,
      keywords: ['espresso', 'espresso', ' grinder '],
    },
    usage: { inputTokens: 1000, outputTokens: 500 },
  });
  reserveAiBudget.mockReset().mockImplementation(realGuard.reserveAiBudget);
});

describe('rebuildDraftBrief', () => {
  it('puts a number, name or quote its sources don\u2019t have as a placeholder, as the writer would', async () => {
    const year = new Date().getUTCFullYear();
    generateObject.mockResolvedValue({
      object: {
        goal: 'Win 73% of home baristas',
        audience: 'Home baristas who drink 4 cups a day',
        outline: [
          {
            heading: 'The 12 best espresso machines under $500',
            keyPoints: [
              'Dr. Jane Doe recommends a flat burr',
              '"Pressure matters far more than price," says the owner',
              'Machines under 500 dollars',
              'Compare 3 grinders',
              `The best machines of ${year}`,
            ],
            fanout: 'home espresso grinder',
            platform: 'copilot-web',
          },
        ],
        keywords: ['espresso', 'top 12 espresso machines', 'espresso under 500'],
      },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });

    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });

    expect(brief.goal).toBe(`Win ${NUMBER_PLACEHOLDER} of home baristas`);
    // A lone digit is a count, as on a page.
    expect(brief.audience).toBe('Home baristas who drink 4 cups a day');
    expect(brief.outline).toEqual([
      {
        // A heading's number as a page's: "$500" is the prompt's.
        heading: `The ${NUMBER_PLACEHOLDER} best espresso machines under $500`,
        keyPoints: [
          `${NAME_PLACEHOLDER} recommends a flat burr`,
          `${QUOTE_PLACEHOLDER} says the owner`,
          // The fan-out's number, a count and this year stay.
          'Machines under 500 dollars',
          'Compare 3 grinders',
          `The best machines of ${year}`,
        ],
        fanout: 'home espresso grinder',
        platform: 'copilot-web',
      },
    ]);
    // A keyword that adds one goes: a placeholder can't be searched for.
    expect(brief.keywords).toEqual(['espresso', 'espresso under 500']);
    expect(draftWrites().at(-1)).toEqual({
      table: 'content_drafts',
      op: 'update',
      value: { brief },
    });
  });

  it('writes the brief from the kept sources, charges AI usage, and saves it on the draft', async () => {
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });

    expect(reserveAiBudget).toHaveBeenCalledWith('o1', {
      feature: 'content',
      modelId: 'google/gemini-3-flash-preview',
      draftId: DRAFT,
    });
    const call = generateObject.mock.calls[0][0];
    expect(call.model).toBe('model:google/gemini-3-flash-preview');
    expect(call.prompt).toContain('- Best espresso machines under $500?');
    expect(call.prompt).toContain(
      '"Best espresso machine under 500" (perplexity-web, copilot-web)',
    );
    expect(call.prompt).toContain('Existing page to improve: https://acme.example/guides/espresso');
    expect(call.prompt).toContain('- Choosing a machine');
    expect(call.prompt).toContain('Write the brief in Turkish.');

    expect(brief).toMatchObject({
      goal: 'Help buyers pick',
      audience: 'Home baristas',
      keywords: ['espresso', 'grinder'],
      origin: 'rebuild',
      builtFrom: { prompts: 1, fanouts: 2, pages: 1, queries: 1 },
      // The cited pages' length (CE-030), read without the draft's own page.
      citedLength: { characters: 4300, pages: 1 },
    });
    expect(citedPagesLength).toHaveBeenCalledWith({
      brandId: BRAND,
      pages: [{ url: 'https://www.reddit.com/r/espresso/x', kind: 'forum' }],
      ownUrl: 'https://acme.example/guides/espresso',
      // The run's Stop ends the reads at once.
      signal: expect.any(AbortSignal),
    });
    expect(brief.outline).toEqual([
      {
        heading: 'The best espresso machines under $500',
        keyPoints: ['Price bands'],
        fanout: 'Best espresso machine under 500',
        platform: 'copilot-web',
      },
      // A platform that didn't run the search: the one that did.
      {
        heading: 'Grinders',
        keyPoints: ['Burr vs blade'],
        fanout: 'home espresso grinder',
        platform: 'copilot-web',
      },
      // A search the person didn't keep: none.
      { heading: 'Care', keyPoints: [], fanout: null, platform: null },
    ]);

    expect(draftWrites()).toEqual([
      {
        table: 'prompt_improve_usage',
        op: 'insert',
        value: expect.objectContaining({
          organization_id: 'o1',
          content_draft_id: DRAFT,
          feature: 'content',
          input_tokens: 1000,
        }),
      },
      { table: 'content_drafts', op: 'update', value: { brief } },
    ]);
    // Only the brand's prompts are read.
    expect(filters.find((f) => f.table === 'prompts').filters).toEqual([
      ['in', 'id', [PROMPT]],
      ['eq', 'prompt_sets.brand_id', BRAND],
    ]);
  });

  it('refuses a draft of another brand before any model call', async () => {
    rows.content_drafts = {
      ...rows.content_drafts,
      brand_id: '44444444-4444-4444-4444-444444444444',
    };
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toMatchObject({
      status: 404,
    });
    rows.content_drafts = null;
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('needs a prompt, a fan-out or a query to build from', async () => {
    rows.prompts = [];
    await expect(
      rebuildDraftBrief({
        draftId: DRAFT,
        brandId: BRAND,
        sources: sources({ fanouts: [], queries: [] }),
      }),
    ).rejects.toMatchObject({ status: 422, code: 'no_sources' });
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('reads the prompts through their prompt set, so a prompt with no topic counts', async () => {
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(filters.find((call) => call.table === 'prompts').filters).toContainEqual([
      'eq',
      'prompt_sets.brand_id',
      BRAND,
    ]);
  });

  it('cuts the model’s answer to the limits the editor reads a brief with', async () => {
    generateObject.mockResolvedValue({
      object: {
        goal: 'g'.repeat(600),
        audience: 'Home baristas',
        outline: [
          { heading: '   ', keyPoints: ['Lost'], fanout: null, platform: null },
          {
            heading: 'h'.repeat(400),
            // Letters: a number the sources don't have would go as a placeholder.
            keyPoints: Array.from({ length: 10 }, (_, i) =>
              String.fromCharCode(97 + i).repeat(600),
            ),
            fanout: null,
            platform: null,
          },
          ...Array.from({ length: 14 }, (_, i) => ({
            heading: `Section ${String.fromCharCode(97 + i)}`,
            keyPoints: [],
            fanout: null,
            platform: null,
          })),
        ],
        keywords: Array.from(
          { length: 20 },
          (_, i) => `${String.fromCharCode(97 + i)}${'k'.repeat(90)}`,
        ),
      },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(brief.goal).toHaveLength(500);
    // The empty heading went; the rest is capped at 12 sections.
    expect(brief.outline).toHaveLength(12);
    expect(brief.outline[0].heading).toHaveLength(300);
    expect(brief.outline[0].keyPoints).toHaveLength(8);
    expect(brief.outline[0].keyPoints.every((p) => p.length === 500)).toBe(true);
    expect(brief.keywords).toHaveLength(15);
    expect(brief.keywords.every((k) => k.length <= 80)).toBe(true);
  });

  it('saves nothing once stopped, and says so (CE-027)', async () => {
    const { RunStoppedError } = await import('./content-runs.js');
    stopIfStopped.mockRejectedValueOnce(new RunStoppedError());
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toMatchObject({ status: 409, code: 'stopped' });
    // The call was made and charged; the brief stays as it was.
    expect(draftWrites().filter((w) => w.table === 'content_drafts')).toEqual([]);
  });

  it('charges a call whose answer didn’t fit, then fails', async () => {
    generateObject.mockRejectedValue(
      Object.assign(new NoObjectGeneratedError('no object'), {
        usage: { inputTokens: 900, outputTokens: 300 },
      }),
    );
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toBeInstanceOf(NoObjectGeneratedError);
    expect(draftWrites()).toEqual([
      expect.objectContaining({
        table: 'prompt_improve_usage',
        op: 'insert',
        value: expect.objectContaining({ input_tokens: 900, output_tokens: 300 }),
      }),
    ]);
  });

  it('lets the hold on the budget go when the model times out', async () => {
    const held = { charge: vi.fn(), release: vi.fn() };
    reserveAiBudget.mockResolvedValueOnce(held);
    generateObject.mockRejectedValue(new Error('timeout'));
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toThrow('timeout');
    expect(held.charge).not.toHaveBeenCalled();
    expect(held.release).toHaveBeenCalled();
  });

  it('stops when the AI usage budget is spent', async () => {
    reserveAiBudget.mockRejectedValue(new PlanLimitError('used up', 429));
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(generateObject).not.toHaveBeenCalled();
    expect(draftWrites()).toEqual([]);
  });
});

describe('rebuildSources', () => {
  it('cuts long text and drops empty items rather than refusing the rebuild', () => {
    const parsed = rebuildSources.parse(
      sources({
        headings: ['x'.repeat(400), '   ', 'Care'],
        queries: [' espresso ', ''],
        fanouts: [{ query: 'q'.repeat(350), platforms: ['p'.repeat(70)] }],
      }),
    );
    expect(parsed.headings).toEqual(['x'.repeat(300), 'Care']);
    expect(parsed.queries).toEqual(['espresso']);
    expect(parsed.fanouts[0].query).toHaveLength(300);
    expect(parsed.fanouts[0].platforms[0]).toHaveLength(60);
  });

  it('brings the length into the range a rebuild takes', () => {
    expect(rebuildSources.parse(sources({ length: 50 })).length).toBe(100);
    expect(rebuildSources.parse(sources({ length: 60_000 })).length).toBe(50_000);
  });
});

describe('briefRules', () => {
  it('reads the rules as Fix sends them, cut to fit, a rule without a detail too', () => {
    expect(
      briefRules.parse([
        { key: 'faq', name: 'FAQ' },
        { key: 'h2Answer', name: 'n'.repeat(250), detail: 'd'.repeat(600) },
      ]),
    ).toEqual([
      { key: 'faq', name: 'FAQ', detail: '' },
      { key: 'h2Answer', name: 'n'.repeat(200), detail: 'd'.repeat(500) },
    ]);
    expect(briefRules.safeParse(Array(61).fill({ key: 'faq', name: 'FAQ' })).success).toBe(false);
  });
});

describe('the brief guard', () => {
  const guardFor = (over = {}) =>
    briefGuard({
      brand: { name: 'Acme 24', industry: null, description: 'Roasting since 1998' },
      draft: { title: 'The 2019 espresso guide' },
      prompts: ['Who is Ada Lovelace?'],
      sources: sources({ headings: ['Our 7-day trial'] }),
      ...over,
    });

  it('knows what the brief was built from: the brand, the page, its sources and the length', () => {
    const guard = guardFor();
    for (const text of [
      'Acme 24 has roasted since 1998',
      'Update the 2019 guide',
      'Keep the 7-day trial',
      'About 3,000 characters',
      'Machines under 500',
      'Ask Ada Lovelace',
    ]) {
      expect(guard.text(text)).toBe(text);
    }
  });

  it('puts what it adds as a placeholder, and drops a keyword that adds one', () => {
    const guard = guardFor();
    expect(guard.text('Prices rose 40% in 2021')).toBe(
      `Prices rose ${NUMBER_PLACEHOLDER} in ${NUMBER_PLACEHOLDER}`,
    );
    expect(guard.heading('Why CEO Grace Hopper chose Acme')).toBe(
      'Why CEO Grace Hopper chose Acme',
    );
    expect(guard.text('Ask CEO Grace Hopper')).toBe(`Ask CEO ${NAME_PLACEHOLDER}`);
    expect(guard.keeps('espresso under 500')).toBe(true);
    expect(guard.keeps('espresso 2021')).toBe(false);
    expect(guard.text(null)).toBe('');
  });

  it('reads names in a heading by their honorific, and drops a keyword that names someone', () => {
    const guard = guardFor();
    expect(guard.heading('Why Dr. Jane Doe pulls short shots')).toBe(
      `Why ${NAME_PLACEHOLDER} pulls short shots`,
    );
    expect(guard.keeps('Dr. Jane Doe espresso')).toBe(false);
  });

  it('leaves a question in quotes alone: it is one to answer, not a quote', () => {
    const guard = guardFor();
    expect(guard.text('Answer "Which espresso machine should I buy first?" up top')).toBe(
      'Answer "Which espresso machine should I buy first?" up top',
    );
    expect(guard.text('Quote “Pressure matters far more than price for beginners”')).toBe(
      `Quote ${QUOTE_PLACEHOLDER}`,
    );
  });

  it('reads Turkish percentages as the writer does', () => {
    const guard = guardFor({ prompts: ['Espresso makinelerinde %25 indirim var mı?'] });
    expect(guard.text('%25 indirimi anlat')).toBe('%25 indirimi anlat');
    expect(guard.text('Satışlar yüzde 40 arttı')).toBe(
      `Satışlar yüzde ${NUMBER_PLACEHOLDER} arttı`,
    );
  });
});

describe('the brief\u2019s cut', () => {
  it('never splits a placeholder: one the cut would reach goes whole', () => {
    const [section] = mapOutline(
      [
        {
          heading: 'Heading',
          keyPoints: [`${'a'.repeat(490)} ${NUMBER_PLACEHOLDER}`],
          fanout: null,
          platform: null,
        },
      ],
      [],
    );
    expect(section.keyPoints).toEqual(['a'.repeat(490)]);
  });
});

describe('the brief prompt', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('says a new page is new, and lists none where a source is empty', () => {
    const prompt = buildBriefPrompt({
      brand: { name: 'Acme', language: 'en' },
      draft: { title: 'Grinders', page_type: null, method: 'create', source_url: null },
      prompts: [],
      sources: sources({ fanouts: [], pages: [], queries: ['burr grinder'], headings: [] }),
    });
    expect(prompt).toContain('A new page.');
    expect(prompt).toContain('Page type: not set');
    expect(prompt).toContain('Prompts the page must answer:\n- none');
    expect(prompt).toContain('- burr grinder');
    expect(prompt).not.toContain('headings now');
    expect(prompt).toContain('Write the brief in English.');
  });

  it('names the brand’s site type once Quality’s phase 2 is live (CE-056)', () => {
    const draft = { title: 'Rain jackets', page_type: null, method: 'create', source_url: null };
    const read = (phase) => {
      vi.stubEnv('CONTENT_QUALITY_PHASE', phase);
      return buildBriefPrompt({
        brand: { name: 'Acme', industry: 'Fashion & Apparel', language: 'en' },
        draft,
        prompts: [],
        sources: sources({ fanouts: [], pages: [], queries: [], headings: [] }),
      });
    };
    expect(read('2')).toContain(
      'Industry: Fashion & Apparel\nSite type: E-commerce (an online shop selling products)\nDescription:',
    );
    expect(read('1')).toContain('Industry: Fashion & Apparel\nDescription:');
  });

  it('matches a fan-out copied in its quotes, one written as listed first', () => {
    const fanouts = [
      { query: 'best crm', platforms: ['chatgpt'] },
      { query: '"best crm"', platforms: ['copilot-web'] },
      { query: 'crm for startups', platforms: ['perplexity-web'] },
    ];
    const section = (fanout) => ({ heading: 'H', keyPoints: [], fanout, platform: null });
    expect(
      mapOutline(
        [section('"best crm"'), section('best crm'), section('“crm for startups”')],
        fanouts,
      ).map((s) => s.fanout),
    ).toEqual(['"best crm"', 'best crm', 'crm for startups']);
  });

  it('maps an outline with no fan-outs kept to none', () => {
    expect(mapOutline(outline.slice(0, 1), [])).toEqual([
      {
        heading: 'The best espresso machines under $500',
        keyPoints: ['Price bands'],
        fanout: null,
        platform: null,
      },
    ]);
  });
});

describe('the brief rules (2026), behind CONTENT_BRIEF_RULES', () => {
  afterEach(() => {
    delete process.env.CONTENT_BRIEF_RULES;
  });

  it('asks as before while they are off: the same rules, schema and prompt', async () => {
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources(), rules: RULES });
    const call = generateObject.mock.calls[0][0];
    expect(call.system).toBe(SYSTEM_PROMPT);
    expect(call.schema).toBe(outlineSchema);
    expect(call.prompt).not.toMatch(/\bS\d+: /);
    expect(call.prompt).not.toContain('Its sections lean to');
    expect(call.prompt).not.toContain('Rules the page is written to');
    const brief = writes.find((w) => w.table === 'content_drafts')?.value.brief;
    expect(brief).not.toHaveProperty('version');
    expect(brief.outline[0]).not.toHaveProperty('answer');
  });

  it('asks for each section’s answer, format and facts, with the cited pages numbered and the rules', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    generateObject.mockResolvedValue({
      object: { goal: 'g', audience: 'a', outline: [], keywords: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources(), rules: RULES });
    const call = generateObject.mock.calls[0][0];
    expect(call.system).toBe(SYSTEM_PROMPT_V2);
    expect(call.schema).toBe(outlineSchemaV2);
    // The cited pages by number; a prompt, a fan-out or a query is a question, not a source.
    expect(call.prompt).toContain('- S1: https://www.reddit.com/r/espresso/x (forum)');
    expect(call.prompt).toContain('- Best espresso machines under $500?');
    expect(call.prompt).toContain('- "Best espresso machine under 500"');
    expect(call.prompt).not.toContain('S2');
    expect(call.prompt).toContain(
      'Its sections lean to: a list of the criteria, and a table of the picks.',
    );
    expect(call.prompt).toContain(
      'Rules the page is written to:\n- Answer under each H2: aim: 60 words',
    );
  });

  it('keeps each section’s plan, cut and guarded as the rest, its facts’ sources by kind and ref', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    const fact = (over) => ({
      claim: 'Average price of a machine',
      sourceType: 'statistic',
      source: 'S1',
      ...over,
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'Help buyers pick',
        audience: 'Home baristas',
        outline: [
          {
            heading: 'The best espresso machines under $500',
            keyPoints: ['Price bands'],
            // Copied with the quotes it was listed in.
            fanout: '“Best espresso machine under 500”',
            platform: 'copilot-web',
            answer: 'Say that 73% of buyers pick a single boiler (S1), in 60 words.',
            format: 'carousel',
            facts: [
              fact(),
              fact({ sourceType: 'rumour' }),
              fact({ claim: '41% of baristas say so [S1]', sourceType: 'Study', source: 'S99' }),
              fact({ source: 's1' }),
              // S2 isn't a page: a fan-out is a question, not a source.
              fact({ source: 'S2' }),
              fact({ claim: ' ' }),
              fact(),
            ],
          },
          {
            heading: 'Grinders (S1)',
            // Only the numbers given go: a name with one stays.
            keyPoints: ['Burr vs blade [S1]', 'Model (S23) grinders'],
            fanout: null,
            platform: null,
            answer: null,
            format: ' Table ',
            facts: [],
          },
        ],
        keywords: ['espresso'],
      },
      usage: { inputTokens: 1000, outputTokens: 500 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources(),
      rules: RULES,
    });
    expect(brief.version).toBe(2);
    const [section, second] = brief.outline;
    expect(section.fanout).toBe('Best espresso machine under 500');
    // Its numbers out of the words; the rule's number kept, one of its own a placeholder.
    expect(section.answer).toBe(
      'Say that [figure, source] of buyers pick a single boiler, in 60 words.',
    );
    // A format the web doesn't know: none; one it knows, as it lists it.
    expect(section.format).toBeNull();
    expect(second).toMatchObject({
      heading: 'Grinders',
      keyPoints: ['Burr vs blade', 'Model (S23) grinders'],
      format: 'table',
    });
    const page = {
      kind: 'cited_page',
      ref: 'https://www.reddit.com/r/espresso/x',
      label: 'https://www.reddit.com/r/espresso/x',
    };
    expect(section.facts).toEqual([
      { claim: 'Average price of a machine', sourceType: 'statistic', source: page },
      // A number the data doesn't have, a source it doesn't list.
      { claim: '[figure, source] of baristas say so', sourceType: 'study', source: null },
      { claim: 'Average price of a machine', sourceType: 'statistic', source: page },
      { claim: 'Average price of a machine', sourceType: 'statistic', source: null },
    ]);
    expect(section.facts.length).toBeLessThanOrEqual(BRIEF_V2_LIMITS.facts);
  });

  it('holds the model to the format and source keys, without failing a call on one off the list', () => {
    // The JSON schema the model is given, as the AI SDK writes it.
    const json = z.toJSONSchema(outlineSchemaV2, { target: 'draft-7', io: 'input' });
    const section = json.properties.outline.items.properties;
    expect(section.format.anyOf).toEqual([
      { type: 'string', enum: BRIEF_FORMATS },
      { type: 'null' },
    ]);
    expect(section.facts.items.properties.sourceType.enum).toEqual(FACT_SOURCES);
    expect(SYSTEM_PROMPT_V2).toContain('write them as listed, in English');
    // A model that writes "Table" or a translated key still answers: read by key afterwards.
    const read = outlineSchemaV2.safeParse({
      goal: 'g',
      audience: 'a',
      outline: [
        {
          heading: 'h',
          keyPoints: [],
          fanout: null,
          platform: null,
          answer: null,
          format: 'Tablo',
          facts: [{ claim: 'c', sourceType: 'Statistic', source: null }],
        },
      ],
      keywords: [],
    });
    expect(read.success).toBe(true);
  });

  it('leaves version 1’s words as they were: numbers aren’t taken out, the rules aren’t known', async () => {
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        outline: [
          {
            heading: 'Machines',
            keyPoints: ['Price bands (S1)', 'Answer in 60 words'],
            fanout: null,
            platform: null,
          },
        ],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources(),
      rules: RULES,
    });
    expect(brief.outline[0].keyPoints).toEqual([
      'Price bands (S1)',
      `Answer in ${NUMBER_PLACEHOLDER} words`,
    ]);
  });

  it('fits the brief under the column’s 64 KB: sources go first, then facts', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    const long = 'https://www.reddit.com/r/espresso/' + 'x'.repeat(2000);
    const section = (i) => ({
      heading: `Machines ${String.fromCharCode(97 + i)}`,
      keyPoints: [],
      fanout: null,
      platform: null,
      answer: null,
      format: null,
      facts: Array(4).fill({ claim: 'c'.repeat(300), sourceType: 'study', source: 'S1' }),
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        outline: Array.from({ length: 12 }, (_, i) => section(i)),
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({
      draftId: DRAFT,
      brandId: BRAND,
      sources: sources({ pages: [{ url: long, kind: 'forum' }] }),
    });
    expect(Buffer.byteLength(JSON.stringify(brief))).toBeLessThan(64_000);
    expect(brief.outline[0].facts).toHaveLength(4);
    expect(brief.outline.every((s) => s.facts.every((f) => f.source === null))).toBe(true);
  });

  it('lets the facts go too when the brief is still too big without their sources', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    // Three bytes a character: the answers fit, the facts don't beside them.
    const section = (i) => ({
      heading: `Machines ${String.fromCharCode(97 + i)}`,
      keyPoints: [],
      fanout: null,
      platform: null,
      answer: '中'.repeat(600),
      format: null,
      facts: Array(4).fill({ claim: '中'.repeat(300), sourceType: 'study', source: null }),
    });
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        outline: Array.from({ length: 12 }, (_, i) => section(i)),
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(Buffer.byteLength(JSON.stringify(brief))).toBeLessThan(64_000);
    expect(brief.outline).toHaveLength(12);
    expect(brief.outline.every((s) => s.facts.length === 0)).toBe(true);
    expect(brief.outline[0].answer).toHaveLength(BRIEF_V2_LIMITS.answer);
  });

  it('cuts a long answer and claim to the web’s limits, never splitting a placeholder', async () => {
    process.env.CONTENT_BRIEF_RULES = 'true';
    generateObject.mockResolvedValue({
      object: {
        goal: 'g',
        audience: 'a',
        outline: [
          {
            heading: 'Machines',
            keyPoints: [],
            fanout: null,
            platform: null,
            answer: 'a'.repeat(700),
            format: 'table',
            facts: [{ claim: 'c'.repeat(400), sourceType: 'study', source: null }],
          },
        ],
        keywords: [],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });
    expect(brief.outline[0].answer).toHaveLength(BRIEF_V2_LIMITS.answer);
    expect(brief.outline[0].format).toBe('table');
    expect(brief.outline[0].facts[0].claim).toHaveLength(BRIEF_V2_LIMITS.claim);
  });

  // The web's reading of version 2 (web/src/lib/content/brief.ts, #1539): read
  // here so the two can't drift apart unseen; skipped until the web has it.
  const webBrief = new URL('../../../web/src/lib/content/brief.ts', import.meta.url);
  const webText = existsSync(webBrief) ? readFileSync(webBrief, 'utf8') : '';
  const webHasV2 = webText.includes('BRIEF_V2_LIMITS');
  it.skipIf(!webHasV2)('writes version 2 to the web’s limits, kinds and sample', () => {
    const limits = webText.match(/export const BRIEF_V2_LIMITS = \{([\s\S]*?)\} as const/)[1];
    const limit = (key) => Number(limits.match(new RegExp(`\\b${key}: (\\d+)`))[1]);
    for (const key of ['answer', 'facts', 'claim', 'url']) {
      expect(BRIEF_V2_LIMITS[key], key).toBe(limit(key));
    }
    const kinds = (name) =>
      [
        ...webText
          .match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))[1]
          .matchAll(/'([a-z_]+)'/g),
      ].map((m) => m[1]);
    expect(BRIEF_FORMATS).toEqual(kinds('BRIEF_FORMATS'));
    expect(FACT_SOURCES).toEqual(kinds('FACT_SOURCES'));
    const sample = JSON.parse(
      readFileSync(
        new URL('../../../web/src/lib/content/__fixtures__/brief-v2.json', import.meta.url),
        'utf8',
      ),
    );
    for (const section of sample.outline) {
      expect(BRIEF_FORMATS).toContain(section.format);
      for (const f of section.facts) expect(FACT_SOURCES).toContain(f.sourceType);
    }
    // A fact's source is a kind the web keeps (sources.ts DRAFT_SOURCE_KINDS).
    const webSources = readFileSync(
      new URL('../../../web/src/lib/content/sources.ts', import.meta.url),
      'utf8',
    );
    const draftKinds = [
      ...webSources
        .match(/export const DRAFT_SOURCE_KINDS = \[([^\]]*)\]/)[1]
        .matchAll(/'([a-z_]+)'/g),
    ].map((m) => m[1]);
    for (const n of briefNumbered(sources())) expect(draftKinds).toContain(n.kind);
  });
});
