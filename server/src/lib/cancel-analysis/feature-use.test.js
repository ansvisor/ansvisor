import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { readFeatureUse } = await import('./feature-use.js');

/**
 * What the workspace ever used, from our own tables: a count each, on the
 * real brands only, and null for a count that can't be read.
 */

/** A service-role client that records each query and answers from `answers`. */
function fakeDb(answers) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, calls: [] };
      queries.push(query);
      const chain = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'then') {
              const answer = answers[table];
              const result = typeof answer === 'function' ? answer(query) : answer;
              return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
            }
            return (...args) => {
              query.calls.push([prop, ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
}

const counts = (rows) => Object.fromEntries(rows.map((row) => [row.key, row.count]));

describe('readFeatureUse', () => {
  it('counts each feature on the real brands, the demo brand left out', async () => {
    const db = fakeDb({
      brands: { data: [{ id: 'b1' }, { id: 'b2' }], error: null },
      brand_cms_connections: { count: 0, error: null },
      competitors: { count: 4, error: null },
      content_drafts: { count: 2, error: null },
      site_audits: { count: 0, error: null },
      chat_conversations: { count: 7, error: null },
    });
    const rows = await readFeatureUse('o1', { db });
    expect(rows).toEqual([
      { key: 'cms', label: 'Connected a CMS', count: 0 },
      { key: 'competitors', label: 'Added competitors', count: 4 },
      { key: 'content', label: 'Created content', count: 2 },
      { key: 'siteAudit', label: 'Ran a site audit', count: 0 },
      { key: 'chat', label: 'Used Chat', count: 7 },
    ]);

    const query = (table) => db.queries.find((q) => q.table === table).calls;
    expect(query('brands')).toEqual([
      ['select', 'id'],
      ['eq', 'organization_id', 'o1'],
      ['eq', 'is_demo', false],
      ['limit', 200],
    ]);
    for (const table of ['brand_cms_connections', 'competitors', 'content_drafts']) {
      expect(query(table)).toEqual([
        ['select', 'id', { count: 'exact', head: true }],
        ['in', 'brand_id', ['b1', 'b2']],
      ]);
    }
    // The audits a person ran, not the automatic ones.
    expect(query('site_audits')).toContainEqual(['eq', 'source', 'user']);
    // Chats on the real brands or the whole workspace: the demo brand's are left out.
    expect(query('chat_conversations')).toEqual([
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'organization_id', 'o1'],
      ['or', 'brand_id.is.null,brand_id.in.(b1,b2)'],
    ]);
    // Counts only: no rows are read.
    expect(db.queries.map((q) => q.table).sort()).toEqual([
      'brand_cms_connections',
      'brands',
      'chat_conversations',
      'competitors',
      'content_drafts',
      'site_audits',
    ]);
  });

  it('is never for a workspace with no real brand, without asking the brand tables', async () => {
    const db = fakeDb({
      brands: { data: [], error: null },
      chat_conversations: { count: 0, error: null },
    });
    expect(counts(await readFeatureUse('o1', { db }))).toEqual({
      cms: 0,
      competitors: 0,
      content: 0,
      siteAudit: 0,
      chat: 0,
    });
    expect(db.queries.map((q) => q.table)).toEqual(['brands', 'chat_conversations']);
    expect(db.queries[1].calls).toContainEqual(['or', 'brand_id.is.null']);
  });

  it('says a count it couldn’t read is unknown, and never throws', async () => {
    const db = fakeDb({
      brands: { data: [{ id: 'b1' }], error: null },
      brand_cms_connections: { count: null, error: { message: 'boom' } },
      competitors: () => {
        throw new Error('network');
      },
      content_drafts: { count: 1, error: null },
      site_audits: { count: 3, error: null },
      chat_conversations: { count: 0, error: null },
    });
    expect(counts(await readFeatureUse('o1', { db }))).toEqual({
      cms: null,
      competitors: null,
      content: 1,
      siteAudit: 3,
      chat: 0,
    });

    // Without the brands, nothing is known.
    const noBrands = fakeDb({ brands: { data: null, error: { message: 'down' } } });
    expect(counts(await readFeatureUse('o1', { db: noBrands }))).toEqual({
      cms: null,
      competitors: null,
      content: null,
      siteAudit: null,
      chat: null,
    });
    expect(noBrands.queries.map((q) => q.table)).toEqual(['brands']);
  });
});
