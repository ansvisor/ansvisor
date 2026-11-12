import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Visibility's ChatGPT Business Hub card, as the server action reads it:
 * hidden while BUSINESS_HUB_ENABLED is off, while ChatGPT isn't tracked, or
 * before any entry or Claim; Ansvisor's ChatGPT numbers over each entry's
 * days, ChatGPT's hosts only counting as visits. Saves and deletes go to the
 * API, errors returned.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const ENTRY = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';

interface Db {
  tracked: number;
  snapshots: Record<string, unknown>[];
  actions: { id: string }[];
  claimed: number;
  topics: { name: string }[];
  rpc: { name: string; args: Record<string, unknown> }[];
  aiVis: Record<string, unknown>;
  traffic: { data: unknown; error: { message: string } | null };
}
let db: Db;
const tables: string[] = [];

/** Enough of Supabase's client for the card's reads: each table answers its fixture. */
function client() {
  const from = (table: string) => {
    tables.push(table);
    const builder: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'gte', 'in', 'order', 'limit']) {
      builder[op] = () => builder;
    }
    builder.then = (resolve: (v: unknown) => void) => {
      if (table === 'prompt_results') return resolve({ count: db.tracked, error: null });
      if (table === 'business_hub_snapshots') return resolve({ data: db.snapshots, error: null });
      if (table === 'actions') return resolve({ data: db.actions, error: null });
      if (table === 'action_tasks') return resolve({ count: db.claimed, error: null });
      if (table === 'topics') return resolve({ data: db.topics, error: null });
      return resolve({ data: null, error: null });
    };
    return builder;
  };
  return {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.rpc.push({ name, args });
      if (name === 'ai_visibility_aggregates') return { data: db.aiVis, error: null };
      return db.traffic;
    },
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  };
}

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => client()) }));

const {
  deleteBusinessHubSnapshot,
  getBusinessHubCard,
  importBusinessHubSnapshots,
  saveBusinessHubSnapshot,
} = await import('./business-hub');

const row = (over: Record<string, unknown>) => ({
  id: 's1',
  period_days: 7,
  period_end: '2026-11-10',
  mentions: 53,
  website_clicks: 19,
  profile_views: null,
  discovery_topics: ['Coffee subscriptions'],
  source: 'manual',
  updated_at: '2026-11-11T09:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.stubEnv('BUSINESS_HUB_ENABLED', 'true');
  tables.length = 0;
  db = {
    tracked: 120,
    snapshots: [],
    actions: [],
    claimed: 0,
    topics: [{ name: 'Coffee subscriptions' }],
    rpc: [],
    aiVis: { answers: 120, mention_answers: 34, citation_answers: 9, position_factor: 0.5 },
    traffic: {
      data: {
        platforms: [
          { platform: 'chatgpt.com', visits: 40 },
          { platform: 'chat.openai.com', visits: 2 },
          { platform: 'perplexity.ai', visits: 30 },
        ],
      },
      error: null,
    },
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getBusinessHubCard', () => {
  it('reads nothing while BUSINESS_HUB_ENABLED is off', async () => {
    vi.stubEnv('BUSINESS_HUB_ENABLED', '');
    db.snapshots = [row({})];
    expect((await getBusinessHubCard(BRAND)).show).toBe(false);
    expect(tables).toEqual([]);
  });

  it('is hidden while ChatGPT isn’t tracked, whatever was entered', async () => {
    db.tracked = 0;
    db.snapshots = [row({})];
    expect((await getBusinessHubCard(BRAND, { asked: true })).show).toBe(false);
  });

  it('is hidden before any entry or Claim, and shown when the page asks or Claim is done', async () => {
    expect((await getBusinessHubCard(BRAND)).show).toBe(false);
    expect(await getBusinessHubCard(BRAND, { asked: true })).toMatchObject({
      show: true,
      latest: null,
      ours: null,
    });
    db.actions = [{ id: 'a1' }];
    db.claimed = 1;
    expect((await getBusinessHubCard(BRAND)).show).toBe(true);
  });

  it('reads Ansvisor’s ChatGPT numbers over the latest entry’s days, and the one before’s', async () => {
    db.snapshots = [
      row({ id: 's3', period_end: '2026-11-10' }),
      row({ id: 's2', period_days: 28, period_end: '2026-11-09', mentions: 160 }),
      row({ id: 's1', period_end: '2026-11-03', mentions: 44 }),
    ];
    const card = await getBusinessHubCard(BRAND);
    expect(card.latest).toMatchObject({
      id: 's3',
      periodDays: 7,
      periodEnd: '2026-11-10',
      mentions: 53,
      websiteClicks: 19,
      profileViews: null,
      topics: ['Coffee subscriptions'],
      source: 'manual',
    });
    expect(card.previous?.id).toBe('s1');
    expect(card.ours).toEqual({
      visibility: expect.any(Number),
      answers: 120,
      named: 34,
      cited: 9,
      // chatgpt.com and chat.openai.com; not Perplexity.
      visits: 42,
    });
    expect(card.oursPrevious).not.toBeNull();
    expect(card.trackedTopics).toEqual(['Coffee subscriptions']);
    const vis = db.rpc.filter((c) => c.name === 'ai_visibility_aggregates');
    expect(vis.map((c) => c.args)).toEqual([
      {
        p_brand_id: BRAND,
        p_platform: 'chatgpt-web',
        p_date_from: '2026-11-04T00:00:00.000Z',
        p_date_to: '2026-11-10T23:59:59.999Z',
      },
      {
        p_brand_id: BRAND,
        p_platform: 'chatgpt-web',
        p_date_from: '2026-10-28T00:00:00.000Z',
        p_date_to: '2026-11-03T23:59:59.999Z',
      },
    ]);
    expect(db.rpc.find((c) => c.name === 'ai_traffic_merged')?.args).toMatchObject({
      p_from: '2026-11-04T00:00:00.000Z',
      p_to: '2026-11-10T23:59:59.999Z',
      p_analytics: true,
    });
  });

  it('leaves visits empty, not the card, when they can’t be read', async () => {
    db.snapshots = [row({})];
    db.traffic = { data: null, error: { message: 'timeout' } };
    const card = await getBusinessHubCard(BRAND);
    expect(card.show).toBe(true);
    expect(card.ours?.visits).toBeNull();
    expect(card.previous).toBeNull();
    expect(card.oursPrevious).toBeNull();
  });
});

describe('saving and deleting', () => {
  let response: Response;
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
    async () => response,
  );
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  const input = {
    periodDays: 7 as const,
    periodEnd: '2026-11-10',
    mentions: 53,
    websiteClicks: null,
    profileViews: null,
    topics: [],
  };

  it('saves an entry through the API, and says whether it replaced one', async () => {
    response = new Response(JSON.stringify({ snapshot: {}, replaced: true }), { status: 200 });
    expect(await saveBusinessHubSnapshot(BRAND, input)).toEqual({ saved: true, replaced: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      expect.stringMatching(new RegExp(`/api/business-hub/${BRAND}/snapshots$`)),
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(input) }),
    ]);
  });

  it('returns why the API refused it', async () => {
    response = new Response(
      JSON.stringify({ code: 'invalid', field: 'periodEnd', reason: 'future' }),
      { status: 400 },
    );
    expect(await saveBusinessHubSnapshot(BRAND, input)).toEqual({
      error: 'invalid',
      field: 'periodEnd',
      reason: 'future',
      row: undefined,
    });
    response = new Response(JSON.stringify({ code: 'off' }), { status: 404 });
    expect(await saveBusinessHubSnapshot(BRAND, input)).toEqual({ error: 'off' });
    response = new Response(JSON.stringify({ code: 'demo_brand' }), { status: 402 });
    expect(await saveBusinessHubSnapshot(BRAND, input)).toEqual({ error: 'demo' });
  });

  it('imports entries from the CSV template through the API, all or none', async () => {
    response = new Response(JSON.stringify({ saved: 2, replaced: 1 }), { status: 200 });
    const rows = [input, { ...input, periodEnd: '2026-11-03' }];
    expect(await importBusinessHubSnapshots(BRAND, rows)).toEqual({ saved: 2, replaced: 1 });
    expect(fetchMock.mock.calls[0]).toEqual([
      expect.stringMatching(new RegExp(`/api/business-hub/${BRAND}/snapshots/import$`)),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ rows }) }),
    ]);
    response = new Response(
      JSON.stringify({ code: 'invalid', field: 'periodEnd', reason: 'duplicate', row: 1 }),
      { status: 400 },
    );
    expect(await importBusinessHubSnapshots(BRAND, rows)).toMatchObject({
      error: 'invalid',
      row: 1,
    });
    expect(await importBusinessHubSnapshots(BRAND, [])).toEqual({ error: 'invalid' });
  });

  it('deletes an entry, or says an analyst may not', async () => {
    response = new Response(JSON.stringify({ deleted: true }), { status: 200 });
    expect(await deleteBusinessHubSnapshot(ENTRY)).toEqual({ deleted: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      expect.stringMatching(new RegExp(`/api/business-hub/snapshots/${ENTRY}$`)),
      expect.objectContaining({ method: 'DELETE' }),
    ]);
    response = new Response(JSON.stringify({ code: 'forbidden' }), { status: 403 });
    expect(await deleteBusinessHubSnapshot(ENTRY)).toEqual({ error: 'forbidden' });
    expect(await deleteBusinessHubSnapshot('nope')).toEqual({ error: 'invalid' });
  });
});
