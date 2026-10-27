import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Brief › Shopping path (shopping path, part 3): read, save, build and search. */

const DRAFT = '77777777-7777-7777-7777-777777777777';
const BRAND = '33333333-3333-3333-3333-333333333333';

interface Call {
  table: string;
  op: string;
  value?: unknown;
  filters: [string, string, unknown][];
}
let calls: Call[];
let read: { data: unknown; error: { message: string } | null };
let written: { data: unknown; error: { message: string } | null };
let session: { access_token: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const result = () => (call.op === 'update' ? written : read);
      const filter = (kind: string) => (col: string, v: unknown) => (
        call.filters.push([kind, col, v]),
        chain
      );
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: filter('eq'),
        is: filter('is'),
        ilike: filter('ilike'),
        order: () => chain,
        limit: () => chain,
        update: (value: unknown) => ((call.op = 'update'), (call.value = value), chain),
        maybeSingle: async () => result(),
        then: (resolve: (r: unknown) => void) => resolve(result()),
      };
      return chain;
    },
  })),
}));

const {
  buildDraftShoppingPath,
  getDraftShoppingPath,
  saveDraftShoppingPath,
  searchCatalogProducts,
} = await import('./shopping-path');

const product = (id: string) => ({
  id,
  title: `Boot ${id}`,
  url: `https://s.example/p/${id}`,
  price: 129,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 5,
});

const STORED = {
  version: 1,
  builtAt: '2026-10-27T12:00:00.000Z',
  pageType: 'buying_guide',
  categories: [],
  // As the API wrote it: the tab reads it as "limited_availability".
  products: [{ ...product('a'), availability: 'Limited Availability' }, product('b')],
  leftOut: [],
  locked: ['a'],
  removed: [],
  added: [],
};

const fetchMock = vi.fn();
const respond = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  calls = [];
  read = { data: null, error: null };
  written = { data: [{ id: DRAFT }], error: null };
  session = { access_token: 'jwt' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getDraftShoppingPath', () => {
  it('reads the path, none until built, and none for a draft it can’t see', async () => {
    read.data = { shopping_path: STORED };
    expect(await getDraftShoppingPath(DRAFT)).toMatchObject({
      path: { builtAt: STORED.builtAt, products: [{ availability: 'limited_availability' }, {}] },
    });
    read.data = { shopping_path: null };
    expect(await getDraftShoppingPath(DRAFT)).toEqual({ path: null });
    read.data = null;
    expect(await getDraftShoppingPath(DRAFT)).toBeNull();
  });

  it('says a kept path it can’t read is unreadable, and a failed read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      read.data = { shopping_path: { ...STORED, version: 2 } };
      expect(await getDraftShoppingPath(DRAFT)).toEqual({ path: null, unreadable: true });
    } finally {
      error.mockRestore();
    }
    read = { data: null, error: { message: 'boom' } };
    await expect(getDraftShoppingPath(DRAFT)).rejects.toThrow('boom');
    await expect(getDraftShoppingPath('nope')).rejects.toThrow('invalid');
  });
});

describe('saveDraftShoppingPath', () => {
  const choices = { locked: [], removed: ['a'], added: ['c'] };

  it('saves the choices alone, over the path read, its removed products out', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-27T13:00:00.000Z') });
    read.data = { shopping_path: STORED };
    const saved = await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices);

    const update = calls.find((c) => c.op === 'update')!;
    // The rest as the API wrote it, not as the tab reads it.
    expect(update.value).toEqual({
      shopping_path: {
        ...STORED,
        products: [product('b')],
        locked: [],
        removed: ['a'],
        added: ['c'],
        savedAt: '2026-10-27T13:00:00.000Z',
      },
    });
    expect(update.filters).toEqual([
      ['eq', 'id', DRAFT],
      ['eq', 'shopping_path->>builtAt', STORED.builtAt],
      ['is', 'shopping_path->>savedAt', null],
    ]);
    expect(saved).toMatchObject({
      path: { savedAt: '2026-10-27T13:00:00.000Z', products: [{ id: 'b' }], added: ['c'] },
    });
  });

  it('writes only over the last change read', async () => {
    const savedAt = '2026-10-27T12:30:00.000Z';
    read.data = { shopping_path: { ...STORED, savedAt } };
    await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt, savedAt }, choices);
    expect(calls.find((c) => c.op === 'update')!.filters).toContainEqual([
      'eq',
      'shopping_path->>savedAt',
      savedAt,
    ]);
  });

  it('says the path changed when it was built or changed since it was read', async () => {
    read.data = { shopping_path: { ...STORED, builtAt: '2026-10-27T12:45:00.000Z' } };
    expect(await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices)).toEqual({
      error: 'changed',
    });
    read.data = { shopping_path: { ...STORED, savedAt: '2026-10-27T12:50:00.000Z' } };
    expect(await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices)).toEqual({
      error: 'changed',
    });
    expect(calls.some((c) => c.op === 'update')).toBe(false);

    // Between the read and the write: no row matched.
    read.data = { shopping_path: STORED };
    written = { data: [], error: null };
    expect(await saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices)).toEqual({
      error: 'changed',
    });
  });

  it('refuses choices past the caps, and fails on a failed write', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `i${i}`);
    await expect(
      saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, { ...choices, locked: ids }),
    ).rejects.toThrow('invalid');
    read.data = { shopping_path: STORED };
    written = { data: null, error: { message: 'denied' } };
    await expect(
      saveDraftShoppingPath(DRAFT, { builtAt: STORED.builtAt }, choices),
    ).rejects.toThrow('denied');
  });
});

describe('buildDraftShoppingPath', () => {
  it('builds through the API and reads the path it answers', async () => {
    respond(200, { path: STORED });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toMatchObject({
      path: { builtAt: STORED.builtAt },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(new RegExp(`/api/content-drafts/${DRAFT}/shopping-path$`));
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ brandId: BRAND }) });
  });

  it('says why a draft takes none, a reason added since in general words', async () => {
    respond(200, { path: null, reason: 'no_match' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ path: null, reason: 'no_match' });
    respond(200, { path: null, reason: 'paused' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ path: null, reason: 'other' });
  });

  it('tells a change meanwhile and too many picks from a failure', async () => {
    respond(409, { error: 'The shopping path changed while it was built', code: 'changed' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'changed' });
    respond(429, { success: false, message: 'Too many requests, please try again later.' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'rate_limited' });
    respond(502, { code: 'failed' });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'failed' });
    respond(200, { path: { ...STORED, version: 2 } });
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'failed' });
    session = null;
    expect(await buildDraftShoppingPath(DRAFT, BRAND)).toEqual({ error: 'failed' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('searchCatalogProducts', () => {
  it('searches the live catalog for the words as typed, wildcards and all', async () => {
    read.data = [{ id: 'p9', title: '50% off boots', url: null }];
    expect(await searchCatalogProducts(BRAND, ' 50%_off\\ ')).toEqual([
      { id: 'p9', title: '50% off boots', url: null },
    ]);
    expect(calls[0].filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['is', 'removed_at', null],
      ['ilike', 'title', '%50\\%\\_off\\\\%'],
    ]);
  });

  it('waits for two letters, and fails on a failed read', async () => {
    expect(await searchCatalogProducts(BRAND, 'a')).toEqual([]);
    expect(calls).toHaveLength(0);
    read = { data: null, error: { message: 'boom' } };
    await expect(searchCatalogProducts(BRAND, 'boots')).rejects.toThrow('boom');
  });
});
