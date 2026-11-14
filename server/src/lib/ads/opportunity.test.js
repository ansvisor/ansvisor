import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One opportunity's drawer (ADS-01 §3.2): the latest answer per platform
 * over the period, its fan-outs and keyword seeds, read only within the
 * brand and its organization, and not past Starter's rows. A fake database
 * that applies each read's filters, so another brand's row shows only if a
 * read forgets one.
 */

let db;
const reads = [];
const at = (row, path) => path.split('.').reduce((v, k) => v?.[k], row);
function from(table) {
  let rows = db[table] ?? [];
  let one = false;
  reads.push(table);
  const q = {
    select: () => q,
    eq: (col, v) => ((rows = rows.filter((r) => at(r, col) === v)), q),
    neq: (col, v) => ((rows = rows.filter((r) => at(r, col) !== v)), q),
    gte: (col, v) => ((rows = rows.filter((r) => at(r, col) >= v)), q),
    in: (col, vs) => ((rows = rows.filter((r) => vs.includes(at(r, col)))), q),
    order: (col, { ascending }) => (
      (rows = [...rows].sort((a, b) => (ascending ? 1 : -1) * a[col].localeCompare(b[col]))),
      q
    ),
    limit: (n) => ((rows = rows.slice(0, n)), q),
    maybeSingle: () => ((one = true), q),
    then: (resolve, reject) =>
      Promise.resolve({ data: one ? (rows[0] ?? null) : rows, error: null }).then(resolve, reject),
  };
  return q;
}
vi.mock('../../config/supabase.js', () => ({ default: { from: (table) => from(table) } }));
const plan = { readsEveryOpportunity: vi.fn(), readOpportunities: vi.fn() };
vi.mock('./opportunities.js', () => ({
  readsEveryOpportunity: (...a) => plan.readsEveryOpportunity(...a),
  readOpportunities: (...a) => plan.readOpportunities(...a),
}));

const { answerExcerpt, readOpportunity } = await import('./opportunity.js');

const NOW = new Date('2026-11-14T12:00:00Z');
const BRAND = { id: 'b1' };
const ours = { brand_id: 'b1', brands: { organization_id: 'o1' } };
const answer = (id, platform, created_at, over = {}) => ({
  id,
  prompt_id: 'p1',
  brand_id: 'b1',
  brands: { organization_id: 'o1' },
  platform,
  region: 'US',
  created_at,
  response: `Answer ${id}`,
  citations: [],
  competitor_mentions: [],
  mention_position: null,
  search_queries: [],
  ...over,
});

beforeEach(() => {
  reads.length = 0;
  plan.readsEveryOpportunity.mockReset().mockResolvedValue(true);
  plan.readOpportunities.mockReset();
  db = {
    prompts: [
      { id: 'p1', prompt_sets: ours },
      { id: 'p2', prompt_sets: ours },
      { id: 'p6', prompt_sets: { brand_id: 'b2', brands: { organization_id: 'o2' } } },
      // A brand id of ours under another organization: never ours.
      { id: 'p7', prompt_sets: { brand_id: 'b1', brands: { organization_id: 'o2' } } },
    ],
    prompt_volumes: [
      { prompt_id: 'p1', keywords: ['old seed'], fetched_at: '2026-10-01' },
      { prompt_id: 'p1', keywords: ['best crm', 'crm for teams', 3], fetched_at: '2026-11-10' },
    ],
    prompt_results: [
      answer('r1', 'chatgpt-web', '2026-11-10T08:00:00Z', { response: 'Older ChatGPT answer' }),
      answer('r2', 'chatgpt-web', '2026-11-12T08:00:00Z', {
        response: '## Picks\n- **Kestrel** leads. See [their site](https://kestrel.example/x).',
        mention_position: 2,
        competitor_mentions: [
          { name: 'Harbor', mention_count: 1, mention_position: 3 },
          { name: 'Kestrel', mention_count: 2, mention_position: 1 },
          { name: 'Absent', mention_count: 0, mention_position: null },
        ],
        citations: [
          { url: 'https://www.g2.com/a' },
          { url: 'https://kestrel.example/x' },
          { url: 'https://g2.com/b' },
        ],
      }),
      answer('r3', 'google-aio', '2026-11-11T08:00:00Z', {
        region: null,
        search_queries: [{ query: 'Best CRM 2026' }, { query: 'crm pricing' }],
      }),
      answer('r4', 'perplexity-web', '2026-11-13T08:00:00Z', {
        search_queries: [{ query: 'best crm 2026' }, { query: '' }, { query: 'crm reviews' }],
      }),
      // Not answers the drawer quotes: shopping, empty, before the period, another brand's.
      answer('r5', 'chatgpt-shopping', '2026-11-13T09:00:00Z'),
      answer('r6', 'google-aio', '2026-11-13T09:00:00Z', { response: '' }),
      answer('r7', 'gemini-web', '2026-09-01T08:00:00Z'),
      answer('r8', 'grok-web', '2026-11-13T08:00:00Z', {
        brand_id: 'b2',
        brands: { organization_id: 'o2' },
      }),
    ],
  };
});

const read = (promptId, over = {}) =>
  readOpportunity({ brand: BRAND, orgId: 'o1', promptId, period: '30d', now: NOW, ...over });

describe('readOpportunity', () => {
  it('gives the latest answer per platform in the period, newest first, with who it names and cites', async () => {
    const got = await read('p1');
    expect(got.answers.map((a) => [a.platform, a.at])).toEqual([
      ['perplexity-web', '2026-11-13T08:00:00Z'],
      ['chatgpt-web', '2026-11-12T08:00:00Z'],
      ['google-aio', '2026-11-11T08:00:00Z'],
    ]);
    expect(got.answers[1]).toEqual({
      platform: 'chatgpt-web',
      region: 'US',
      at: '2026-11-12T08:00:00Z',
      excerpt: 'Picks Kestrel leads. See their site.',
      mentionPosition: 2,
      competitors: [
        { name: 'Kestrel', position: 1 },
        { name: 'Harbor', position: 3 },
      ],
      domains: ['g2.com', 'kestrel.example'],
    });
    expect(got.answers[2].region).toBeNull();
    // Each fan-out once, the newest answer's first; the newest seeds.
    expect(got.fanOuts).toEqual([
      { query: 'best crm 2026', platform: 'perplexity-web' },
      { query: 'crm reviews', platform: 'perplexity-web' },
      { query: 'crm pricing', platform: 'google-aio' },
    ]);
    expect(got.keywords).toEqual(['best crm', 'crm for teams']);
    expect(got).toMatchObject({ promptId: 'p1', period: '30d' });
    // Over 7 days from the 19th, only the answers of that week.
    const week = await read('p1', { period: '7d', now: new Date('2026-11-19T12:00:00Z') });
    expect(week.answers.map((a) => a.platform)).toEqual(['perplexity-web']);
    expect((await read('p1', { now: new Date('2026-12-30T00:00:00Z') })).answers).toEqual([]);
  });

  it("reads another brand's or organization's prompt as not found, before any answer", async () => {
    for (const promptId of ['p6', 'p7', 'nope']) {
      await expect(read(promptId), promptId).rejects.toMatchObject({ status: 404 });
    }
    await expect(read('p1', { orgId: 'o2' })).rejects.toMatchObject({ status: 404 });
    expect(reads.filter((t) => t !== 'prompts')).toEqual([]);
  });

  it("opens only Starter's and the trial's rows: a locked prompt isn't read", async () => {
    plan.readsEveryOpportunity.mockResolvedValue(false);
    plan.readOpportunities.mockResolvedValue({ rows: [{ promptId: 'p1' }], locked: 4 });
    expect(await read('p2')).toBeNull();
    expect(reads).toEqual(['prompts']);
    expect(plan.readOpportunities).toHaveBeenCalledWith({
      brand: BRAND,
      orgId: 'o1',
      period: '30d',
      now: NOW,
    });
    expect((await read('p1')).answers).toHaveLength(3);
  });
});

describe('answerExcerpt', () => {
  it('keeps the answer as plain text, markup and all, cut on a word', () => {
    expect(answerExcerpt('Hi <script>alert(1)</script> & <b>bold</b>')).toBe(
      'Hi <script>alert(1)</script> & <b>bold</b>',
    );
    expect(answerExcerpt('> **Quote** and `code`\n\n* item https://x.example/y')).toBe(
      'Quote and code item',
    );
    expect(answerExcerpt('one two three four', 12)).toBe('one two…');
    expect(answerExcerpt(null)).toBe('');
  });
});
