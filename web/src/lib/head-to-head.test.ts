import { describe, expect, it, vi } from 'vitest';
import { fetchHeadToHeadResults, type HeadToHeadResultRow } from './head-to-head';

function makeRow(id: number) {
  return {
    id: String(id),
    prompt_id: `prompt-${id}`,
    visibility_score: id,
    model_used: 'gpt-test',
    platform: 'chatgpt-web',
    competitor_mentions: [],
    region: null,
    response: null,
    citations: [],
    sentiment: 'neutral',
    mention_count: 0,
    citation_count: 0,
    created_at: new Date(1_000_000 + id).toISOString(),
  };
}

function makeClient(pages: HeadToHeadResultRow[][], error?: { message: string }) {
  let pageIndex = 0;
  const ranges: Array<[number, number]> = [];
  const selects: string[] = [];

  const query = {
    select: vi.fn((columns: string) => {
      selects.push(columns);
      return query;
    }),
    eq: vi.fn(() => query),
    neq: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async (from: number, to: number) => {
      ranges.push([from, to]);
      const data = pages[pageIndex++] ?? [];
      return { data, error: pageIndex === 1 && error ? error : null };
    }),
  };

  return {
    client: { from: vi.fn(() => query) },
    ranges,
    selects,
  };
}

describe('fetchHeadToHeadResults', () => {
  it('fetches beyond the 1,000-row PostgREST limit', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => makeRow(i));
    const { client, ranges, selects } = makeClient([rows.slice(0, 1000), rows.slice(1000)]);

    const result = await fetchHeadToHeadResults(client as never, 'brand-1');

    expect(result).toHaveLength(1001);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(selects).toEqual([
      'id,prompt_id,visibility_score,model_used,platform,competitor_mentions,region,response,citations,sentiment,mention_count,citation_count,created_at',
      'id,prompt_id,visibility_score,model_used,platform,competitor_mentions,region,response,citations,sentiment,mention_count,citation_count,created_at',
    ]);
  });

  it('stops after a short page', async () => {
    const rows = Array.from({ length: 17 }, (_, i) => makeRow(i));
    const { client, ranges } = makeClient([rows]);

    const result = await fetchHeadToHeadResults(client as never, 'brand-1');

    expect(result).toHaveLength(17);
    expect(ranges).toEqual([[0, 999]]);
  });

  it('surfaces database errors', async () => {
    const { client } = makeClient([[]], { message: 'database unavailable' });

    await expect(fetchHeadToHeadResults(client as never, 'brand-1')).rejects.toThrow(
      'database unavailable',
    );
  });
});
