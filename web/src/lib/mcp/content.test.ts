import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * The Content Editor's agent API (CE-022): drafts read and written through
 * the API key's organization only, an agent's draft going to In review, its
 * suggestions never on a passage AI quotes, and Ready keeping a version.
 */

const db = vi.hoisted(() => ({
  /** What each table answers: one row for single reads, a list for the rest. */
  rows: {} as Record<string, unknown>,
  rpc: {} as Record<string, unknown>,
  rpcCalls: [] as [string, unknown][],
  writes: [] as { table: string; op: string; value: unknown }[],
  filters: [] as [string, string, unknown][],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: unknown) => {
      db.rpcCalls.push([name, args]);
      return { data: db.rpc[name] ?? null, error: null };
    },
    from: (table: string) => {
      const read = () => ({ data: db.rows[table] ?? null, error: null });
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (db.filters.push([table, col, v]), chain),
        in: () => chain,
        is: (col: string, v: unknown) => (db.filters.push([table, col, v]), chain),
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: (value: unknown) => (db.writes.push({ table, op: 'insert', value }), chain),
        update: (value: unknown) => (db.writes.push({ table, op: 'update', value }), chain),
        upsert: async (value: unknown) => (
          db.writes.push({ table, op: 'upsert', value }),
          { error: null }
        ),
        maybeSingle: async () => read(),
        single: async () => read(),
        then: (resolve: (value: unknown) => unknown) => resolve(read()),
      };
      return chain;
    },
  },
}));

const brandInOrg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/mcp/data', () => ({ brandInOrg }));

const {
  createContentDraftFor,
  getContentDraftFor,
  getContentImpactFor,
  setContentDraftReadyFor,
  suggestContentChangesFor,
} = await import('./content');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
};

const QUOTED =
  'Northwind forecasts each deal from real activity: emails, meetings and stage changes.';
const draftRow = (over = {}) => ({
  id: 'd1',
  brand_id: 'b1',
  title: 'Pipeline forecasting',
  status: 'draft',
  method: 'optimize',
  page_type: 'feature_page',
  author: 'user',
  source_url: 'https://acme.example/forecasting',
  body_html: `<h1>Pipeline forecasting</h1><p>${QUOTED}</p><p>Our forecasting is very accurate.</p>`,
  action_id: 'act-1',
  prompt_ids: [],
  updated_at: '2026-10-21T10:00:00Z',
  actions: { action_no: 214 },
  ...over,
});

beforeEach(() => {
  db.rows = {};
  db.rpc = {};
  db.rpcCalls = [];
  db.writes = [];
  db.filters = [];
  brandInOrg.mockReset().mockResolvedValue(true);
});

describe('getContentDraftFor', () => {
  it('numbers the passages, marks the ones AI quotes and lists the open batch', async () => {
    db.rows.content_drafts = draftRow();
    db.rpc.content_draft_cited_answers = [
      { platform: 'chatgpt-web', response: `They say: ${QUOTED}` },
    ];
    // Newest first: an older batch's open one isn't the editor's to show.
    db.rows.content_draft_suggestions = [
      { id: 's3', kind: 'replace', reason: 'decided', batch_id: 'new', status: 'accepted' },
      { id: 's2', kind: 'insert', reason: 'add FAQ', batch_id: 'new', status: 'open' },
      { id: 's1', kind: 'replace', reason: 'old batch', batch_id: 'old', status: 'open' },
    ];

    const draft = await getContentDraftFor(auth, 'd1');

    expect(db.filters).toContainEqual(['content_drafts', 'brands.organization_id', 'org-1']);
    expect(draft).toMatchObject({
      action: { id: 'act-1', number: 214 },
      editor_path: '/dashboard/content/editor/d1',
      passages: [
        { n: 1, tag: 'h1', text: 'Pipeline forecasting', locked: false },
        { n: 2, tag: 'p', text: QUOTED, locked: true },
        { n: 3, tag: 'p', text: 'Our forecasting is very accurate.', locked: false },
      ],
      open_suggestions: [{ id: 's2', kind: 'insert', reason: 'add FAQ' }],
    });
  });

  it('reads nothing of another organization’s draft', async () => {
    await expect(getContentDraftFor(auth, 'd1')).resolves.toBeNull();
    expect(db.rpcCalls).toEqual([]);
  });
});

describe('createContentDraftFor', () => {
  it('writes the agent’s draft for review, its HTML checked and its prompts the brand’s', async () => {
    db.rows.brands = { site_type: 'b2b', industry: 'Software', shopping_mode_enabled: false };
    db.rows.prompts = [{ id: 'p1' }];
    db.rows.content_drafts = { id: 'd-new', status: 'in_review', page_type: 'guide' };

    const created = await createContentDraftFor(auth, {
      brandId: 'b1',
      title: 'How to clean CRM data',
      bodyHtml:
        '<h1>How to clean CRM data</h1><p onclick="x()">Start here.</p><script>bad()</script>',
      method: 'create',
      promptIds: ['p1', 'p-other'],
    });

    // Through the prompt's set: a prompt without a topic is the brand's too.
    expect(db.filters).toContainEqual(['prompts', 'prompt_sets.brand_id', 'b1']);
    expect(created).toEqual({
      id: 'd-new',
      status: 'in_review',
      page_type: 'guide',
      editor_path: '/dashboard/content/editor/d-new',
    });
    const insert = db.writes.find((w) => w.table === 'content_drafts' && w.op === 'insert')!;
    expect(insert.value).toMatchObject({
      brand_id: 'b1',
      author: 'agent',
      created_by: null,
      status: 'in_review',
      page_type_source: 'detected',
      prompt_ids: ['p1'],
      body_html: '<h1>How to clean CRM data</h1><p>Start here.</p>',
    });
  });

  it('takes a live page only on one of the brand’s domains', async () => {
    db.rows.brands = { site_type: 'b2b', industry: 'Software', shopping_mode_enabled: false };
    db.rows.brand_domains = [{ domain: 'https://www.Acme.example/' }];
    db.rows.content_drafts = { id: 'd-new', status: 'in_review', page_type: 'feature_page' };
    const optimize = (sourceUrl: string) =>
      createContentDraftFor(auth, {
        brandId: 'b1',
        title: 'Pipeline forecasting',
        bodyHtml: '<h1>Pipeline forecasting</h1><p>x</p>',
        method: 'optimize',
        sourceUrl,
      });

    await expect(optimize('https://elsewhere.example/forecasting')).resolves.toBe('off_domain');
    await expect(optimize('https://acme.example.evil.example/x')).resolves.toBe('off_domain');
    expect(db.writes).toEqual([]);
    await expect(optimize('https://docs.acme.example/forecasting')).resolves.toMatchObject({
      id: 'd-new',
    });
  });

  it('writes nothing for a brand outside the organization', async () => {
    brandInOrg.mockResolvedValue(false);
    await expect(
      createContentDraftFor(auth, {
        brandId: 'b9',
        title: 'x',
        bodyHtml: '<p>x</p>',
        method: 'create',
      }),
    ).resolves.toBeNull();
    expect(db.writes).toEqual([]);
  });
});

describe('suggestContentChangesFor', () => {
  it('keeps one batch for review, never on a locked passage', async () => {
    db.rows.content_drafts = draftRow();
    db.rpc.content_draft_cited_answers = [
      { platform: 'perplexity-web', response: `Quote: ${QUOTED}` },
    ];

    const result = await suggestContentChangesFor(auth, 'd1', [
      {
        kind: 'replace',
        passage: 2,
        before: 'real activity',
        after: 'activity',
        reason: 'shorter',
      },
      {
        kind: 'replace',
        passage: 3,
        before: 'very accurate',
        after: 'shown per team, each week',
        reason: 'answer a fan-out',
      },
    ]);

    expect(result).toMatchObject({ kept: 1, dropped: [{ index: 0, reason: 'locked' }] });
    // No suggestion links: the sources aren't read.
    expect(db.rpcCalls.map(([name]) => name)).not.toContain('content_draft_sources');
    const insert = db.writes.find((w) => w.table === 'content_draft_suggestions')!;
    expect(insert.value).toEqual([
      expect.objectContaining({
        draft_id: 'd1',
        action_id: 'act-1',
        position: 0,
        kind: 'replace',
        block_text: 'Our forecasting is very accurate.',
        before_text: 'very accurate',
      }),
    ]);
  });

  it('keeps links only to the link targets get_content_draft lists (A)', async () => {
    db.rows.content_drafts = draftRow();
    db.rows.site_pages = [
      { url: 'https://acme.example/accuracy', title: 'How we measure accuracy', h1: null },
    ];
    db.rpc.content_draft_sources = {
      citedPages: [{ url: 'https://research.example/forecasting', title: 'A forecasting study' }],
      brandDomains: ['acme.example'],
      competitorDomains: [],
    };

    const draft = await getContentDraftFor(auth, 'd1');
    expect(draft!.link_targets).toEqual({
      own_pages: [{ url: 'https://acme.example/accuracy', title: 'How we measure accuracy' }],
      sources: [{ url: 'https://research.example/forecasting', title: 'A forecasting study' }],
    });

    const result = await suggestContentChangesFor(auth, 'd1', [
      {
        kind: 'replace',
        passage: 3,
        before: 'very accurate',
        after:
          '<a href="https://acme.example/accuracy">shown per team</a>, as <a href="https://made-up.example">this</a> says',
        reason: 'link how accuracy is measured',
      },
    ]);
    expect(result).toMatchObject({ kept: 1, dropped: [] });
    const insert = db.writes.find((w) => w.table === 'content_draft_suggestions')!;
    expect(insert.value).toEqual([
      expect.objectContaining({
        after_text: 'shown per team, as this says',
        after_links: [{ start: 0, end: 14, href: 'https://acme.example/accuracy' }],
      }),
    ]);
  });

  it('waits while a person still has the latest batch to decide', async () => {
    db.rows.content_drafts = draftRow();
    db.rows.content_draft_suggestions = [
      { id: 's1', kind: 'replace', reason: 'x', batch_id: 'b1', status: 'open' },
    ];
    await expect(
      suggestContentChangesFor(auth, 'd1', [
        { kind: 'insert', passage: 1, after: '<p>x</p>', reason: 'y' },
      ]),
    ).resolves.toBe('open_suggestions');
    expect(db.writes).toEqual([]);
  });

  it('leaves a published draft alone', async () => {
    db.rows.content_drafts = draftRow({ status: 'published' });
    await expect(
      suggestContentChangesFor(auth, 'd1', [
        { kind: 'insert', passage: 1, after: '<p>x</p>', reason: 'y' },
      ]),
    ).resolves.toBe('published');
    expect(db.writes).toEqual([]);
  });
});

describe('setContentDraftReadyFor', () => {
  it('marks a draft ready, keeps the version and completes its action’s task, once', async () => {
    db.rows.content_drafts = draftRow({ status: 'draft' });
    db.rows.actions = { payload: {} };
    db.rows.action_tasks = [{ id: 't-optimize', status: 'in_progress' }];
    // The update reads back the same row; its status is what the update set.
    const result = await setContentDraftReadyFor(auth, 'd1');
    expect(db.writes).toContainEqual({
      table: 'content_drafts',
      op: 'update',
      value: { status: 'ready' },
    });
    expect(db.filters).toContainEqual(['content_drafts', 'status', 'draft']);
    expect(result).toEqual({ status: 'draft', action_tasks_done: 1 });
    expect(db.writes).toContainEqual({
      table: 'action_events',
      op: 'insert',
      value: {
        action_id: 'act-1',
        event: 'task_status',
        data: { taskId: 't-optimize', to: 'completed', draftId: 'd1' },
        actor_id: 'user-1',
      },
    });
    expect(db.rpcCalls).toContainEqual([
      'content_draft_snapshot',
      { p_draft_id: 'd1', p_origin: 'ready' },
    ]);

    db.writes = [];
    db.rows.content_drafts = draftRow({ status: 'published' });
    await expect(setContentDraftReadyFor(auth, 'd1')).resolves.toEqual({
      status: 'published',
      action_tasks_done: 0,
    });
    expect(db.writes).toEqual([]);
  });

  it('leaves an agent’s draft in review to a person', async () => {
    db.rows.content_drafts = draftRow({ status: 'in_review', author: 'agent' });
    await expect(setContentDraftReadyFor(auth, 'd1')).resolves.toBe('in_review');
    expect(db.writes).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });
});

describe('getContentImpactFor', () => {
  it('says a new page has nothing to measure yet', async () => {
    db.rows.content_drafts = draftRow({ source_url: null });
    await expect(getContentImpactFor(auth, 'd1', 30)).resolves.toBe('no_page');
    expect(db.rpcCalls).toEqual([]);
  });
});
