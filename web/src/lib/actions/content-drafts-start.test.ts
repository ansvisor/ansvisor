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

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
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

const { createContentDraft, getContentStartOptions } = await import('./content-drafts');

const inserted = () => calls.find((call) => call.op === 'insert')?.value as Record<string, unknown>;

beforeEach(() => {
  calls = [];
  reads = {};
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
