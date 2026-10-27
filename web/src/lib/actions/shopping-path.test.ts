import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Brief › Shopping path (shopping path, part 3): read, save, build and search. */

const DRAFT = '77777777-7777-7777-7777-777777777777';
const BRAND = '33333333-3333-3333-3333-333333333333';

interface Call {
  table: string;
  op: string;
  value?: unknown;
  filters: [string, string, unknown][];
  orders: [string, unknown][];
  limit?: number;
}
type Answer = { data: unknown; error: { message: string } | null };
let calls: Call[];
let read: Answer;
/** A read's answer by what it asks, where one table's reads differ; `read` otherwise. */
let answer: ((call: Call) => Answer | undefined) | null;
let written: { data: unknown; error: { message: string } | null };
let session: { access_token: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [], orders: [] };
      calls.push(call);
      const result = () => (call.op === 'update' ? written : (answer?.(call) ?? read));
      const filter = (kind: string) => (col: string, v: unknown) => (
        call.filters.push([kind, col, v]),
        chain
      );
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: filter('eq'),
        is: filter('is'),
        ilike: filter('ilike'),
        in: filter('in'),
        order: (col: string, opts: unknown) => (call.orders.push([col, opts]), chain),
        limit: (n: number) => ((call.limit = n), chain),
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
  getProductsForBlock,
  saveDraftShoppingPath,
  searchCatalogProducts,
  searchProductsForBlock,
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
  answer = null;
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

describe('getProductsForBlock', () => {
  const id = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
  const [P1, P2, P3, P4, P5, P6] = [1, 2, 3, 4, 5, 6].map(id);
  const row = (n: number): { id: string; title: string; url: string | null } => ({
    id: id(n),
    title: `Boot ${n}`,
    url: `https://s.example/p/${n}`,
  });
  const variant = (price: number | null, availability: string | null, extra = {}) => ({
    url: null,
    price,
    sale_price: null,
    currency: 'USD',
    availability,
    ...extra,
  });
  const of = (call: Call) => call.filters.find(([, col]) => col === 'product_id')?.[2] as string;
  /** The catalog: its live products, and each one's variants and pictures, read by its id. */
  const catalog = ({
    products = [] as ReturnType<typeof row>[],
    variants = {} as Record<string, ReturnType<typeof variant>[]>,
    images = {} as Record<string, { url: string }[]>,
    errors = {} as Record<string, string>,
  }) => {
    answer = (call) => {
      if (errors[call.table]) return { data: null, error: { message: errors[call.table] } };
      if (call.table === 'catalog_products') return { data: products, error: null };
      if (call.table === 'catalog_variants') return { data: variants[of(call)] ?? [], error: null };
      if (call.table === 'catalog_images') return { data: images[of(call)] ?? [], error: null };
    };
  };

  it("shows each one's cheapest variant in stock, however the feed spells it, its sale price first", async () => {
    catalog({
      products: [row(1), row(2), row(4)],
      variants: {
        // The cheapest sold out; "In Stock" is in stock.
        [P1]: [variant(99, 'Out of Stock'), variant(189, 'in_stock'), variant(149, 'In Stock')],
        // On sale, the cheapest it sells at.
        [P4]: [
          variant(120, 'in_stock'),
          variant(130, 'LIMITED AVAILABILITY', { sale_price: 110, currency: 'EUR' }),
        ],
        // All sold out: no price, not in stock.
        [P2]: [variant(50, 'sold out'), variant(40, 'preorder')],
      },
      images: { [P1]: [{ url: 'https://cdn.example/p1.jpg' }] },
    });
    expect(await getProductsForBlock(BRAND, [P1, P4, P2])).toEqual([
      {
        ...row(1),
        image: 'https://cdn.example/p1.jpg',
        price: 149,
        salePrice: null,
        currency: 'USD',
        inStock: true,
      },
      { ...row(4), image: null, price: 130, salePrice: 110, currency: 'EUR', inStock: true },
      { ...row(2), image: null, price: null, salePrice: null, currency: null, inStock: false },
    ]);
  });

  it('reads each product on its own: its live variants, its own picture first', async () => {
    catalog({ products: [row(1), row(2)] });
    await getProductsForBlock(BRAND, [P1, P2]);
    const variants = calls.filter((c) => c.table === 'catalog_variants');
    expect(variants.map((c) => c.filters)).toEqual([
      [
        ['eq', 'product_id', P1],
        ['is', 'removed_at', null],
      ],
      [
        ['eq', 'product_id', P2],
        ['is', 'removed_at', null],
      ],
    ]);
    expect(variants.every((c) => c.limit === undefined)).toBe(true);
    const images = calls.filter((c) => c.table === 'catalog_images');
    expect(images.map((c) => c.filters)).toEqual([
      [['eq', 'product_id', P1]],
      [['eq', 'product_id', P2]],
    ]);
    expect(images[0].orders).toEqual([
      ['variant_id', { ascending: true, nullsFirst: true }],
      ['position', { ascending: true }],
    ]);
    expect(images[0].limit).toBe(1);
    expect(calls.find((c) => c.table === 'catalog_products')!.filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['is', 'removed_at', null],
      ['in', 'id', [P1, P2]],
    ]);
  });

  it('keeps the order asked, leaves out one gone from the catalog, and reads four at most', async () => {
    catalog({
      // Read in another order; P3 is gone.
      products: [row(5), row(1), row(2), row(4), row(6)],
      variants: { [P1]: [variant(10, 'in_stock', { url: 'https://s.example/v/1' })] },
    });
    const read = await getProductsForBlock(BRAND, [P4, P3, P1, P1, 'nope', P2, P5, P6]);
    expect(read.map((p) => p.id)).toEqual([P4, P1, P2]);
    expect(calls.filter((c) => c.table === 'catalog_variants')).toHaveLength(4);
    // A product without a page of its own links its variant's.
    catalog({
      products: [{ ...row(1), url: null }],
      variants: { [P1]: [variant(10, 'in_stock', { url: 'https://s.example/v/1' })] },
    });
    expect((await getProductsForBlock(BRAND, [P1]))[0].url).toBe('https://s.example/v/1');
  });

  it('reads nothing for a brand or ids it cannot read, and fails on a failed read', async () => {
    expect(await getProductsForBlock('nope', [P1])).toEqual([]);
    expect(await getProductsForBlock(BRAND, ['nope'])).toEqual([]);
    expect(calls).toHaveLength(0);
    for (const table of ['catalog_products', 'catalog_variants', 'catalog_images']) {
      catalog({ products: [row(1)], errors: { [table]: `${table} down` } });
      await expect(getProductsForBlock(BRAND, [P1])).rejects.toThrow(`${table} down`);
    }
  });
});

describe('searchProductsForBlock', () => {
  it('finds products by name, each with its price and stock, without reading pictures', async () => {
    const P1 = 'aaaaaaaa-0000-4000-8000-000000000001';
    const P2 = 'aaaaaaaa-0000-4000-8000-000000000002';
    answer = (call) => {
      if (call.table === 'catalog_products') {
        return {
          data: [
            { id: P1, title: 'Boot 1', url: 'https://s.example/p/1' },
            { id: P2, title: 'Boot 2', url: null },
          ],
          error: null,
        };
      }
      const id = call.filters.find(([, col]) => col === 'product_id')?.[2];
      return {
        data:
          id === P1
            ? [
                {
                  url: null,
                  price: 89,
                  sale_price: null,
                  currency: 'USD',
                  availability: 'In Stock',
                },
              ]
            : [
                {
                  url: null,
                  price: 59,
                  sale_price: null,
                  currency: 'USD',
                  availability: 'sold_out',
                },
              ],
        error: null,
      };
    };
    expect(await searchProductsForBlock(BRAND, 'boot')).toEqual([
      {
        id: P1,
        title: 'Boot 1',
        url: 'https://s.example/p/1',
        image: null,
        price: 89,
        salePrice: null,
        currency: 'USD',
        inStock: true,
      },
      {
        id: P2,
        title: 'Boot 2',
        url: null,
        image: null,
        price: null,
        salePrice: null,
        currency: null,
        inStock: false,
      },
    ]);
    expect(calls.some((c) => c.table === 'catalog_images')).toBe(false);
    expect(calls[0].filters).toContainEqual(['ilike', 'title', '%boot%']);
  });

  it('waits for two letters, and fails on a failed read', async () => {
    expect(await searchProductsForBlock(BRAND, 'b')).toEqual([]);
    expect(calls).toHaveLength(0);
    read = { data: null, error: { message: 'boom' } };
    await expect(searchProductsForBlock(BRAND, 'boots')).rejects.toThrow('boom');
  });
});
