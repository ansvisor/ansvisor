// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANS } from '@/config/plans';

/**
 * "New area to track" on Today (SIMPLE_NAV), on the server: who gets a
 * candidate and when, read from stored data only; "Suggest 5 prompts"
 * making the topic (from its idea, or plain, or the brand's empty one) and
 * listing its stored ideas; the generator asked once; and the ticked prompts
 * tracked through add_prompts' path, their ideas marked added.
 */

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  rpc: null as unknown,
}));

/** A query over one table's rows: the filters this file uses, then its rows or the first. */
function query(table: string) {
  let rows = [...(db.tables[table] ?? [])];
  let limit = Infinity;
  // A filter on a joined table's column (prompt_sets.brand_id) reads the row's own.
  const col = (name: string) => name.split('.').pop()!;
  const q = {
    select: () => q,
    eq: (name: string, value: unknown) => {
      rows = rows.filter((row) => row[col(name)] === value);
      return q;
    },
    in: (name: string, values: unknown[]) => {
      rows = rows.filter((row) => values.includes(row[col(name)]));
      return q;
    },
    order: (name: string, { ascending }: { ascending: boolean }) => {
      rows.sort((a, b) => String(a[name]).localeCompare(String(b[name])) * (ascending ? 1 : -1));
      return q;
    },
    limit: (n: number) => {
      limit = n;
      return q;
    },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows.slice(0, limit), error: null }).then(resolve, reject),
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: db.user } }),
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
    },
    from: (table: string) => query(table),
    rpc: async () => ({ data: db.rpc, error: null }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: vi.fn(async () => {}) }));
const fns = vi.hoisted(() => ({
  plan: null as unknown,
  usage: { total: 47, byBrand: new Map() } as unknown,
  hidden: {} as Record<string, string | null>,
  acceptTopicSuggestion: vi.fn(),
  createTopic: vi.fn(),
  addTopicPrompts: vi.fn(),
}));
vi.mock('@/lib/session-role', () => ({
  isManager: async () => db.tables.profiles?.[0]?.role !== 'analyst',
}));
vi.mock('@/lib/guards/plan-guard', () => ({ getOrgPlan: async () => fns.plan }));
vi.mock('@/lib/prompt-locations', () => ({ getOrgLocationUsage: async () => fns.usage }));
vi.mock('@/lib/actions/user-brand-state', () => ({
  readUserBrandState: async () => ({ navSeen: {}, focus: [], hidden: fns.hidden }),
}));
vi.mock('@/lib/actions/topic-suggestions', () => ({
  acceptTopicSuggestion: fns.acceptTopicSuggestion,
}));
vi.mock('@/lib/actions/topic', () => ({ createTopic: fns.createTopic }));
vi.mock('@/lib/actions/prompt', () => ({ addTopicPrompts: fns.addTopicPrompts }));

const { getTodayTopic, openTopicCard, trackTopicPrompts, writeTopicPrompts } =
  await import('./today-topic');

const NOW = new Date('2026-11-16T09:00:00Z');
const fetchMock = vi.fn();

const catalogIdea = (id: string, name: string, products: number): Row => ({
  id,
  brand_id: 'b1',
  name,
  source: 'catalog',
  status: 'new',
  source_data: { category: `Coffee > ${name}`, categoryId: 'c1', products, inStock: products },
});
const promptIdea = (id: string, over: Row): Row => ({
  id,
  brand_id: 'b1',
  status: 'new',
  topic_id: null,
  topic_name: 'Decaf',
  source: 'gsc',
  suggested_text: `decaf idea ${id}`,
  est_volume: null,
  expires_at: '2026-11-30T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  db.user = { id: 'u1' };
  db.rpc = null;
  db.tables = {
    profiles: [{ id: 'u1', role: 'manager' }],
    brands: [
      {
        id: 'b1',
        organization_id: 'o1',
        is_demo: false,
        created_at: '2026-10-01T00:00:00Z',
        name: 'Brewline Coffee',
        industry: 'Coffee',
        description: 'Specialty roaster',
        language: 'en',
      },
    ],
    topic_suggestions: [catalogIdea('t1', 'Cold brew', 4)],
    prompt_suggestions: [],
    topics: [],
    prompts: [],
    competitors: [],
  };
  fns.plan = PLANS.starter;
  fns.usage = { total: 47, byBrand: new Map() };
  fns.hidden = {};
  fns.acceptTopicSuggestion.mockResolvedValue({ topicId: 'topic-new' });
  fns.createTopic.mockImplementation(async (_brand: string, name: string) => ({
    id: 'topic-plain',
    name,
  }));
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('getTodayTopic', () => {
  it('gives the strongest candidate with the spots left on the plan', async () => {
    const topic = await getTodayTopic('b1');
    expect(topic).toEqual({
      candidate: expect.objectContaining({
        key: 'cold brew',
        name: 'Cold brew',
        source: 'catalog',
        catalog: { suggestionId: 't1', category: 'Coffee > Cold brew', products: 4 },
        competitors: [],
      }),
      spots: { left: 3, plan: 'Starter' },
    });
  });

  it('gives none to an analyst, on the demo brand, or before the workspace is 14 days old', async () => {
    db.tables.profiles = [{ id: 'u1', role: 'analyst' }];
    expect(await getTodayTopic('b1')).toBeNull();
    db.tables.profiles = [{ id: 'u1', role: 'admin' }];
    db.tables.brands[0].is_demo = true;
    expect(await getTodayTopic('b1')).toBeNull();
    db.tables.brands[0].is_demo = false;
    db.tables.brands[0].created_at = '2026-11-10T00:00:00Z';
    expect(await getTodayTopic('b1')).toBeNull();
    // The workspace's first brand counts, not this one.
    db.tables.brands.push({ id: 'b0', organization_id: 'o1', created_at: '2026-09-01T00:00:00Z' });
    expect(await getTodayTopic('b1')).not.toBeNull();
  });

  it('gives none on a plan without topic suggestions', async () => {
    fns.plan = {
      ...PLANS.starter,
      limits: { ...PLANS.starter.limits, features: [] },
    };
    expect(await getTodayTopic('b1')).toBeNull();
  });

  it('leaves out a topic with a prompt tracked or waiting, and one the person snoozed', async () => {
    db.tables.topics = [{ id: 'topic-1', brand_id: 'b1', name: 'Cold brew', is_active: true }];
    db.tables.prompts = [
      { brand_id: 'b1', topic_id: 'topic-1', is_active: false, waiting_since: 'x' },
    ];
    expect(await getTodayTopic('b1')).toBeNull();
    db.tables.prompts = [];
    expect((await getTodayTopic('b1'))?.candidate.topicId).toBe('topic-1');
    fns.hidden = { 'topic:cold brew': '2026-12-01T00:00:00Z' };
    expect(await getTodayTopic('b1')).toBeNull();
  });

  it("names rivals from the topic's stored answers when its prompts were tracked once", async () => {
    db.tables.topic_suggestions = [];
    db.tables.topics = [{ id: 'topic-1', brand_id: 'b1', name: 'Decaf', is_active: true }];
    db.tables.prompt_suggestions = [1, 2, 3].map((n) =>
      promptIdea(`p${n}`, { topic_id: 'topic-1' }),
    );
    db.tables.prompts = [{ brand_id: 'b1', topic_id: 'topic-1', is_active: false }];
    db.tables.competitors = [
      { id: 'k1', brand_id: 'b1', name: 'Northbound Roasters' },
      { id: 'k2', brand_id: 'b1', name: 'Kettle & Crate' },
    ];
    const components = (mentions: number) => ({
      competitor_id: '',
      mention_answers: mentions,
      citation_answers: 0,
      sum_inv_position: 0,
      position_count: 0,
    });
    db.rpc = {
      complete: true,
      topics: [
        {
          topic_id: 'topic-1',
          name: 'Decaf',
          prompts: 3,
          answers: 30,
          competitors: [
            { ...components(4), competitor_id: 'k2' },
            { ...components(9), competitor_id: 'k1' },
            { ...components(0), competitor_id: 'k3' },
          ],
        },
      ],
    };
    const topic = await getTodayTopic('b1');
    expect(topic?.candidate).toMatchObject({
      source: 'search',
      topicId: 'topic-1',
      competitors: ['Northbound Roasters', 'Kettle & Crate'],
    });
  });
});

describe('openTopicCard', () => {
  it('makes the topic from its idea, and lists its stored ideas, the most demand first', async () => {
    db.tables.prompt_suggestions = [
      promptIdea('p1', { topic_name: 'cold brew', est_volume: 10 }),
      promptIdea('p2', { topic_id: 'topic-new', topic_name: 'Cold Brew', est_volume: 90 }),
      promptIdea('p3', {
        topic_name: 'Cold brew',
        source: 'business_hub',
        expires_at: '2026-11-01',
      }),
      promptIdea('p4', { topic_name: 'Decaf' }),
    ];
    const opened = await openTopicCard('b1', { name: 'Cold brew', suggestionId: 't1' });
    expect(fns.acceptTopicSuggestion).toHaveBeenCalledWith('t1');
    expect(fns.createTopic).not.toHaveBeenCalled();
    expect(opened).toEqual({
      ok: true,
      topic: { id: 'topic-new', name: 'Cold brew' },
      ideas: [
        { id: 'p2', text: 'decaf idea p2' },
        { id: 'p1', text: 'decaf idea p1' },
      ],
    });
  });

  it("uses the brand's own topic of that name, and makes a plain one for a cluster", async () => {
    db.tables.topics = [{ id: 'topic-1', brand_id: 'b1', name: 'Decaf', is_active: true }];
    expect(await openTopicCard('b1', { name: 'decaf', suggestionId: null })).toMatchObject({
      ok: true,
      topic: { id: 'topic-1', name: 'Decaf' },
    });
    expect(await openTopicCard('b1', { name: 'Office coffee' })).toMatchObject({
      ok: true,
      topic: { id: 'topic-plain', name: 'Office coffee' },
      ideas: [],
    });
    expect(fns.createTopic).toHaveBeenCalledWith('b1', 'Office coffee');
    expect(fns.acceptTopicSuggestion).not.toHaveBeenCalled();
  });

  it('refuses anyone but an admin or a manager', async () => {
    db.tables.profiles = [{ id: 'u1', role: 'analyst' }];
    expect(await openTopicCard('b1', { name: 'Cold brew' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(fns.createTopic).not.toHaveBeenCalled();
  });
});

describe('writeTopicPrompts', () => {
  it('asks the per-topic generator once, leaving out prompts the brand has', async () => {
    db.tables.topics = [{ id: 'topic-1', brand_id: 'b1', name: 'Decaf', is_active: true }];
    db.tables.prompts = [{ brand_id: 'b1', text: 'Best decaf beans' }];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        topicPrompts: [{ topic: 'Decaf', prompts: ['best  decaf beans', 'is decaf coffee safe'] }],
      }),
    });
    expect(await writeTopicPrompts('b1', 'topic-1')).toEqual({
      ok: true,
      prompts: ['is decaf coffee safe'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/prompts\/from-topics$/);
    expect(JSON.parse(init.body)).toMatchObject({
      brandName: 'Brewline Coffee',
      industry: 'Coffee',
      topics: ['Decaf'],
      language: 'en',
    });
  });

  it('says so when the generator fails', async () => {
    db.tables.topics = [{ id: 'topic-1', brand_id: 'b1', name: 'Decaf', is_active: true }];
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await writeTopicPrompts('b1', 'topic-1')).toEqual({ ok: false, error: 'failed' });
  });
});

describe('trackTopicPrompts', () => {
  it('adds the ticked prompts to the topic, and marks the stored ideas added', async () => {
    fns.addTopicPrompts.mockResolvedValue({
      ok: true,
      code: 'ok',
      added: [{ id: 'q1', text: 'decaf idea p1' }],
      waiting: [{ id: 'q2', text: 'is decaf coffee safe' }],
      skipped: [],
      analysisStarted: true,
    });
    const result = await trackTopicPrompts('b1', 'topic-1', [
      { ideaId: 'p1', text: 'decaf idea p1' },
      { ideaId: null, text: 'is decaf coffee safe' },
    ]);
    expect(result).toEqual({ ok: true, added: 1, waiting: 1 });
    expect(fns.addTopicPrompts).toHaveBeenCalledWith('b1', 'topic-1', [
      'decaf idea p1',
      'is decaf coffee safe',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/prompts\/suggestions\/p1\/accept$/);
    expect(JSON.parse(init.body)).toEqual({ promptId: 'q1' });
  });

  it("passes add_prompts' refusal on", async () => {
    fns.addTopicPrompts.mockResolvedValue({
      ok: false,
      reason: 'duplicate',
      message: 'The brand already tracks these prompts.',
    });
    expect(await trackTopicPrompts('b1', 'topic-1', [{ text: 'x' }])).toEqual({
      ok: false,
      error: 'The brand already tracks these prompts.',
    });
  });
});
