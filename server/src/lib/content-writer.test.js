import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Start's Agent (Content Editor CE-015): the Content Agent writes a new page
 * whole, or leaves suggestions on an existing one, in the background, and
 * the draft goes to In review — or says it failed.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let rows;
let writes;
let claimed;
let finished;
let rpcCalls;
let reads;
const generateObject = vi.fn();
const enforceImproveQuota = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: async (name, args) => (rpcCalls.push([name, args]), { data: 'v1', error: null }),
    from: (table) => {
      const op = { table, kind: 'select', filters: [] };
      const result = () => {
        if (op.kind === 'select') {
          reads.push(op);
          // The organization's other drafts being written.
          if (op.filters.some(([col]) => col === 'brands.organization_id')) {
            return { data: rows.writingInOrg ?? [], error: null };
          }
          return { data: rows[table] ?? null, error: null };
        }
        writes.push(op);
        // The claim and the finish read back their row, when they matched one.
        const claim = op.kind === 'update' && op.value.agent_state === 'writing';
        return { data: claim ? claimed : op.kind === 'update' ? finished : null, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (col, v) => (op.filters.push([col, v]), chain),
        neq: (col, v) => (op.filters.push([`${col}<>`, v]), chain),
        gt: (col, v) => (op.filters.push([`${col}>`, v]), chain),
        in: (col, v) => (op.filters.push([col, v]), chain),
        or: (v) => (op.filters.push(['or', v]), chain),
        limit: () => chain,
        update: (value) => ((op.kind = 'update'), (op.value = value), chain),
        insert: (value) => ((op.kind = 'insert'), (op.value = value), chain),
        delete: () => ((op.kind = 'delete'), chain),
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
const resolveModel = vi.hoisted(() => vi.fn((id) => `model:${id}`));
vi.mock('./ai-provider.js', () => ({ resolveModel }));
vi.mock('./plan-guard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  enforceImproveQuota: (...args) => enforceImproveQuota(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
const hasOpenSuggestions = vi.hoisted(() => vi.fn());
vi.mock('./content-agent.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasOpenSuggestions: (...args) => hasOpenSuggestions(...args),
}));

const { briefText, renderPage, runDraftWriting, startDraftWriting } =
  await import('./content-writer.js');
const { passageKey } = await import('./content-agent.js');
const { PlanLimitError } = await import('./plan-guard.js');

const input = (over = {}) => ({
  sources: {
    promptIds: ['p1'],
    fanouts: [{ query: 'pour over ratio', platforms: ['copilot-web'] }],
    pages: [],
    queries: [],
    headings: [],
    length: 3000,
  },
  rules: [{ key: 'faq', name: 'FAQ with 5 questions', detail: 'aim: 5' }],
  textRules: [],
  locked: [],
  ...over,
});

const draftRow = (over = {}) => ({
  id: DRAFT,
  brand_id: BRAND,
  title: 'How to brew pour-over coffee',
  page_type: 'guide',
  method: 'create',
  source_url: null,
  body_html: '<h1>How to brew pour-over coffee</h1>',
  status: 'draft',
  agent_state: null,
  agent_state_at: null,
  opportunity_id: null,
  brief: null,
  action_id: null,
  ...over,
});
const brand = {
  name: 'Acme Coffee',
  industry: 'Coffee',
  description: 'Beans',
  organization_id: 'org-1',
  language: 'en',
};

const page = {
  title: 'How to brew pour-over coffee',
  intro: ['Use 15 g of coffee for 250 g of water.'],
  sections: [
    { heading: 'What you need', paragraphs: ['A dripper & a filter.'], bullets: ['Kettle', ''] },
    { heading: 'Step by step', paragraphs: ['Rinse, bloom, pour.'], bullets: [] },
  ],
  faqHeading: 'FAQ',
  faq: [{ question: 'How long?', answer: '[time] minutes.' }],
};

beforeEach(() => {
  writes = [];
  rpcCalls = [];
  reads = [];
  claimed = { id: DRAFT };
  finished = { id: DRAFT };
  rows = { content_drafts: draftRow(), brands: brand, prompts: [{ id: 'p1', text: 'ratio?' }] };
  generateObject.mockReset().mockResolvedValue({
    object: page,
    usage: { inputTokens: 10, outputTokens: 20 },
  });
  enforceImproveQuota.mockReset().mockResolvedValue(undefined);
  hasOpenSuggestions.mockReset().mockResolvedValue(false);
});

const draftUpdates = () =>
  writes.filter((w) => w.table === 'content_drafts' && w.kind === 'update').map((w) => w.value);

describe('renderPage', () => {
  it('writes the editor’s HTML from text, escaped', () => {
    expect(renderPage({ ...page, title: 'Pour-over <b>101</b>' })).toBe(
      '<h1>Pour-over &lt;b&gt;101&lt;/b&gt;</h1>' +
        '<p>Use 15 g of coffee for 250 g of water.</p>' +
        '<h2>What you need</h2><p>A dripper &amp; a filter.</p><ul><li><p>Kettle</p></li></ul>' +
        '<h2>Step by step</h2><p>Rinse, bloom, pour.</p>' +
        '<h2>FAQ</h2><h3>How long?</h3><p>[time] minutes.</p>',
    );
  });
});

describe('briefText', () => {
  it('reads the draft’s brief, else its opportunity’s', () => {
    const own = briefText(
      {
        goal: 'Sell beans',
        audience: 'Home brewers',
        outline: [{ heading: 'Ratio', keyPoints: ['15:250'], fanout: 'pour over ratio' }],
        keywords: ['pour over'],
      },
      { outline: [{ heading: 'Ignored' }] },
    );
    expect(own).toContain('Goal: Sell beans');
    expect(own).toContain('- Ratio: 15:250 (answers the AI search "pour over ratio")');
    expect(own).not.toContain('Ignored');

    expect(
      briefText(null, {
        suggestedTitle: 'Pour-over guide',
        outline: [{ heading: 'Gear', keyPoints: [] }],
        targetKeywords: [],
        callToAction: 'Shop',
      }),
    ).toContain('- Gear');
    expect(briefText(null, null)).toMatch(/^No brief/);
  });
});

describe('startDraftWriting', () => {
  it('claims the draft, answers at once, and writes the new page for review', async () => {
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ started: true });
    expect(enforceImproveQuota).toHaveBeenCalledWith('org-1', expect.any(String));
    expect(draftUpdates()[0]).toMatchObject({ agent_state: 'writing' });

    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    expect(draftUpdates()[1]).toMatchObject({
      title: 'How to brew pour-over coffee',
      status: 'in_review',
      author: 'agent',
      agent_state: null,
    });
    expect(draftUpdates()[1].body_html).toMatch(
      /^<h1>How to brew pour-over coffee<\/h1><p>Use 15 g/,
    );
    const finish = writes.filter((w) => w.table === 'content_drafts')[1];
    expect(finish.filters).toContainEqual(['agent_state', 'writing']);
    // Only while it is still open to it: one marked ready meanwhile keeps its page.
    expect(finish.filters).toContainEqual(['status', ['draft', 'in_review']]);
    // A new page holds only its H1: nothing of the person's to keep first.
    expect(rpcCalls).toEqual([]);
    expect(writes.some((w) => w.table === 'prompt_improve_usage')).toBe(true);
    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain('- ratio?');
    expect(prompt).toContain('- "pour over ratio"');
    expect(prompt).toContain('- faq: FAQ with 5 questions — aim: 5');
    expect(prompt).toContain('Page type: How-to guide: numbered steps to get one thing done');
  });

  // Rewrite from brief: a draft the agent wrote is in review, and is written again.
  it('writes a draft in review again, keeping its page in History first', async () => {
    rows.content_drafts = draftRow({
      status: 'in_review',
      author: 'agent',
      body_html: '<h1>How to brew pour-over coffee</h1><p>The first run.</p>',
    });
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ started: true });
    const claim = writes.find((w) => w.table === 'content_drafts');
    expect(claim.filters).toContainEqual(['status', ['draft', 'in_review']]);

    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    expect(rpcCalls).toEqual([
      ['content_draft_snapshot', { p_draft_id: DRAFT, p_origin: 'agent_before' }],
    ]);
    expect(draftUpdates()[1]).toMatchObject({ status: 'in_review', agent_state: null });
  });

  it('refuses another brand’s draft, one marked ready or published, or one the agent is on — before charging', async () => {
    const start = () => startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() });
    rows.content_drafts = draftRow({ brand_id: 'other' });
    await expect(start()).rejects.toMatchObject({ status: 404 });
    for (const status of ['ready', 'published']) {
      rows.content_drafts = draftRow({ status });
      await expect(start()).rejects.toMatchObject({ status: 409, code: 'not_draft' });
    }
    rows.content_drafts = draftRow({
      agent_state: 'writing',
      agent_state_at: new Date().toISOString(),
    });
    await expect(start()).rejects.toMatchObject({ status: 409, code: 'writing' });
    expect(enforceImproveQuota).not.toHaveBeenCalled();
    expect(writes).toEqual([]);

    // A 'writing' left long ago can start again; a start that lost the claim can't.
    rows.content_drafts = draftRow({
      agent_state: 'writing',
      agent_state_at: '2026-01-01T00:00:00Z',
    });
    claimed = null;
    await expect(start()).rejects.toMatchObject({ status: 409, code: 'writing' });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('waits on an existing page while its suggestions are open, before charging', async () => {
    rows.content_drafts = draftRow({ method: 'optimize', source_url: 'https://acme.example/x' });
    hasOpenSuggestions.mockResolvedValue(true);
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'open_suggestions' });
    expect(hasOpenSuggestions).toHaveBeenCalledWith(DRAFT);
    expect(enforceImproveQuota).not.toHaveBeenCalled();
    expect(writes).toEqual([]);

    // A new page is written whole: its run adds no batch.
    rows.content_drafts = draftRow();
    hasOpenSuggestions.mockClear();
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).resolves.toEqual({ started: true });
    expect(hasOpenSuggestions).not.toHaveBeenCalled();
  });

  it('writes one of the organization’s drafts at a time', async () => {
    rows.writingInOrg = [{ id: 'other-draft' }];
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'org_writing' });
    expect(writes).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('fails at once when the model isn’t set up, claiming nothing', async () => {
    resolveModel.mockImplementationOnce(() => {
      throw new Error('Provider "google" is not configured');
    });
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toThrow('not configured');
    expect(writes).toEqual([]);
  });

  it('stops at the budget', async () => {
    enforceImproveQuota.mockRejectedValue(new PlanLimitError('used up', 429));
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(writes).toEqual([]);
  });
});

describe('runDraftWriting on a new page', () => {
  const run = (draft) =>
    runDraftWriting({ draft, brand, model: 'model:m', modelId: 'm', input: input() });

  it('keeps the person’s text in History before writing over it, and reads prompts by their set', async () => {
    const tried = draftRow({
      agent_state: 'failed',
      body_html: '<h1>How to brew pour-over coffee</h1><p>My own notes.</p>',
    });
    await expect(run(tried)).resolves.toEqual({ written: true });
    expect(rpcCalls).toEqual([
      ['content_draft_snapshot', { p_draft_id: DRAFT, p_origin: 'agent_before' }],
    ]);
    // A prompt without a topic is the brand's too.
    expect(reads.find((r) => r.table === 'prompts').filters).toContainEqual([
      'prompt_sets.brand_id',
      BRAND,
    ]);
  });

  it('leaves a draft marked ready during the run as it is', async () => {
    finished = null;
    await expect(run(draftRow())).resolves.toEqual({ skipped: true });
    // The page wasn't written; the agent let go of the draft.
    expect(draftUpdates().at(-1)).toEqual({
      agent_state: null,
      agent_state_at: expect.any(String),
    });
  });
});

describe('runDraftWriting on an existing page', () => {
  const QUOTED = 'Pour-over coffee tastes cleaner than a French press.';
  const existing = draftRow({
    method: 'optimize',
    source_url: 'https://acme.example/pour-over',
    body_html: `<h1>Pour-over</h1><p>${QUOTED}</p><p>Use good coffee.</p>`,
    action_id: 'act-1',
  });
  const run = (over = {}) =>
    runDraftWriting({
      draft: existing,
      brand,
      model: 'model:m',
      modelId: 'm',
      input: input({ locked: [passageKey(QUOTED)], ...over }),
    });

  it('leaves its suggestions for review, never on a locked passage', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          {
            kind: 'replace',
            passage: 2,
            before: 'cleaner',
            after: 'brighter',
            reason: 'x',
            rules: [],
          },
          {
            kind: 'replace',
            passage: 3,
            before: 'good coffee',
            after: '15 g of coffee',
            reason: 'answer the ratio search',
            rules: ['faq'],
          },
        ],
      },
      usage: {},
    });
    await expect(run()).resolves.toEqual({ suggestions: 1 });
    const batch = writes.find((w) => w.table === 'content_draft_suggestions').value;
    expect(batch).toEqual([
      expect.objectContaining({
        draft_id: DRAFT,
        action_id: 'act-1',
        block_text: 'Use good coffee.',
        before_text: 'good coffee',
        position: 0,
      }),
    ]);
    expect(generateObject.mock.calls[0][0].prompt).toContain(`[2] (p, LOCKED) ${QUOTED}`);
    // An answer goes after a heading, never into it.
    expect(generateObject.mock.calls[0][0].system).toContain(
      'Never write an answer, a sentence or a FAQ into a heading',
    );
    expect(draftUpdates()).toEqual([
      { status: 'in_review', agent_state: null, agent_state_at: expect.any(String) },
    ]);
  });

  it('adds no batch over one that came in during the run', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          { kind: 'replace', passage: 3, before: 'good', after: 'fresh', reason: 'x', rules: [] },
        ],
      },
      usage: {},
    });
    hasOpenSuggestions.mockResolvedValue(true);
    await expect(run()).resolves.toEqual({ skipped: true });
    expect(writes.some((w) => w.table === 'content_draft_suggestions')).toBe(false);
    expect(draftUpdates()).toEqual([{ agent_state: null, agent_state_at: expect.any(String) }]);
  });

  it('drops its suggestions when the draft was marked ready during the run', async () => {
    generateObject.mockResolvedValue({
      object: {
        suggestions: [
          { kind: 'replace', passage: 3, before: 'good', after: 'fresh', reason: 'x', rules: [] },
        ],
      },
      usage: {},
    });
    finished = null;
    await expect(run()).resolves.toEqual({ skipped: true });
    const batch = writes.find(
      (w) => w.table === 'content_draft_suggestions' && w.kind === 'insert',
    );
    const drop = writes.find((w) => w.table === 'content_draft_suggestions' && w.kind === 'delete');
    expect(drop.filters).toEqual([['batch_id', batch.value[0].batch_id]]);
  });

  it('says it failed when the model fails or leaves nothing to place', async () => {
    generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
    await expect(run()).resolves.toEqual({ failed: true });
    generateObject.mockRejectedValue(new Error('timeout'));
    await expect(run()).resolves.toEqual({ failed: true });
    expect(draftUpdates()).toEqual([
      { agent_state: 'failed', agent_state_at: expect.any(String) },
      { agent_state: 'failed', agent_state_at: expect.any(String) },
    ]);
  });
});
