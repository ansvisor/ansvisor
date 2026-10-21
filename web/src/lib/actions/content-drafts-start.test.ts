import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftStart } from '@/lib/content/drafts';

/**
 * New content and Start (CE-003, CE-015): what a page can start from, and
 * the draft each start opens, with the prompts it should answer.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const OPPORTUNITY = '44444444-4444-4444-4444-444444444444';
const PROMPT = '55555555-5555-5555-5555-555555555555';
const TOPIC = '66666666-6666-6666-6666-666666666666';

interface Call {
  table: string;
  op: string;
  value?: unknown;
  filters: [string, string, unknown][];
}
let calls: Call[];
// What a read of each table returns: a row for maybeSingle, rows otherwise.
let reads: Record<string, unknown>;
let rpcCalls: { fn: string; args: unknown }[];
let rpcRows: unknown[];

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'jwt' } } }),
    },
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return { data: rpcRows, error: null };
    },
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const result = () =>
        call.op === 'insert'
          ? { data: { id: 'new-draft' }, error: null }
          : { data: reads[table] ?? null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (call.filters.push(['eq', col, v]), chain),
        in: (col: string, v: unknown) => (call.filters.push(['in', col, v]), chain),
        order: () => chain,
        limit: () => chain,
        insert: (value: unknown) => ((call.op = 'insert'), (call.value = value), chain),
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve: (r: unknown) => void) => resolve(result()),
      };
      return chain;
    },
  })),
}));

const { createContentDraft, getContentOverlap, getContentStartOptions, importContentPage } =
  await import('./content-drafts');

const inserted = () => calls.find((call) => call.op === 'insert')?.value as Record<string, unknown>;

beforeEach(() => {
  calls = [];
  reads = {};
  rpcCalls = [];
  rpcRows = [];
});

describe('getContentStartOptions', () => {
  it('lists open opportunities, active prompts and the topics that have some', async () => {
    reads = {
      content_opportunities: [
        {
          id: OPPORTUNITY,
          title: 'Create a CRM page for real estate',
          decision: 'create',
          brief: { suggestedTitle: ' CRM for real estate teams ' },
        },
        { id: 'o2', title: 'Refresh the pricing page', decision: 'refresh', brief: null },
      ],
      prompts: [
        { id: PROMPT, text: 'best crm for realtors', topic_id: TOPIC },
        { id: 'p2', text: 'crm pricing', topic_id: null },
      ],
      topics: [
        { id: TOPIC, name: 'Real estate' },
        { id: 't2', name: 'Empty topic' },
      ],
    };
    await expect(getContentStartOptions(BRAND)).resolves.toEqual({
      opportunities: [
        {
          id: OPPORTUNITY,
          title: 'Create a CRM page for real estate',
          decision: 'create',
          pageTitle: 'CRM for real estate teams',
        },
        { id: 'o2', title: 'Refresh the pricing page', decision: 'refresh', pageTitle: null },
      ],
      prompts: [
        { id: PROMPT, text: 'best crm for realtors' },
        { id: 'p2', text: 'crm pricing' },
      ],
      topics: [{ id: TOPIC, name: 'Real estate', promptCount: 1 }],
    });
    expect(calls.find((call) => call.table === 'content_opportunities')!.filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['in', 'status', ['new', 'reviewed', 'sent', 'in_progress']],
    ]);
    expect(calls.find((call) => call.table === 'prompts')!.filters).toEqual([
      ['eq', 'prompt_sets.brand_id', BRAND],
      ['eq', 'is_active', true],
    ]);
  });
});

describe('createContentDraft', () => {
  const start = (over: Partial<DraftStart> = {}): DraftStart => ({
    method: 'create',
    title: 'CRM for real estate teams',
    pageType: 'solution_page',
    source: { kind: 'opportunity', id: OPPORTUNITY },
    ...over,
  });

  it('starts a new page from an opportunity, with its clusters’ prompts and the title as H1', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: null,
        cluster_id: 'c1',
        related_cluster_ids: ['c2'],
      },
      prompt_cluster_members: [{ prompt_id: PROMPT }, { prompt_id: 'p2' }, { prompt_id: PROMPT }],
    };
    await expect(createContentDraft(BRAND, start({ title: 'CRM <for> agents' }))).resolves.toBe(
      'new-draft',
    );
    expect(calls.find((call) => call.table === 'content_opportunities')!.filters).toEqual([
      ['eq', 'id', OPPORTUNITY],
      ['eq', 'brand_id', BRAND],
    ]);
    expect(calls.find((call) => call.table === 'prompt_cluster_members')!.filters).toEqual([
      ['in', 'cluster_id', ['c1', 'c2']],
    ]);
    expect(inserted()).toEqual({
      brand_id: BRAND,
      created_by: 'u1',
      method: 'create',
      title: 'CRM <for> agents',
      page_type: 'solution_page',
      // Start's guess: it follows the page until someone picks a type.
      page_type_source: 'detected',
      body_html: '<h1>CRM &lt;for&gt; agents</h1>',
      opportunity_id: OPPORTUNITY,
      prompt_ids: [PROMPT, 'p2'],
      source_url: null,
    });
  });

  it('keeps a type the person picked as theirs', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: PROMPT,
        cluster_id: null,
        related_cluster_ids: [],
      },
    };
    await createContentDraft(BRAND, start({ typePicked: true }));
    expect(inserted()).toMatchObject({ page_type: 'solution_page', page_type_source: 'user' });
  });

  it('takes the one prompt of an opportunity with no clusters', async () => {
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: PROMPT,
        cluster_id: null,
        related_cluster_ids: [],
      },
    };
    await createContentDraft(BRAND, start());
    expect(calls.some((call) => call.table === 'prompt_cluster_members')).toBe(false);
    expect(inserted()).toMatchObject({ opportunity_id: OPPORTUNITY, prompt_ids: [PROMPT] });
  });

  it('starts from a prompt of the brand’s, its long text cut to a title', async () => {
    reads = { prompts: { id: PROMPT } };
    await createContentDraft(
      BRAND,
      start({ title: `${'word '.repeat(80)}end`, source: { kind: 'prompt', id: PROMPT } }),
    );
    expect(calls[0]).toMatchObject({
      table: 'prompts',
      filters: [
        ['eq', 'prompt_sets.brand_id', BRAND],
        ['eq', 'id', PROMPT],
      ],
    });
    const row = inserted();
    expect((row.title as string).length).toBeLessThanOrEqual(300);
    expect(row).toMatchObject({ opportunity_id: null, prompt_ids: [PROMPT] });
  });

  it('starts from a topic, with its active prompts', async () => {
    reads = { prompts: [{ id: PROMPT }, { id: 'p2' }] };
    await createContentDraft(BRAND, start({ source: { kind: 'topic', id: TOPIC } }));
    expect(calls[0].filters).toEqual([
      ['eq', 'prompt_sets.brand_id', BRAND],
      ['eq', 'topic_id', TOPIC],
      ['eq', 'is_active', true],
    ]);
    expect(inserted()).toMatchObject({ prompt_ids: [PROMPT, 'p2'] });
  });

  it('opens content to optimize as checked against the draft allow-list', async () => {
    await createContentDraft(
      BRAND,
      start({
        method: 'optimize',
        title: 'Pricing',
        pageType: 'pricing',
        source: { kind: 'content' },
        bodyHtml: '<h1>Pricing</h1><p onclick="x()">Plans</p><script>alert(1)</script>',
      }),
    );
    expect(inserted()).toMatchObject({
      method: 'optimize',
      body_html: '<h1>Pricing</h1><p>Plans</p>',
      opportunity_id: null,
      prompt_ids: [],
    });
  });

  it('writes nothing for a source the member can’t read, or a start that isn’t valid', async () => {
    await expect(createContentDraft(BRAND, start())).rejects.toThrow('not_found');
    await expect(
      createContentDraft(BRAND, start({ source: { kind: 'topic', id: TOPIC } })),
    ).rejects.toThrow('not_found');
    await expect(
      createContentDraft(BRAND, start({ pageType: 'landing' as DraftStart['pageType'] })),
    ).rejects.toThrow('invalid');
    await expect(createContentDraft('nope', start())).rejects.toThrow('invalid');
    expect(calls.some((call) => call.op === 'insert')).toBe(false);
  });
});

describe('getContentOverlap', () => {
  it('checks the source’s prompts against the brand’s cited pages', async () => {
    reads = { prompts: [{ id: PROMPT }, { id: 'p2' }, { id: PROMPT }] };
    rpcRows = [
      {
        page: 'https://acme.example/guides/espresso/',
        title: 'Espresso guide',
        prompts_in_common: 2,
        citations: '4',
        gsc_position: '3.5',
      },
      {
        page: 'https://acme.example/blog/x',
        title: null,
        prompts_in_common: 1,
        citations: 1,
        gsc_position: null,
      },
    ];
    await expect(getContentOverlap(BRAND, { kind: 'topic', id: TOPIC })).resolves.toEqual({
      totalPrompts: 2,
      pages: [
        {
          url: 'https://acme.example/guides/espresso/',
          title: 'Espresso guide',
          promptsInCommon: 2,
          citations: 4,
          gscPosition: 3.5,
        },
        {
          url: 'https://acme.example/blog/x',
          title: null,
          promptsInCommon: 1,
          citations: 1,
          gscPosition: null,
        },
      ],
    });
    expect(rpcCalls).toEqual([
      { fn: 'content_page_overlap', args: { p_brand_id: BRAND, p_prompt_ids: [PROMPT, 'p2'] } },
    ]);
  });

  it('has nothing to check for content to optimize, or a source with no prompts', async () => {
    await expect(getContentOverlap(BRAND, { kind: 'content' })).resolves.toEqual({
      totalPrompts: 0,
      pages: [],
    });
    reads = {
      content_opportunities: {
        id: OPPORTUNITY,
        prompt_id: null,
        cluster_id: null,
        related_cluster_ids: [],
      },
    };
    await expect(
      getContentOverlap(BRAND, { kind: 'opportunity', id: OPPORTUNITY }),
    ).resolves.toEqual({ totalPrompts: 0, pages: [] });
    expect(rpcCalls).toEqual([]);
  });
});

describe('optimizing an existing page instead (overlap check)', () => {
  it('keeps the page’s address and starts the draft with its title as H1', async () => {
    reads = { prompts: [{ id: PROMPT }] };
    await createContentDraft(BRAND, {
      method: 'optimize',
      title: 'Espresso guide',
      pageType: 'buying_guide',
      source: { kind: 'topic', id: TOPIC },
      sourceUrl: 'https://acme.example/guides/espresso/',
    });
    expect(inserted()).toMatchObject({
      method: 'optimize',
      body_html: '<h1>Espresso guide</h1>',
      source_url: 'https://acme.example/guides/espresso/',
      prompt_ids: [PROMPT],
    });
  });

  it('refuses an address that isn’t a web page’s', async () => {
    await expect(
      createContentDraft(BRAND, {
        method: 'optimize',
        title: 'x',
        pageType: 'guide',
        source: { kind: 'content' },
        sourceUrl: 'javascript:alert(1)',
      }),
    ).rejects.toThrow('invalid');
    expect(calls).toEqual([]);
  });
});

describe('importContentPage', () => {
  const answer = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('asks the API to read the page, with the member’s session', async () => {
    const fetchMock = answer(200, {
      url: 'https://northwind.example/pricing',
      title: 'Pricing',
      html: '<h1>Pricing</h1>',
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(importContentPage(BRAND, ' northwind.example/pricing ')).resolves.toEqual({
      page: {
        url: 'https://northwind.example/pricing',
        title: 'Pricing',
        html: '<h1>Pricing</h1>',
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/content-pages\/import$/);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
    expect(JSON.parse(init.body as string)).toEqual({
      brandId: BRAND,
      url: 'northwind.example/pricing',
    });
    vi.unstubAllGlobals();
  });

  it('names why the page couldn’t be read, and an unknown answer as failed', async () => {
    vi.stubGlobal('fetch', answer(422, { code: 'http_error', status: 404 }));
    await expect(importContentPage(BRAND, 'https://northwind.example/x')).resolves.toEqual({
      error: 'http_error',
      status: 404,
    });
    vi.stubGlobal('fetch', answer(500, { code: 'something_new' }));
    await expect(importContentPage(BRAND, 'https://northwind.example/x')).resolves.toEqual({
      error: 'failed',
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(importContentPage(BRAND, 'https://northwind.example/x')).resolves.toEqual({
      error: 'failed',
    });
    vi.unstubAllGlobals();
  });

  it('asks for nothing with a malformed brand or an empty address', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(importContentPage('nope', 'https://x.example')).resolves.toEqual({
      error: 'invalid_url',
    });
    await expect(importContentPage(BRAND, '  ')).resolves.toEqual({ error: 'invalid_url' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
