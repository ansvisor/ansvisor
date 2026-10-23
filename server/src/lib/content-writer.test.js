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
const reserveAiBudget = vi.fn();

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
class NoObjectGeneratedError extends Error {
  static isInstance(err) {
    return err instanceof NoObjectGeneratedError;
  }
}
vi.mock('ai', () => ({
  generateObject: (...args) => generateObject(...args),
  NoObjectGeneratedError,
}));
const resolveModel = vi.hoisted(() => vi.fn((id) => `model:${id}`));
vi.mock('./ai-provider.js', () => ({ resolveModel }));
vi.mock('./plan-guard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reserveAiBudget: (...args) => reserveAiBudget(...args),
}));
vi.mock('./logger.js', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const readLinkTargets = vi.hoisted(() => vi.fn());
const stopIfStopped = vi.fn();
vi.mock('./content-runs.js', async (importOriginal) => ({
  ...(await importOriginal()),
  stopIfStopped: (...args) => stopIfStopped(...args),
}));
vi.mock('./content-links.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readLinkTargets: (...args) => readLinkTargets(...args),
}));
const hasOpenSuggestions = vi.hoisted(() => vi.fn());
vi.mock('./content-agent.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hasOpenSuggestions: (...args) => hasOpenSuggestions(...args),
}));

const { briefText, renderPage, runDraftWriting, startDraftWriting } =
  await import('./content-writer.js');
const { textLength } = await import('./content-rewrite.js');
const { passageKey } = await import('./content-agent.js');
const { PlanLimitError } = await import('./plan-guard.js');
// The real hold: self-hosted here, so it reserves nothing and writes each charge.
const realGuard = await vi.importActual('./plan-guard.js');

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
  readLinkTargets.mockReset().mockResolvedValue({ own: [], sources: [] });
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
  reserveAiBudget.mockReset().mockImplementation(realGuard.reserveAiBudget);
  hasOpenSuggestions.mockReset().mockResolvedValue(false);
  stopIfStopped.mockReset().mockResolvedValue(undefined);
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
    expect(reserveAiBudget).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ feature: 'content', modelId: expect.any(String) }),
    );
    // Which run holds it, for every device (00247).
    expect(draftUpdates()[0]).toMatchObject({ agent_state: 'writing', agent_run: 'write' });
    // Its run carries the claim, the one a Stop on it lets go of (00249).
    expect(
      writes.find((w) => w.table === 'content_agent_runs' && w.kind === 'insert').value,
    ).toMatchObject({ kind: 'write', claimed_at: draftUpdates()[0].agent_state_at });

    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    // It ends only its own claim: a newer run's, after a Stop let go, is left alone.
    const updates = writes.filter((w) => w.table === 'content_drafts' && w.kind === 'update');
    expect(updates[1].filters).toContainEqual(['agent_state_at', updates[0].value.agent_state_at]);
    expect(draftUpdates()[1]).toMatchObject({
      title: 'How to brew pour-over coffee',
      status: 'in_review',
      author: 'agent',
      agent_state: null,
    });
    // No number without a source (CE-033): none of the data has 15 or 250.
    expect(draftUpdates()[1].body_html).toMatch(
      /^<h1>How to brew pour-over coffee<\/h1><p>Use \[figure, source\] g of coffee for \[figure, source\] g of water\.<\/p>/,
    );
    const finish = writes.filter((w) => w.table === 'content_drafts')[1];
    expect(finish.filters).toContainEqual(['agent_state', 'writing']);
    // Only while it is still open to it: one marked ready meanwhile keeps its page.
    expect(finish.filters).toContainEqual(['status', ['draft', 'in_review']]);
    // A new page holds only its H1: nothing of the person's to keep first.
    expect(rpcCalls).toEqual([]);
    expect(writes.find((w) => w.table === 'prompt_improve_usage')).toMatchObject({
      value: expect.objectContaining({ feature: 'content' }),
    });
    const { prompt } = generateObject.mock.calls[0][0];
    // The data, numbered as the agent cites it.
    expect(prompt).toContain('- S1 ratio?');
    expect(prompt).toContain('- S2 "pour over ratio"');
    expect(prompt).toContain('- faq: FAQ with 5 questions — aim: 5');
    expect(prompt).toContain('Page type: How-to guide: numbered steps to get one thing done');
  });

  it('leaves the page as it was once stopped, and lets go of it (CE-027)', async () => {
    const { RunStoppedError } = await import('./content-runs.js');
    stopIfStopped.mockRejectedValueOnce(new RunStoppedError());
    // A page the person wrote in: stopped, History gets no "before the agent".
    rows.content_drafts = draftRow({
      body_html: '<h1>How to brew pour-over coffee</h1><p>My notes.</p>',
    });
    await startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() });
    await vi.waitFor(() => expect(draftUpdates()).toHaveLength(2));
    // Claimed, then let go: no page written, no 'failed'.
    expect(draftUpdates()[1]).toEqual({ agent_state: null, agent_state_at: expect.any(String) });
    expect(draftUpdates().some((u) => 'body_html' in u)).toBe(false);
    expect(rpcCalls).toEqual([]);
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
    expect(reserveAiBudget).not.toHaveBeenCalled();
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
    expect(reserveAiBudget).not.toHaveBeenCalled();
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
    const held = { charge: vi.fn(), release: vi.fn() };
    reserveAiBudget.mockResolvedValueOnce(held);
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toMatchObject({ status: 409, code: 'org_writing' });
    expect(writes).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
    // Not started: the hold on the budget goes.
    expect(held.release).toHaveBeenCalled();
    expect(held.charge).not.toHaveBeenCalled();
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
    reserveAiBudget.mockRejectedValue(new PlanLimitError('used up', 429));
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input() }),
    ).rejects.toBeInstanceOf(PlanLimitError);
    expect(writes).toEqual([]);
  });
});

// The hold Start took on the AI budget (reserveAiBudget), handed to the run.
const budget = { charge: vi.fn(), release: vi.fn() };
beforeEach(() => {
  budget.charge.mockReset();
  budget.release.mockReset();
});

describe('runDraftWriting on a new page', () => {
  const run = (draft) =>
    runDraftWriting({ draft, brand, model: 'model:m', input: input(), budget });

  it('keeps the person’s text in History before writing over it, and reads prompts by their set', async () => {
    const tried = draftRow({
      agent_state: 'failed',
      body_html: '<h1>How to brew pour-over coffee</h1><p>My own notes.</p>',
    });
    await expect(run(tried)).resolves.toEqual({ written: true });
    // The answer is charged to the hold; nothing is left to release after.
    expect(budget.charge).toHaveBeenCalledTimes(1);
    expect(budget.release).toHaveBeenCalled();
    // The fan-outs a rule names, in their words, on a new page too (B).
    expect(generateObject.mock.calls[0][0].system).toContain(
      'For each fan-out a rule names, use its words, not questions of your own: a section heading for fanoutH2, an FAQ question ending in "?" for fanoutFaq.',
    );
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
      input: input({ locked: [passageKey(QUOTED)], ...over }),
      budget,
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
            after: 'freshly ground coffee',
            reason: 'answer the ratio search',
            rules: ['faq'],
            // From the fan-out it answers, S2 (CE-033).
            sources: ['S2'],
            marks: [{ words: 'freshly ground coffee', source: 'S2' }],
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
        sources: [{ kind: 'fanout', ref: 'pour over ratio', label: 'pour over ratio' }],
        source_marks: [{ start: 0, end: 21, source: 0 }],
      }),
    ]);
    expect(generateObject.mock.calls[0][0].prompt).toContain(`[2] (p, LOCKED) ${QUOTED}`);
    // An answer goes after a heading, never into it.
    expect(generateObject.mock.calls[0][0].system).toContain(
      'Never write an answer, a sentence or a FAQ into a heading',
    );
    // Links only to the pages and sources listed (A); none asked for here.
    expect(generateObject.mock.calls[0][0].system).toContain('Never invent a URL');
    expect(generateObject.mock.calls[0][0].system).toContain(
      'Call a change a fan-out answer only when it uses a fan-out listed',
    );
    expect(readLinkTargets).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: DRAFT, ruleKeys: new Set(['faq']) }),
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
    // The first answer was paid for; the second never came, and its hold goes.
    expect(budget.charge).toHaveBeenCalledTimes(1);
    expect(budget.release).toHaveBeenCalledTimes(2);
  });

  it('charges an answer that missed the schema, as the provider billed it', async () => {
    const billed = { inputTokens: 5000, outputTokens: 6000 };
    generateObject.mockRejectedValueOnce(
      Object.assign(new NoObjectGeneratedError('no object'), { usage: billed }),
    );
    await expect(run()).resolves.toEqual({ failed: true });
    expect(budget.charge).toHaveBeenCalledTimes(1);
    expect(budget.charge).toHaveBeenCalledWith(billed);
    // The run still ends failed.
    expect(draftUpdates()).toEqual([{ agent_state: 'failed', agent_state_at: expect.any(String) }]);
  });
});

describe('Rewrite the page to these rules', () => {
  const QUOTED = 'Pour-over coffee tastes cleaner than a French press.';
  const existing = draftRow({
    method: 'optimize',
    status: 'in_review',
    body_html:
      `<h1>Pour-over</h1><p>${QUOTED}</p><p>Use good coffee. ${'Filler. '.repeat(20)}</p>` +
      '<table><tbody><tr><td>Ratio</td><td>1:16</td></tr></tbody></table>' +
      '<p>See <a href="/pricing">pricing</a>.</p>',
    action_id: 'act-1',
  });
  const locked = [passageKey(QUOTED)];
  const run = (over = {}) =>
    runDraftWriting({
      draft: existing,
      brand,
      model: 'model:m',
      input: input({ locked, ...over }),
      budget,
      rewrite: true,
    });
  const answer = (html, reason = 'cut to about 3,000 characters') =>
    generateObject.mockResolvedValue({
      object: { html, reason },
      usage: { inputTokens: 900, outputTokens: 700 },
    });

  it('starts only on a page with text, small enough to send whole, and no open batch', async () => {
    rows.content_drafts = existing;
    hasOpenSuggestions.mockResolvedValueOnce(true);
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input(), rewrite: true }),
    ).rejects.toMatchObject({ status: 409, code: 'open_suggestions' });
    rows.content_drafts = { ...existing, method: 'create', body_html: '<p> </p>' };
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input(), rewrite: true }),
    ).rejects.toMatchObject({ status: 422, code: 'empty' });
    rows.content_drafts = { ...existing, body_html: `<p>${'word '.repeat(13_000)}</p>` };
    await expect(
      startDraftWriting({ draftId: DRAFT, brandId: BRAND, input: input(), rewrite: true }),
    ).rejects.toMatchObject({ status: 422, code: 'too_long' });
    // Refused before anything was held or claimed.
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(draftUpdates()).toEqual([]);
  });

  it('claims the draft as a rewrite, so every device tries a failed one again as one', async () => {
    rows.content_drafts = existing;
    answer('<h1>Pour-over</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Shorter.</p>');
    await expect(
      startDraftWriting({
        draftId: DRAFT,
        brandId: BRAND,
        input: input({ locked }),
        rewrite: true,
      }),
    ).resolves.toEqual({ started: true });
    expect(draftUpdates()[0]).toMatchObject({ agent_state: 'writing', agent_run: 'rewrite' });
    await vi.waitFor(() => expect(draftUpdates().length).toBeGreaterThan(1));
  });

  it('leaves the whole page as one suggestion, with what it kept put back as it was', async () => {
    answer(
      '<h1>Pour-over coffee</h1><p>[[KEEP 1]]</p><p>Use good coffee, freshly ground.</p>' +
        '<p>[[KEEP 2]]</p><p>See <a href="/pricing">pricing</a> or <a href="https://evil.example">this</a>.</p>',
    );
    await expect(
      run({
        rules: [
          { key: 'length', name: 'Length', detail: 'aim: 3,000 characters' },
          { key: 'faq', name: 'FAQ with 5 questions', detail: 'aim: 5' },
        ],
      }),
    ).resolves.toEqual({ rewritten: true });

    const { system, prompt } = generateObject.mock.calls[0][0];
    expect(system).toContain('stands for a block kept word for word');
    // The quoted passage and the table never reach the model to rewrite:
    // they are described, and count toward Length.
    expect(prompt).toContain('Length: about 3000 characters.');
    expect(prompt).toMatch(
      /The page now, as HTML: about \d+ characters of text, \d+ of them in its kept blocks/,
    );
    expect(prompt).toContain(`- [[KEEP 1]]: a passage AI assistants quote today: "${QUOTED}"`);
    expect(prompt).toContain('- [[KEEP 2]]: a table, 1 rows: "Ratio1:16"');
    expect(prompt).not.toContain(`<p>${QUOTED}</p>`);
    expect(prompt).toContain("Write in the page's own language.");
    expect(budget.charge).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 700 });

    const row = writes.find((w) => w.table === 'content_draft_suggestions').value;
    expect(row).toMatchObject({
      draft_id: DRAFT,
      action_id: 'act-1',
      position: 0,
      kind: 'page',
      block_text: 'Pour-over',
      before_text: '',
      before_html: existing.body_html,
      reason: 'cut to about 3,000 characters',
      rule_keys: ['length', 'faq'],
    });
    expect(row.after_text).toBe(
      `<h1>Pour-over coffee</h1><p>${QUOTED}</p><p>Use good coffee, freshly ground.</p>` +
        '<table><tbody><tr><td>Ratio</td><td>1:16</td></tr></tbody></table>' +
        '<p>See <a href="/pricing">pricing</a> or this.</p>',
    );
    // The agent lets go; the draft's status stays as it was.
    expect(draftUpdates().at(-1)).toEqual({
      agent_state: null,
      agent_state_at: expect.any(String),
    });
  });

  it('keeps the data it wrote from, and no number without a source (CE-033)', async () => {
    generateObject.mockResolvedValue({
      object: {
        html:
          '<h1>Pour-over coffee</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p>' +
          '<p>Brew it in 4 minutes; 87% of baristas agree, as "pour over ratio" asks.</p>',
        reason: 'answered the ratio search',
        sources: ['S2', 'S7'],
      },
      usage: { inputTokens: 900, outputTokens: 700 },
    });
    await expect(run()).resolves.toEqual({ rewritten: true });
    const row = writes.find((w) => w.table === 'content_draft_suggestions').value;
    // The fan-out it named; S7 isn't on the list.
    expect(row.sources).toEqual([
      { kind: 'fanout', ref: 'pour over ratio', label: 'pour over ratio' },
    ]);
    // 87% is in none of the data: a placeholder. A lone count stays; the
    // kept table's 1:16 is the page's own.
    expect(row.after_text).toContain(
      '<p>Brew it in 4 minutes; [figure, source] of baristas agree, as "pour over ratio" asks.</p>',
    );
    expect(row.after_text).toContain('<td>1:16</td>');
    expect(generateObject.mock.calls[0][0].system).toContain('Put the numbers (S1, S2…)');
  });

  it('keeps the page’s length when the Length rule is off', async () => {
    answer('<h1>Pour-over</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Shorter.</p>');
    await run({ rules: [{ key: 'faq', name: 'FAQ', detail: '' }] });
    const { prompt } = generateObject.mock.calls[0][0];
    expect(prompt).toContain(`Length: about ${textLength(existing.body_html)} characters.`);
  });

  it('fails the run on an answer that isn’t a page in HTML', async () => {
    answer('# Pour-over\n\n[[KEEP 1]]\n\n[[KEEP 2]]');
    await expect(run()).resolves.toEqual({ failed: true });
    expect(writes.find((w) => w.table === 'content_draft_suggestions')).toBeUndefined();
  });

  it('drops the rewrite of a page marked ready during the run', async () => {
    answer('<h1>Pour-over</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Shorter.</p>');
    finished = null;
    await expect(run()).resolves.toEqual({ skipped: true });
    const insert = writes.find(
      (w) => w.table === 'content_draft_suggestions' && w.kind === 'insert',
    );
    const drop = writes.find((w) => w.table === 'content_draft_suggestions' && w.kind === 'delete');
    expect(drop.filters).toContainEqual(['batch_id', insert.value.batch_id]);
  });

  it('fails the run when the rewrite drops what it had to keep', async () => {
    answer('<h1>Pour-over</h1><p>[[KEEP 2]]</p><p>A new page without the quoted passage.</p>');
    await expect(run()).resolves.toEqual({ failed: true });
    expect(writes.find((w) => w.table === 'content_draft_suggestions')).toBeUndefined();
    expect(draftUpdates()).toEqual([{ agent_state: 'failed', agent_state_at: expect.any(String) }]);
    // The answer was still paid for.
    expect(budget.charge).toHaveBeenCalledTimes(1);
  });

  it('adds nothing over a batch that came in during the run', async () => {
    answer('<h1>Pour-over</h1><p>[[KEEP 1]]</p><p>[[KEEP 2]]</p><p>Shorter.</p>');
    hasOpenSuggestions.mockResolvedValue(true);
    await expect(run()).resolves.toEqual({ skipped: true });
    expect(writes.find((w) => w.table === 'content_draft_suggestions')).toBeUndefined();
  });
});
