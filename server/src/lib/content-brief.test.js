import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const enforceImproveQuota = vi.fn();

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
vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
vi.mock('./ai-provider.js', () => ({ resolveModel: vi.fn((id) => `model:${id}`) }));
vi.mock('./plan-guard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  enforceImproveQuota: (...args) => enforceImproveQuota(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn() } }));

const { buildBriefPrompt, mapOutline, rebuildDraftBrief } = await import('./content-brief.js');
const { PlanLimitError } = await import('./plan-guard.js');

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
  enforceImproveQuota.mockReset().mockResolvedValue({ unlimited: true });
});

describe('rebuildDraftBrief', () => {
  it('writes the brief from the kept sources, charges AI usage, and saves it on the draft', async () => {
    const brief = await rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() });

    expect(enforceImproveQuota).toHaveBeenCalledWith('o1', 'google/gemini-3-flash-preview');
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

    expect(writes).toEqual([
      {
        table: 'prompt_improve_usage',
        op: 'insert',
        value: expect.objectContaining({
          organization_id: 'o1',
          content_draft_id: DRAFT,
          input_tokens: 1000,
        }),
      },
      { table: 'content_drafts', op: 'update', value: { brief } },
    ]);
    // Only the brand's prompts are read.
    expect(filters.find((f) => f.table === 'prompts').filters).toEqual([
      ['in', 'id', [PROMPT]],
      ['eq', 'topics.brand_id', BRAND],
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
    expect(enforceImproveQuota).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('stops when the AI usage budget is spent', async () => {
    enforceImproveQuota.mockRejectedValue(new PlanLimitError('used up', 429));
    await expect(
      rebuildDraftBrief({ draftId: DRAFT, brandId: BRAND, sources: sources() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(generateObject).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});

describe('the brief prompt', () => {
  it('says a new page is new, and lists none where a source is empty', () => {
    const prompt = buildBriefPrompt({
      brand: { name: 'Acme', language: 'en' },
      draft: { title: 'Grinders', page_type: null, method: 'create', source_url: null },
      prompts: [],
      sources: sources({ fanouts: [], pages: [], queries: ['burr grinder'], headings: [] }),
    });
    expect(prompt).toContain('A new page.');
    expect(prompt).toContain('Prompts the page must answer:\n- none');
    expect(prompt).toContain('- burr grinder');
    expect(prompt).not.toContain('headings now');
    expect(prompt).toContain('Write the brief in English.');
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
