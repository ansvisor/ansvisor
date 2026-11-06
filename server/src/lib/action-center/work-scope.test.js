import { describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time.
vi.mock('../../config/supabase.js', () => ({ default: { from: () => null } }));

const { MAX_SCOPE_PAGES, MAX_SCOPE_PROMPTS, distinctPages, scopeOf, withWorkScope } =
  await import('./work-scope.js');

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';

/**
 * A database whose tables answer from `rows`, recording each read as
 * [table, ...filters]. Thenable, as the PostgREST builder is.
 */
function fakeDb(rows, calls = []) {
  return {
    from(table) {
      const call = [table];
      calls.push(call);
      const result = () =>
        typeof rows[table] === 'function' ? rows[table](call) : { data: rows[table] ?? [] };
      const b = {
        select: () => b,
        eq: (...args) => (call.push(['eq', ...args]), b),
        in: (...args) => (call.push(['in', ...args]), b),
        order: () => b,
        limit: () => b,
        maybeSingle: () => Promise.resolve({ ...result(), error: null }),
        then: (resolve) => resolve({ error: null, ...result() }),
      };
      return b;
    },
  };
}

describe('scopeOf', () => {
  it('reads prompt targets as prompt ids, every one counted', () => {
    expect(
      scopeOf({
        targetEntity: 'prompts',
        targets: [{ id: P1, label: 'a' }],
        targetIds: [P1, P2, 'not-a-prompt'],
      }),
    ).toEqual({ promptIds: [P1, P2], topicIds: [], urls: [], paths: [] });
  });

  it('reads topic targets, and a sent topic, as topic ids', () => {
    expect(scopeOf({ targetEntity: 'topics', targets: [{ id: T1 }] }).topicIds).toEqual([T1]);
    expect(scopeOf({ topicId: T1 }).topicIds).toEqual([T1]);
  });

  it('reads page targets as addresses and paths', () => {
    expect(
      scopeOf({ targetEntity: 'pages', targets: [{ id: 'https://a.com/x' }, { id: '/blog' }] }),
    ).toMatchObject({ urls: ['https://a.com/x'], paths: ['/blog'] });
  });

  it('reads nothing from other targets', () => {
    expect(scopeOf({ targetEntity: 'competitors', targets: [{ id: P1 }] })).toEqual({
      promptIds: [],
      topicIds: [],
      urls: [],
      paths: [],
    });
  });
});

describe('distinctPages', () => {
  it('keeps each address once, web addresses only, up to the cap', () => {
    expect(
      distinctPages([
        'https://a.com/x/',
        'https://A.com/x',
        'ftp://a.com',
        '/path',
        'https://b.com',
      ]),
    ).toEqual(['https://a.com/x/', 'https://b.com']);
    const many = Array.from({ length: 20 }, (_, i) => `https://a.com/${i}`);
    expect(distinctPages(many)).toHaveLength(MAX_SCOPE_PAGES);
  });
});

describe('withWorkScope', () => {
  it('adds a prompt action its prompts and the pages they are mapped to', async () => {
    const calls = [];
    const db = fakeDb(
      {
        prompt_target_urls: [
          { prompt_id: P2, url: 'https://shop.com/b' },
          { prompt_id: P1, url: 'https://shop.com/a' },
          { prompt_id: P2, url: 'https://shop.com/a/' },
        ],
      },
      calls,
    );
    const payload = { targetEntity: 'prompts', targets: [{ id: P1 }, { id: P2 }] };
    expect(await withWorkScope('b1', payload, { db })).toEqual({
      ...payload,
      promptIds: [P1, P2],
      pages: ['https://shop.com/a', 'https://shop.com/b'],
    });
    expect(calls).toEqual([['prompt_target_urls', ['in', 'prompt_id', [P1, P2]]]]);
  });

  it("adds a topic action its topic's prompts, the brand's only", async () => {
    const calls = [];
    const db = fakeDb({ prompts: [{ id: P1 }, { id: P2 }] }, calls);
    const scoped = await withWorkScope(
      'b1',
      { targetEntity: 'topics', targets: [{ id: T1, label: 'Boots' }] },
      { db },
    );
    expect(scoped.promptIds).toEqual([P1, P2]);
    expect(scoped).not.toHaveProperty('pages');
    expect(calls[0]).toEqual([
      'prompts',
      ['eq', 'prompt_sets.brand_id', 'b1'],
      ['in', 'topic_id', [T1]],
    ]);
  });

  it("reads a page target's path on the brand's primary domain", async () => {
    const db = fakeDb({ brand_domains: { domain: 'https://www.shop.com/' } });
    const scoped = await withWorkScope(
      'b1',
      { targetEntity: 'pages', targets: [{ id: '/guides/boots' }, { id: 'https://shop.com/x' }] },
      { db },
    );
    expect(scoped.pages).toEqual(['https://shop.com/x', 'https://www.shop.com/guides/boots']);
    expect(scoped).not.toHaveProperty('promptIds');
  });

  it('keeps the prompts and pages a payload names, reading nothing', async () => {
    const calls = [];
    const payload = { targetEntity: 'prompts', promptIds: [P1], pages: ['https://a.com'] };
    expect(await withWorkScope('b1', payload, { db: fakeDb({}, calls) })).toBe(payload);
    expect(calls).toEqual([]);
  });

  it('caps the prompts it lists', async () => {
    const ids = Array.from(
      { length: 60 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const scoped = await withWorkScope(
      'b1',
      { targetEntity: 'prompts', targetIds: ids, targets: [] },
      { db: fakeDb({}) },
    );
    expect(scoped.promptIds).toHaveLength(MAX_SCOPE_PROMPTS);
  });

  it('adds nothing where nothing is found', async () => {
    const payload = { targetEntity: 'competitors', targets: [{ id: 'c1', label: 'Rival' }] };
    expect(await withWorkScope('b1', payload, { db: fakeDb({}) })).toEqual(payload);
  });

  it('throws on a failed read', async () => {
    const db = fakeDb({ prompts: () => ({ data: null, error: { message: 'down' } }) });
    await expect(
      withWorkScope('b1', { targetEntity: 'topics', targets: [{ id: T1 }] }, { db }),
    ).rejects.toThrow('prompts read: down');
  });
});
