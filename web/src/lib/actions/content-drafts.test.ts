import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The editor's writes (CE-004): a save or Mark ready that RLS turns away
 * matches no row without an error, so each reads its row back and says so.
 */

const DRAFT = '2f1d1c52-0f7a-4c1e-9b8a-5d6e7f8a9b0c';
const VERSION = '3a2e2d63-1f8b-4d2f-8c9b-6e7f8a9b0c1d';

interface Call {
  op: string;
  value?: unknown;
  filters: [string, string, unknown][];
}
let calls: Call[];
// What the next update returns: its row, or none (RLS, or not found).
let updated: Record<string, unknown> | null;
// Or, update by update, when a test needs more than one.
let updates: (Record<string, unknown> | null)[];
let row: Record<string, unknown> | null;
// What a list read returns (History's versions).
let list: Record<string, unknown>[];
// Database functions called, and what the next one returns.
let rpcCalls: [string, unknown][];
let rpcResult: { data: unknown; error: { message: string } | null };

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
const completeDraftTasks = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/action-drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content/action-drafts')>()),
  completeDraftTasks,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
    },
    rpc: async (name: string, args: unknown) => (rpcCalls.push([name, args]), rpcResult),
    from: () => {
      const call: Call = { op: 'select', filters: [] };
      calls.push(call);
      const result = () =>
        call.op === 'update'
          ? { data: updates.length ? updates.shift()! : updated, error: null }
          : call.op === 'insert'
            ? { data: { id: 'new-draft' }, error: null }
            : { data: row, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (call.filters.push(['eq', col, v]), chain),
        in: (col: string, v: unknown) => (call.filters.push(['in', col, v]), chain),
        gte: (col: string, v: unknown) => (call.filters.push(['gte', col, v]), chain),
        or: (v: string) => (call.filters.push(['or', v, null]), chain),
        order: () => chain,
        // The list, by its batch when one is asked for; the first row alone
        // when the read is for one (the latest batch).
        limit: () => {
          const batch = call.filters.find(([op, col]) => op === 'eq' && col === 'batch_id');
          const rows = batch
            ? list.filter((r) => (r as { batch_id?: unknown }).batch_id === batch[2])
            : list;
          return Object.assign(Promise.resolve({ data: rows, error: null }), {
            maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          });
        },
        update: (value: unknown) => ((call.op = 'update'), (call.value = value), chain),
        insert: (value: unknown) => ((call.op = 'insert'), (call.value = value), chain),
        maybeSingle: async () => result(),
        single: async () => result(),
      };
      return chain;
    },
  })),
}));

const {
  createContentDraft,
  fixDraftRules,
  decideDraftSuggestions,
  getDraftSuggestions,
  keepAgentBeforeVersion,
  getCitedPassages,
  getContentDraft,
  getDraftVersions,
  markContentDraftReady,
  restoreDraftVersion,
  saveContentDraft,
  setContentDraftPageType,
} = await import('./content-drafts');
const { bodyHash } = await import('@/lib/content/editor');

beforeEach(() => {
  calls = [];
  updated = null;
  updates = [];
  row = null;
  list = [];
  rpcCalls = [];
  rpcResult = { data: 'v-new', error: null };
  completeDraftTasks.mockReset().mockResolvedValue(0);
});

describe('saveContentDraft', () => {
  const LOADED = '<h1>Pipeline</h1>';
  const base = async (html = LOADED) => ({
    updatedAt: '2026-10-20T14:00:00Z',
    bodyHash: await bodyHash(html),
  });

  it('saves the body and the title over the version the editor last saw', async () => {
    updated = { updated_at: '2026-10-20T15:00:00Z' };
    await expect(
      saveContentDraft(DRAFT, {
        title: 'Pipeline forecasting',
        bodyHtml: '<h1>Pipeline forecasting</h1>',
        base: await base(),
      }),
    ).resolves.toEqual({
      ok: true,
      updatedAt: '2026-10-20T15:00:00Z',
      bodyHash: await bodyHash('<h1>Pipeline forecasting</h1>'),
    });
    expect(calls[0]).toMatchObject({
      op: 'update',
      value: { title: 'Pipeline forecasting', body_html: '<h1>Pipeline forecasting</h1>' },
      filters: [
        ['eq', 'id', DRAFT],
        ['eq', 'updated_at', '2026-10-20T14:00:00Z'],
        // Not while the Content Agent writes it.
        ['or', expect.stringMatching(/^agent_state\.is\.null,agent_state\.neq\.writing,/), null],
      ],
    });
  });

  it('checks the body against the draft allow-list again before saving it', async () => {
    updated = { updated_at: '2026-10-20T15:00:00Z' };
    const result = await saveContentDraft(DRAFT, {
      title: 'Hi',
      bodyHtml: '<p onclick="steal()">Hi</p><script>alert(1)</script>',
      base: await base(),
    });
    expect(calls[0].value).toEqual({ title: 'Hi', body_html: '<p>Hi</p>' });
    // The fingerprint is of the page as stored.
    expect(result).toMatchObject({ ok: true, bodyHash: await bodyHash('<p>Hi</p>') });
  });

  it('goes over a change to the draft’s other columns, the page being the same', async () => {
    // Marked ready meanwhile: a newer updated_at, the page as the editor saw it.
    updates = [null, { updated_at: '2026-10-20T15:01:00Z' }];
    row = { updated_at: '2026-10-20T14:30:00Z', body_html: LOADED };
    const result = await saveContentDraft(DRAFT, {
      title: 'Pipeline',
      bodyHtml: '<h1>Pipeline</h1><p>More</p>',
      base: await base(),
    });
    expect(result).toMatchObject({ ok: true, updatedAt: '2026-10-20T15:01:00Z' });
    expect(calls.map((c) => c.op)).toEqual(['update', 'select', 'update']);
    expect(calls[2].filters).toContainEqual(['eq', 'updated_at', '2026-10-20T14:30:00Z']);
  });

  it('takes the page of its own save whose answer was lost as its own', async () => {
    // The lost save wrote "<h1>Mine</h1>"; the editor still holds the loaded base.
    updates = [null, { updated_at: '2026-10-20T15:01:00Z' }];
    row = { updated_at: '2026-10-20T14:30:00Z', body_html: '<h1>Mine</h1>' };
    const result = await saveContentDraft(DRAFT, {
      title: 'Mine',
      bodyHtml: '<h1>Mine</h1><p>More</p>',
      base: { ...(await base()), unconfirmedHash: await bodyHash('<h1>Mine</h1>') },
    });
    expect(result).toMatchObject({ ok: true, updatedAt: '2026-10-20T15:01:00Z' });
  });

  it('takes a page that already holds what is being saved as its own', async () => {
    // A lost save wrote this very page; the editor sends it again.
    updates = [null, { updated_at: '2026-10-20T15:01:00Z' }];
    row = { updated_at: '2026-10-20T14:30:00Z', body_html: '<h1>Mine</h1><p>More</p>' };
    const result = await saveContentDraft(DRAFT, {
      title: 'Mine',
      bodyHtml: '<h1>Mine</h1><p>More</p>',
      base: await base(),
    });
    expect(result).toMatchObject({ ok: true, updatedAt: '2026-10-20T15:01:00Z' });
  });

  it('doesn’t overwrite a page someone else changed', async () => {
    row = { updated_at: '2026-10-20T14:30:00Z', body_html: '<h1>Their version</h1>' };
    await expect(
      saveContentDraft(DRAFT, { title: 'Mine', bodyHtml: '<h1>Mine</h1>', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'conflict' });
    expect(calls.map((c) => c.op)).toEqual(['update', 'select']);
  });

  it('waits while the Content Agent writes the page, the page being the same', async () => {
    row = {
      updated_at: '2026-10-20T14:30:00Z',
      body_html: LOADED,
      agent_state: 'writing',
      agent_state_at: new Date().toISOString(),
    };
    await expect(
      saveContentDraft(DRAFT, { title: 'Mine', bodyHtml: '<h1>Mine</h1>', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'conflict' });
    expect(calls.map((c) => c.op)).toEqual(['update', 'select']);
  });

  it('says so when the draft is gone or not the member’s, rather than reporting it saved', async () => {
    await expect(
      saveContentDraft(DRAFT, { title: '', bodyHtml: '', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'not_found' });
  });

  it('says a body over the limit is too large, and refuses a bad title or id, before writing', async () => {
    await expect(
      saveContentDraft(DRAFT, { title: '', bodyHtml: 'x'.repeat(500_001), base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'too_large' });
    await expect(
      saveContentDraft(DRAFT, { title: 'x'.repeat(301), bodyHtml: '', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(
      saveContentDraft('nope', { title: '', bodyHtml: '', base: await base() }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(calls).toEqual([]);
  });
});

describe('the page type on save (CE-023)', () => {
  const shop = { site_type: null, industry: 'E-commerce & Retail', shopping_mode_enabled: false };
  const base = { updatedAt: '2026-10-20T14:00:00Z', bodyHash: 'a'.repeat(64) };

  it('detects it again from what was saved, writing it only while it is still detected', async () => {
    updates = [
      {
        updated_at: '2026-10-20T15:00:00Z',
        page_type: null,
        page_type_source: 'detected',
        brands: shop,
      },
      { updated_at: '2026-10-20T15:00:01Z' },
    ];
    const result = await saveContentDraft(DRAFT, {
      title: 'The 7 best ultralight tents',
      bodyHtml: '<h1>The 7 best ultralight tents</h1>',
      base,
    });
    // The type's write makes the version the editor goes on from.
    expect(result).toMatchObject({ ok: true, updatedAt: '2026-10-20T15:00:01Z' });
    expect(calls[1]).toMatchObject({
      op: 'update',
      value: { page_type: 'best_of' },
      filters: [
        ['eq', 'id', DRAFT],
        ['eq', 'page_type_source', 'detected'],
        // Only over this save: a write in between keeps its own version.
        ['eq', 'updated_at', '2026-10-20T15:00:00Z'],
      ],
    });
  });

  it('keeps the type it had when the page shows none, as Start’s guess', async () => {
    updated = {
      updated_at: '2026-10-20T15:00:00Z',
      page_type: 'blog_post',
      page_type_source: 'detected',
      brands: shop,
    };
    await saveContentDraft(DRAFT, {
      title: 'Our spring update',
      bodyHtml: '<h1>Our spring update</h1>',
      base,
    });
    expect(calls.map((call) => call.op)).toEqual(['update']);
  });

  it('writes nothing more when the type is unchanged, or the person picked it', async () => {
    updated = {
      updated_at: '2026-10-20T15:00:00Z',
      page_type: 'best_of',
      page_type_source: 'detected',
      brands: shop,
    };
    await saveContentDraft(DRAFT, {
      title: 'The 7 best tents',
      bodyHtml: '<h1>The 7 best tents</h1>',
      base,
    });
    updated = { ...updated, page_type: 'policy', page_type_source: 'user' };
    await saveContentDraft(DRAFT, {
      title: 'The 7 best tents',
      bodyHtml: '<h1>The 7 best tents</h1>',
      base,
    });
    expect(calls.map((call) => call.op)).toEqual(['update', 'update']);
  });
});

describe('setContentDraftPageType', () => {
  it('keeps the picked type from now on', async () => {
    updated = { id: DRAFT };
    await setContentDraftPageType(DRAFT, 'guide');
    expect(calls[0]).toMatchObject({
      op: 'update',
      value: { page_type: 'guide', page_type_source: 'user' },
      filters: [['eq', 'id', DRAFT]],
    });
  });

  it('refuses a type it doesn’t know, and says so when the draft isn’t the member’s', async () => {
    await expect(
      setContentDraftPageType(
        DRAFT,
        'landing_page' as Parameters<typeof setContentDraftPageType>[1],
      ),
    ).rejects.toThrow('invalid');
    expect(calls).toEqual([]);
    await expect(setContentDraftPageType(DRAFT, 'guide')).rejects.toThrow('not_found');
  });
});

describe('markContentDraftReady', () => {
  it('moves a draft or an agent draft in review to ready', async () => {
    updated = { status: 'ready' };
    await expect(markContentDraftReady(DRAFT)).resolves.toEqual({ status: 'ready', tasksDone: 0 });
    expect(completeDraftTasks).not.toHaveBeenCalled();
    expect(calls[0]).toMatchObject({
      op: 'update',
      value: { status: 'ready' },
      filters: [
        ['eq', 'id', DRAFT],
        ['in', 'status', ['draft', 'in_review']],
      ],
    });
  });

  it('leaves a published draft published', async () => {
    row = {
      id: DRAFT,
      brand_id: 'b1',
      title: '',
      page_type: null,
      method: 'create',
      status: 'published',
      body_html: '',
      author: 'user',
      updated_at: '2026-10-20T15:00:00Z',
    };
    await expect(markContentDraftReady(DRAFT)).resolves.toEqual({
      status: 'published',
      tasksDone: 0,
    });
    expect(completeDraftTasks).not.toHaveBeenCalled();
  });

  it('completes the task of the action the draft is the work of (CE-022)', async () => {
    updated = { status: 'ready', brand_id: 'b1', method: 'optimize', action_id: 'act-1' };
    completeDraftTasks.mockResolvedValue(1);
    await expect(markContentDraftReady(DRAFT)).resolves.toEqual({ status: 'ready', tasksDone: 1 });
    expect(completeDraftTasks).toHaveBeenCalledWith(
      expect.anything(),
      { id: DRAFT, brandId: 'b1', actionId: 'act-1', method: 'optimize' },
      'u1',
    );

    // The draft is ready even when the task couldn't be completed.
    completeDraftTasks.mockRejectedValue(new Error('rls'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(markContentDraftReady(DRAFT)).resolves.toEqual({ status: 'ready', tasksDone: 0 });
  });

  it('says so when the draft isn’t the member’s', async () => {
    await expect(markContentDraftReady(DRAFT)).rejects.toThrow('not_found');
  });

  it('keeps the ready page in History, and only when it became ready', async () => {
    updated = { status: 'ready' };
    await markContentDraftReady(DRAFT);
    expect(rpcCalls).toEqual([
      ['content_draft_snapshot', { p_draft_id: DRAFT, p_origin: 'ready' }],
    ]);

    rpcCalls = [];
    updated = null;
    row = { id: DRAFT, brand_id: 'b1', status: 'ready', author: 'user' };
    await markContentDraftReady(DRAFT);
    expect(rpcCalls).toEqual([]);
  });

  it('is ready even when History couldn’t keep the version', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    updated = { status: 'ready' };
    rpcResult = { data: null, error: { message: 'timeout' } };
    await expect(markContentDraftReady(DRAFT)).resolves.toEqual({ status: 'ready', tasksDone: 0 });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('History', () => {
  const BRAND = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
  const start = {
    method: 'optimize' as const,
    title: 'Pricing',
    pageType: 'pricing' as const,
    source: { kind: 'content' as const },
  };

  it('starts a page brought in from its address with the live page', async () => {
    await createContentDraft(BRAND, {
      ...start,
      bodyHtml: '<h1>Pricing</h1>',
      sourceUrl: 'https://acme.example/pricing',
    });
    expect(rpcCalls).toEqual([
      ['content_draft_snapshot', { p_draft_id: 'new-draft', p_origin: 'import' }],
    ]);

    rpcCalls = [];
    await createContentDraft(BRAND, { ...start, bodyHtml: '<h1>Pasted</h1>' });
    await createContentDraft(BRAND, { ...start, sourceUrl: 'https://acme.example/pricing' });
    expect(rpcCalls).toEqual([]);
  });

  it('lists the versions of the last 90 days, the known origins only', async () => {
    list = [
      { id: 'v2', origin: 'ready', title: 'A', created_at: '2026-10-20T10:00:00Z' },
      { id: 'v3', origin: 'something_new', title: 'B', created_at: '2026-10-19T10:00:00Z' },
      { id: 'v1', origin: 'import', title: 'C', created_at: '2026-10-12T10:00:00Z' },
    ];
    await expect(getDraftVersions(DRAFT)).resolves.toEqual([
      { id: 'v2', origin: 'ready', title: 'A', createdAt: '2026-10-20T10:00:00Z' },
      { id: 'v1', origin: 'import', title: 'C', createdAt: '2026-10-12T10:00:00Z' },
    ]);
    const [, since] = calls[0].filters.find(([op]) => op === 'gte')!.slice(1);
    const days = (Date.now() - Date.parse(since as string)) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(90);
    expect(calls[0].filters).toContainEqual(['eq', 'draft_id', DRAFT]);
  });

  it('restores a version and returns the page the server has now', async () => {
    rpcResult = {
      data: { title: 'Old', bodyHtml: '<h1>Old</h1>', updatedAt: '2026-10-21T10:00:00Z' },
      error: null,
    };
    await expect(restoreDraftVersion(DRAFT, VERSION)).resolves.toEqual({
      title: 'Old',
      bodyHtml: '<h1>Old</h1>',
      updatedAt: '2026-10-21T10:00:00Z',
    });
    expect(rpcCalls).toEqual([['content_draft_restore', { p_version_id: VERSION }]]);

    rpcResult = { data: null, error: null };
    await expect(restoreDraftVersion(DRAFT, VERSION)).rejects.toThrow('not_found');
    await expect(restoreDraftVersion(DRAFT, '../etc')).rejects.toThrow('invalid');
  });

  it('gives a draft whose type follows its page the restored page’s type', async () => {
    rpcResult = {
      data: { title: 'Acme vs HubSpot', bodyHtml: '<h1>Acme vs HubSpot</h1>', updatedAt: 't1' },
      error: null,
    };
    row = {
      page_type: 'blog_post',
      page_type_source: 'detected',
      body_html: '<h1>Acme vs HubSpot</h1>',
      brands: { site_type: 'b2b', industry: 'Software', shopping_mode_enabled: false },
    };
    updates = [{ updated_at: 't2' }];
    // The saves go on from the type write.
    await expect(restoreDraftVersion(DRAFT, VERSION)).resolves.toMatchObject({ updatedAt: 't2' });
    const typed = calls.find((call) => call.op === 'update')!;
    expect(typed.value).toEqual({ page_type: 'comparison' });
    expect(typed.filters).toContainEqual(['eq', 'page_type_source', 'detected']);
    // Only over the restore.
    expect(typed.filters).toContainEqual(['eq', 'updated_at', 't1']);

    // A type the person picked stays.
    calls = [];
    row = { ...row, page_type_source: 'user' };
    await expect(restoreDraftVersion(DRAFT, VERSION)).resolves.toMatchObject({ updatedAt: 't1' });
    expect(calls.some((call) => call.op === 'update')).toBe(false);
  });
});

describe('getContentDraft', () => {
  it('opens a draft with its brand’s site type, chosen or guessed', async () => {
    const base = {
      id: DRAFT,
      brand_id: 'b1',
      title: '',
      page_type: 'guide',
      page_type_source: 'user',
      method: 'create',
      status: 'draft',
      body_html: '',
      author: 'user',
      updated_at: '2026-10-20T15:00:00Z',
    };
    row = {
      ...base,
      brands: { site_type: 'b2c', industry: 'Technology', shopping_mode_enabled: true },
    };
    await expect(getContentDraft(DRAFT)).resolves.toMatchObject({
      pageType: 'guide',
      pageTypeSource: 'user',
      siteType: 'b2c',
    });
    row = {
      ...base,
      brands: { site_type: null, industry: 'Technology', shopping_mode_enabled: true },
    };
    await expect(getContentDraft(DRAFT)).resolves.toMatchObject({ siteType: 'ecommerce' });
  });

  it('reads nothing for a malformed id', async () => {
    await expect(getContentDraft('../etc')).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('getCitedPassages', () => {
  const QUOTED = 'Northwind forecasts each deal from real activity: emails, meetings.';

  it('matches the page’s passages against the answers citing it, on the server', async () => {
    rpcResult = {
      data: [
        { platform: 'chatgpt-web', response: `They say: ${QUOTED}` },
        { platform: 'gemini-web', response: 'Unrelated.' },
      ],
      error: null,
    };
    await expect(getCitedPassages(DRAFT, [QUOTED, 'Teams trust it.'])).resolves.toEqual([
      {
        key: 'northwind forecasts each deal from real activity emails meetings',
        platforms: [{ platform: 'chatgpt-web', answers: 1 }],
      },
    ]);
    expect(rpcCalls).toEqual([['content_draft_cited_answers', { p_draft_id: DRAFT, p_days: 30 }]]);
  });

  it('is null for a draft the member can’t read, and refuses a malformed request', async () => {
    rpcResult = { data: null, error: null };
    await expect(getCitedPassages(DRAFT, [QUOTED])).resolves.toBeNull();
    await expect(getCitedPassages('../etc', [QUOTED])).rejects.toThrow('invalid');
    await expect(getCitedPassages(DRAFT, ['x'.repeat(5_001)])).rejects.toThrow('invalid');
  });
});

describe('agent suggestions', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 's1',
    batch_id: 'new',
    action_id: 'a1',
    kind: 'replace',
    block_text: 'Our forecasting is very accurate.',
    before_text: 'very accurate',
    after_text: 'shown per team',
    reason: 'answer a fan-out',
    rule_keys: ['dated'],
    position: 0,
    status: 'open',
    created_at: '2026-10-21T10:00:00Z',
    actions: { action_no: 214 },
    ...over,
  });

  it('reads the latest batch, in the agent’s order, with its action', async () => {
    list = [
      row({ id: 's2', position: 1, kind: 'insert', before_text: '' }),
      row({ id: 's1', position: 0 }),
      row({ id: 'old', batch_id: 'older', created_at: '2026-10-01T10:00:00Z' }),
    ];
    const read = await getDraftSuggestions(DRAFT);
    expect(read.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(read[0]).toEqual({
      id: 's1',
      batchId: 'new',
      actionId: 'a1',
      actionNo: 214,
      kind: 'replace',
      blockText: 'Our forecasting is very accurate.',
      beforeText: 'very accurate',
      afterText: 'shown per team',
      afterLinks: null,
      beforeHtml: null,
      reason: 'answer a fan-out',
      ruleKeys: ['dated'],
      status: 'open',
      // When the run left it, for "Last used by Content Agent".
      createdAt: '2026-10-21T10:00:00Z',
    });
    expect(calls[0].filters).toContainEqual(['eq', 'draft_id', DRAFT]);
    // The latest batch is found first; only its rows are read whole.
    expect(calls[1].filters).toContainEqual(['eq', 'batch_id', 'new']);
  });

  it('reads none for a draft the agent never suggested on', async () => {
    list = [];
    await expect(getDraftSuggestions(DRAFT)).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('reads a whole page rewritten, with the page the agent read (00247)', async () => {
    list = [
      row({
        kind: 'page',
        before_text: '',
        before_html: '<h1>Old</h1><p>Old page.</p>',
        after_text: '<h1>New</h1><p>New page.</p>',
        after_links: [{ start: 0, end: 3, href: 'https://acme.example' }],
      }),
    ];
    const [read] = await getDraftSuggestions(DRAFT);
    expect(read).toMatchObject({
      kind: 'page',
      beforeHtml: '<h1>Old</h1><p>Old page.</p>',
      afterText: '<h1>New</h1><p>New page.</p>',
      afterLinks: null,
    });
  });

  it('reads a replace’s links, keeping only safe ones inside its words (00240)', async () => {
    list = [
      row({
        after_links: [
          { start: 0, end: 5, href: 'https://acme.example/pricing' },
          { start: 3, end: 9, href: 'https://acme.example/overlap' },
          { start: 10, end: 14, href: 'javascript:alert(1)' },
        ],
      }),
    ];
    const [read] = await getDraftSuggestions(DRAFT);
    expect(read.afterLinks).toEqual([{ start: 0, end: 5, href: 'https://acme.example/pricing' }]);
  });

  it('keeps who decided through the database function', async () => {
    rpcResult = { data: 2, error: null };
    await expect(decideDraftSuggestions([DRAFT, DRAFT], 'accepted')).resolves.toBe(2);
    expect(rpcCalls).toEqual([
      ['content_draft_decide_suggestions', { p_ids: [DRAFT, DRAFT], p_status: 'accepted' }],
    ]);

    rpcResult = { data: 0, error: null };
    await expect(decideDraftSuggestions([DRAFT], 'open')).rejects.toThrow('not_found');
    await expect(decideDraftSuggestions([], 'open')).rejects.toThrow('invalid');
    await expect(decideDraftSuggestions([DRAFT], 'maybe' as unknown as 'open')).rejects.toThrow(
      'invalid',
    );
  });

  it('keeps the page before agent changes in History', async () => {
    await keepAgentBeforeVersion(DRAFT);
    expect(rpcCalls).toEqual([
      ['content_draft_snapshot', { p_draft_id: DRAFT, p_origin: 'agent_before' }],
    ]);
  });
});

describe('fixDraftRules', () => {
  const BRAND = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
  const request = {
    rules: [{ key: 'aiTraces', name: 'Remove AI traces', detail: 'phrases found: delve' }],
    textRules: ['Say “we”'],
    locked: ['northwind forecasts each deal'],
  };

  it('asks the server’s agent with the session, and says how many it left', async () => {
    const fetchMock = vi.fn(async () => Response.json({ count: 3, batchId: 'b' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fixDraftRules(DRAFT, BRAND, request)).resolves.toEqual({ count: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/api/content-drafts/${DRAFT}/suggestions$`));
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ brandId: BRAND, ...request });
    vi.unstubAllGlobals();
  });

  it('names the budget and the empty page, and anything else as failed', async () => {
    for (const [body, error] of [
      [{ code: 'ai_budget' }, 'ai_budget'],
      [{ code: 'empty' }, 'empty'],
      [{ code: 'teapot' }, 'failed'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(body, { status: 402 })),
      );
      await expect(fixDraftRules(DRAFT, BRAND, request)).resolves.toEqual({ error });
    }
    vi.unstubAllGlobals();
    await expect(fixDraftRules('../etc', BRAND, request)).resolves.toEqual({ error: 'failed' });
  });
});
