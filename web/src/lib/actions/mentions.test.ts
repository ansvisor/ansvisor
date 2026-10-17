import { beforeEach, describe, expect, it, vi } from 'vitest';

let result: { data: unknown; error: { code?: string; message: string } | null };
const rpc = vi.fn(async () => result);
// A table read: every filter call is recorded, and the read ends in maybeSingle.
let tableResult: { data: unknown; error: { message: string } | null };
const tableCalls: unknown[][] = [];
const query = {
  select: (...args: unknown[]) => (tableCalls.push(['select', ...args]), query),
  eq: (...args: unknown[]) => (tableCalls.push(['eq', ...args]), query),
  maybeSingle: async () => tableResult,
};
const from = vi.fn((table: string) => (tableCalls.push(['from', table]), query));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ rpc, from })),
}));

import { getMentionResponse, getMentionsOverview, listMentions } from './mentions';
import { DEFAULT_MENTIONS_TABLE } from '@/lib/mentions-list';

beforeEach(() => {
  rpc.mockClear();
  from.mockClear();
  tableCalls.length = 0;
  result = { data: null, error: null };
  tableResult = { data: null, error: null };
});

describe('getMentionsOverview', () => {
  it('reads the window and filters in one call', async () => {
    result = {
      data: {
        window: { from: 'f', to: 't', days: 7, source: 'days' },
        current: { answers: 8, mentions: 6 },
        previous: null,
        platforms: [],
        daily: [],
        competitors: [],
      },
      error: null,
    };
    const overview = await getMentionsOverview('b1', {
      from: '2026-10-10T00:00:00.000Z',
      platform: 'gemini-web',
      topicId: 't1',
      search: 'pricing',
    });
    expect(rpc).toHaveBeenCalledWith('mentions_overview', {
      p_brand_id: 'b1',
      p_date_from: '2026-10-10T00:00:00.000Z',
      p_date_to: undefined,
      p_platform: 'gemini-web',
      p_region: undefined,
      p_topic_id: 't1',
      p_search: 'pricing',
    });
    expect(overview?.current).toMatchObject({ answers: 8, mentions: 6 });
  });

  it('is null before the migration has run', async () => {
    result = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await expect(getMentionsOverview('b1', { from: 'f' })).resolves.toBeNull();
  });

  it('is null for a caller outside the organization', async () => {
    await expect(getMentionsOverview('b1', { from: 'f' })).resolves.toBeNull();
  });

  it('throws on any other error', async () => {
    result = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(getMentionsOverview('b1', { from: 'f' })).rejects.toThrow('statement timeout');
  });
});

describe('listMentions', () => {
  it('reads a page with the table controls and cuts each answer to its excerpt', async () => {
    result = {
      data: {
        total: 214,
        prompts: 12,
        rows: [
          {
            id: 'r1',
            created_at: '2026-10-16T11:28:06Z',
            prompt_id: 'p1',
            prompt_text: 'Best espresso beans?',
            topic_id: 't1',
            topic_name: 'Beans',
            platform: 'gemini-web',
            model_used: 'gemini-2.5-flash',
            region: 'DE',
            sentiment: 'negative',
            mention_count: 2,
            mention_position: 2,
            mentioned_entity_count: 4,
            co_mentioned: [{ competitor_id: 'c1', name: 'Crema Club', mention_position: 1 }],
            response: 'Try **Crema Club** first. Acme Coffee is pricier.',
            group_key: null,
            group_count: null,
          },
        ],
      },
      error: null,
    };
    tableResult = {
      data: { name: 'Acme Coffee', brand_domains: [{ domain: 'acme.com' }] },
      error: null,
    };
    const list = await listMentions(
      'b1',
      { from: '2026-10-10T00:00:00.000Z', platform: 'gemini-web' },
      { ...DEFAULT_MENTIONS_TABLE, sentiment: 'negative', competitor: 'c1', sort: 'co_mentions' },
      2,
    );
    expect(rpc).toHaveBeenCalledWith('mentions_list', {
      p_brand_id: 'b1',
      p_date_from: '2026-10-10T00:00:00.000Z',
      p_date_to: undefined,
      p_platform: 'gemini-web',
      p_region: undefined,
      p_topic_id: undefined,
      p_search: undefined,
      p_sentiment: 'negative',
      p_competitor_id: 'c1',
      p_sort: 'co_mentions',
      p_group: undefined,
      p_limit: 100,
      p_offset: 200,
    });
    expect(tableCalls).toContainEqual(['eq', 'id', 'b1']);
    expect(list).toMatchObject({
      total: 214,
      prompts: 12,
      brandTerms: ['Acme Coffee', 'acme.com'],
    });
    expect(list?.rows[0]).toEqual({
      id: 'r1',
      createdAt: '2026-10-16T11:28:06Z',
      promptId: 'p1',
      promptText: 'Best espresso beans?',
      topicId: 't1',
      topicName: 'Beans',
      platform: 'gemini-web',
      model: 'gemini-2.5-flash',
      region: 'DE',
      sentiment: 'negative',
      occurrences: 2,
      position: 2,
      brandsNamed: 4,
      coMentioned: [{ competitorId: 'c1', name: 'Crema Club', position: 1 }],
      excerpt: 'Try Crema Club first. Acme Coffee is pricier.',
      groupKey: null,
      groupCount: null,
    });
    expect(list?.rows[0]).not.toHaveProperty('response');
  });

  it('is null before the migration has run, and throws on other errors', async () => {
    result = { data: null, error: { code: 'PGRST202', message: 'not found' } };
    await expect(listMentions('b1', { from: 'f' }, DEFAULT_MENTIONS_TABLE, 0)).resolves.toBeNull();
    result = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(listMentions('b1', { from: 'f' }, DEFAULT_MENTIONS_TABLE, 0)).rejects.toThrow(
      'statement timeout',
    );
  });
});

describe('getMentionResponse', () => {
  it("reads the answer's text and citations within the brand", async () => {
    tableResult = {
      data: { response: 'Hello', citations: [{ url: 'https://a.com', title: 'A' }] },
      error: null,
    };
    await expect(getMentionResponse('b1', 'r1')).resolves.toEqual({
      response: 'Hello',
      citations: [{ url: 'https://a.com', title: 'A' }],
    });
    expect(tableCalls).toEqual([
      ['from', 'prompt_results'],
      ['select', 'response, citations'],
      ['eq', 'id', 'r1'],
      ['eq', 'brand_id', 'b1'],
    ]);
  });

  it("is null when the answer isn't readable", async () => {
    await expect(getMentionResponse('b1', 'r1')).resolves.toBeNull();
  });
});
