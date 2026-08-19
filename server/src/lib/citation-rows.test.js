import { describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { extractDomain, normalizeCitations, MAX_URL_LENGTH } from './citation-rows.js';

/**
 * What gets written per citation (#732).
 *
 * The stored domain has to group exactly the way the Citations page groups, or
 * the aggregate and the surface disagree about what a domain is — so these
 * pin the rule rather than the implementation.
 */
describe('extractDomain', () => {
  it('lowercases the host and drops www.', () => {
    expect(extractDomain('https://WWW.Example.COM/a/b?c=d')).toBe('example.com');
  });

  it('keeps subdomains other than www', () => {
    expect(extractDomain('https://docs.example.com/guide')).toBe('docs.example.com');
    expect(extractDomain('https://www2.example.com/')).toBe('www2.example.com');
  });

  it('ignores port, path, query and fragment', () => {
    expect(extractDomain('https://example.com:8443/x?y=1#z')).toBe('example.com');
  });

  // 252 of the 2,023,979 citations in production arrive without a scheme.
  // The page counts them today by recovering a hostname-like token, so a
  // writer that dropped them would quietly lower every figure once the page
  // reads these rows instead.
  it('recovers a host from a URL with no scheme', () => {
    expect(extractDomain('example.com/page')).toBe('example.com');
    expect(extractDomain('www.example.com/page')).toBe('example.com');
    expect(extractDomain('WWW.EXAMPLE.COM')).toBe('example.com');
  });

  it('returns null only when there is no host-like token at all', () => {
    for (const bad of ['', '   ', '/relative/path', null, undefined, 42, {}]) {
      expect(extractDomain(bad)).toBeNull();
    }
  });
});

describe('normalizeCitations', () => {
  it('keeps the array index as position', () => {
    const rows = normalizeCitations([
      { url: 'https://a.com/1' },
      { url: 'https://b.com/2' },
      { url: 'https://c.com/3' },
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  // Dropping an entry must not renumber the ones after it: position is half
  // the primary key, so a shifted index would collide with a different
  // citation on a re-run.
  it('preserves the original index when an entry is dropped', () => {
    const rows = normalizeCitations([
      { url: 'https://a.com/1' },
      { url: '/relative/only' },
      { url: 'https://c.com/3' },
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 2]);
    expect(rows.map((r) => r.domain)).toEqual(['a.com', 'c.com']);
  });

  it('drops entries with no usable URL rather than storing a null domain', () => {
    const rows = normalizeCitations([
      { url: '' },
      { url: '   ' },
      { title: 'no url at all' },
      { url: '/relative/only' },
      null,
      undefined,
    ]);
    expect(rows).toEqual([]);
  });

  it('truncates a URL that would not fit a btree entry', () => {
    const long = `https://example.com/${'x'.repeat(5000)}`;
    const [row] = normalizeCitations([{ url: long }]);
    expect(row.url).toHaveLength(MAX_URL_LENGTH);
    expect(row.domain).toBe('example.com');
  });

  it('trims the title and stores null when it is empty', () => {
    expect(normalizeCitations([{ url: 'https://a.com', title: '  Hello  ' }])[0].title).toBe(
      'Hello',
    );
    expect(normalizeCitations([{ url: 'https://a.com', title: '   ' }])[0].title).toBeNull();
    expect(normalizeCitations([{ url: 'https://a.com' }])[0].title).toBeNull();
  });

  it('returns an empty list for anything that is not an array', () => {
    for (const bad of [null, undefined, {}, 'citations', 7]) {
      expect(normalizeCitations(bad)).toEqual([]);
    }
  });

  // The same page cited twice in one answer is two citations, not one: the
  // page's own count of how often it was cited depends on it.
  it('keeps repeated URLs as separate rows', () => {
    const rows = normalizeCitations([{ url: 'https://a.com/x' }, { url: 'https://a.com/x' }]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });
});

/**
 * URL lookups are chunked because a PostgREST `.in()` filter travels in the
 * query string (#732).
 *
 * The first production backfill lost 228 of 174,466 answers to this — the ones
 * carrying the most citations, averaging 16 KB of URL text against 1.2 KB for
 * the answers that succeeded. The failure was logged and the answer skipped,
 * so the totals looked healthy. These tests pin the batching rather than the
 * limit, since the limit is the server's to enforce.
 */
describe('persistCitationRows url lookups', () => {
  /** Records every `.in()` batch so the test can assert on their sizes. */
  function makeClient({ existing = new Map() } = {}) {
    const batches = [];
    let nextId = existing.size + 1;

    const client = {
      from(table) {
        if (table === 'citation_urls') {
          return {
            select: () => ({
              in: (_col, urls) => {
                batches.push(urls.length);
                return Promise.resolve({
                  data: urls
                    .filter((u) => existing.has(u))
                    .map((u) => ({ id: existing.get(u), url: u })),
                  error: null,
                });
              },
            }),
            upsert: (rows) => {
              for (const row of rows) if (!existing.has(row.url)) existing.set(row.url, nextId++);
              return Promise.resolve({ error: null });
            },
          };
        }
        // prompt_result_citations: `.upsert().select()` returns the rows that
        // were actually inserted, which is what persistCitationRows counts.
        return {
          upsert: (rows) => ({
            select: () =>
              Promise.resolve({ data: rows.map((r) => ({ position: r.position })), error: null }),
          }),
        };
      },
    };
    return { client, batches };
  }

  async function run(citations, opts) {
    const { client, batches } = makeClient(opts);
    vi.resetModules();
    vi.doMock('../config/supabase.js', () => ({ default: client }));
    const { persistCitationRows } = await import('./citation-rows.js');
    const written = await persistCitationRows({
      promptResultId: 'r1',
      brandId: 'b1',
      createdAt: '2026-08-19T00:00:00Z',
      citations,
    });
    return { written, batches };
  }

  it('splits a large URL set into bounded batches', async () => {
    const citations = Array.from({ length: 250 }, (_, i) => ({ url: `https://a.com/${i}` }));
    const { written, batches } = await run(citations);

    expect(written).toBe(250);
    // 250 unknown URLs: three batches to look them up, three to read them back.
    expect(batches).toEqual([100, 100, 50, 100, 100, 50]);
    expect(Math.max(...batches)).toBeLessThanOrEqual(100);
  });

  it('stores every citation of an answer far larger than one batch', async () => {
    // The largest answer in production carries 191 citations.
    const citations = Array.from({ length: 191 }, (_, i) => ({ url: `https://b.com/${i}` }));
    const { written } = await run(citations);
    expect(written).toBe(191);
  });

  it('makes no second round trip when every URL is already known', async () => {
    const existing = new Map(Array.from({ length: 120 }, (_, i) => [`https://c.com/${i}`, i + 1]));
    const citations = Array.from({ length: 120 }, (_, i) => ({ url: `https://c.com/${i}` }));
    const { written, batches } = await run(citations, { existing });

    expect(written).toBe(120);
    expect(batches).toEqual([100, 20]); // lookup only — nothing to insert
  });
});

/**
 * Zero and null are different answers (#732).
 *
 * A backfill run once reported thousands of citations written while the table
 * did not move, because every row was discarded as a duplicate and the count
 * reported what had been attempted. The caller has to be able to tell "already
 * there" from "nothing stored, retry".
 */
describe('persistCitationRows return contract', () => {
  async function withClient(client, citations) {
    vi.resetModules();
    vi.doMock('../config/supabase.js', () => ({ default: client }));
    const { persistCitationRows } = await import('./citation-rows.js');
    return persistCitationRows({
      promptResultId: 'r1',
      brandId: 'b1',
      createdAt: '2026-08-19T00:00:00Z',
      citations,
    });
  }

  const urlTable = (inserted) => ({
    select: () => ({
      in: (_c, urls) =>
        Promise.resolve({ data: urls.map((u, i) => ({ id: i + 1, url: u })), error: null }),
    }),
    upsert: () => Promise.resolve({ error: null }),
    _inserted: inserted,
  });

  it('reports how many rows were actually inserted', async () => {
    const client = {
      from: (t) =>
        t === 'citation_urls'
          ? urlTable()
          : { upsert: (rows) => ({ select: () => Promise.resolve({ data: rows, error: null }) }) },
    };
    expect(await withClient(client, [{ url: 'https://a.com/1' }, { url: 'https://a.com/2' }])).toBe(
      2,
    );
  });

  it('returns 0 — not a failure — when every row was already present', async () => {
    const client = {
      from: (t) =>
        t === 'citation_urls'
          ? urlTable()
          : { upsert: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) },
    };
    expect(await withClient(client, [{ url: 'https://a.com/1' }])).toBe(0);
  });

  it('returns null when the write fails', async () => {
    const client = {
      from: (t) =>
        t === 'citation_urls'
          ? urlTable()
          : {
              upsert: () => ({
                select: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
              }),
            },
    };
    expect(await withClient(client, [{ url: 'https://a.com/1' }])).toBeNull();
  });

  it('returns null when the URL lookup fails', async () => {
    const client = {
      from: () => ({
        select: () => ({ in: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }),
      }),
    };
    expect(await withClient(client, [{ url: 'https://a.com/1' }])).toBeNull();
  });

  it('returns 0 for an answer with no storable citations', async () => {
    const client = { from: () => ({}) };
    expect(await withClient(client, [{ url: '/relative' }])).toBe(0);
  });
});
