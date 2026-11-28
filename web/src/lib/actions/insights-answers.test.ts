// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The answers behind an Insights card: window, filters, paging and scoping. */

let tables: Record<string, { data: unknown; error: { message: string } | null; count?: number }>;
let queries: { table: string; calls: unknown[][] }[];

function fakeQuery(table: string) {
  const query = { table, calls: [] as unknown[][] };
  queries.push(query);
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'order', 'range']) {
    builder[method] = (...args: unknown[]) => {
      query.calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => tables[table];
  builder.then = (resolve: (v: unknown) => unknown) => resolve(tables[table]);
  return builder;
}

vi.mock('@/lib/supabase/scoped', () => ({
  dbClient: async () => ({ from: (table: string) => fakeQuery(table) }),
}));

const { getInsightsAnswers } = await import('./insights-answers');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  prompt_id: 'p1',
  platform: 'chatgpt',
  model_used: 'gpt-5',
  region: 'US',
  created_at: '2026-11-20T10:00:00.000Z',
  response: 'For coffee, Acme Coffee is a solid pick with fair prices.',
  citations: [{ url: 'https://acme.example/a' }, { url: 'https://other.example' }],
  mention_count: 2,
  mention_position: 1,
  citation_count: 1,
  prompts: { text: 'best coffee brand' },
  ...over,
});

const calls = (table: string) => queries.find((q) => q.table === table)?.calls ?? [];
const call = (table: string, method: string) =>
  calls(table)
    .filter((c) => c[0] === method)
    .map((c) => c.slice(1));

beforeEach(() => {
  queries = [];
  tables = {
    brands: {
      data: { id: 'b1', name: 'Acme Coffee', brand_domains: [{ domain: 'acme.example' }] },
      error: null,
    },
    prompt_results: { data: [row()], error: null, count: 61 },
  };
});

describe('getInsightsAnswers', () => {
  it("reads the card's whole-day window and filters, newest first", async () => {
    const page = await getInsightsAnswers(
      'b1',
      'visibility',
      {
        model: 'gpt-5, gpt-5-mini',
        region: 'US',
        days: { dayFrom: '2026-11-01', dayTo: '2026-11-28' },
      },
      1,
    );
    expect(call('prompt_results', 'eq')).toEqual([
      ['brand_id', 'b1'],
      ['region', 'US'],
    ]);
    expect(call('prompt_results', 'neq')).toEqual([['platform', 'chatgpt-shopping']]);
    expect(call('prompt_results', 'in')).toEqual([['model_used', ['gpt-5', 'gpt-5-mini']]]);
    // Whole UTC days: from the first midnight to before the one after the last day.
    expect(call('prompt_results', 'gte')).toEqual([['created_at', '2026-11-01T00:00:00.000Z']]);
    expect(call('prompt_results', 'lt')).toEqual([['created_at', '2026-11-29T00:00:00.000Z']]);
    expect(call('prompt_results', 'gt')).toEqual([]);
    expect(call('prompt_results', 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(call('prompt_results', 'select')[0][1]).toEqual({ count: 'exact' });
    expect(page.total).toBe(61);
    expect(page.answers[0]).toMatchObject({
      id: 'r1',
      promptText: 'best coffee brand',
      status: 'mentioned',
      position: 1,
      sources: 2,
      ownSources: 1,
    });
    expect(page.answers[0].excerpt).toContain('Acme Coffee');
  });

  it('reads a date range inclusive and a topic through the prompt', async () => {
    await getInsightsAnswers('b1', 'visibility', {
      dateFrom: '2026-11-27T09:00:00.000Z',
      dateTo: '2026-11-28T09:00:00.000Z',
      topicId: 't1',
    });
    expect(call('prompt_results', 'gte')).toEqual([['created_at', '2026-11-27T09:00:00.000Z']]);
    expect(call('prompt_results', 'lte')).toEqual([['created_at', '2026-11-28T09:00:00.000Z']]);
    expect(call('prompt_results', 'eq')).toContainEqual(['prompts.topic_id', 't1']);
    expect(String(call('prompt_results', 'select')[0][0])).toContain(
      'prompts!inner(text, topic_id)',
    );
  });

  it('reads one model with eq and All time with no bounds', async () => {
    await getInsightsAnswers('b1', 'visibility', { model: 'gpt-5', days: {} });
    expect(call('prompt_results', 'eq')).toContainEqual(['model_used', 'gpt-5']);
    expect(call('prompt_results', 'gte')).toEqual([]);
    expect(call('prompt_results', 'lt')).toEqual([]);
  });

  it('lists only the answers naming the brand for Mentions', async () => {
    await getInsightsAnswers('b1', 'mentions', {
      days: { dayFrom: '2026-11-01', dayTo: '2026-11-28' },
    });
    expect(call('prompt_results', 'gt')).toEqual([['mention_count', 0]]);
  });

  it('pages 25 at a time from page 1', async () => {
    const third = await getInsightsAnswers('b1', 'visibility', undefined, 3);
    expect(call('prompt_results', 'range')).toEqual([[50, 74]]);
    expect(third).toMatchObject({ page: 3, pageSize: 25 });
    queries = [];
    const bad = await getInsightsAnswers('b1', 'visibility', undefined, 0);
    expect(call('prompt_results', 'range')).toEqual([[0, 24]]);
    expect(bad.page).toBe(1);
  });

  it("reads nothing for a brand outside the caller's organization", async () => {
    tables.brands = { data: null, error: null };
    const page = await getInsightsAnswers('other-org-brand', 'visibility');
    expect(page).toEqual({ answers: [], total: 0, page: 1, pageSize: 25 });
    expect(queries.map((q) => q.table)).toEqual(['brands']);
  });

  it('never calls an answer without text "not mentioned"', async () => {
    tables.prompt_results = {
      data: [
        row({ id: 'empty', response: '', mention_count: 0, mention_position: null }),
        row({ id: 'miss', response: 'Try Other Beans.', mention_count: 0, mention_position: null }),
      ],
      error: null,
      count: 2,
    };
    const { answers } = await getInsightsAnswers('b1', 'visibility');
    expect(answers.map((a) => [a.id, a.status, a.excerpt])).toEqual([
      ['empty', 'noAnswer', ''],
      ['miss', 'notMentioned', 'Try Other Beans.'],
    ]);
  });

  it('throws when the read fails', async () => {
    tables.prompt_results = { data: null, error: { message: 'timeout' } };
    await expect(getInsightsAnswers('b1', 'visibility')).rejects.toThrow('timeout');
  });
});
