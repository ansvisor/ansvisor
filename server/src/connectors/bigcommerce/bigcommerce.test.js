import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { syncSource } from '../../lib/catalog/sources.js';
import { ConnectError } from '../errors.js';
import { connectorFor, storeConnectors } from '../index.js';
import { runSync, startFakeApi } from '../testing.js';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../../lib/shopping-check.js', () => ({ queueShoppingCheck: vi.fn() }));

// Joined, trimmed response examples from bigcommerce/api-specs at dcf4840
// (reference/catalog/products_catalog.v3.yml and product-variants_catalog.v3.yml).
// Page boundaries, example image hosts, and the simple product are test data.
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/catalog.json', import.meta.url), 'utf8'),
);
const connector = connectorFor('bigcommerce');
const input = { url: 'https://shop.example', storeHash: 'abc123', accessToken: 'fixture-token' };
let api;
afterEach(async () => {
  await api?.close();
  api = null;
});

async function setup({ rateLimitOnce = false } = {}) {
  const data = globalThis.structuredClone(fixture);
  const root = '/stores/abc123/v3/catalog/';
  api = await startFakeApi({
    [`GET ${root}products`]: ({ query }) => {
      if (query.limit === '1') return { json: { data: [] } };
      if (rateLimitOnce) {
        rateLimitOnce = false;
        return { status: 429, headers: { 'retry-after': '2' } };
      }
      return { json: data.products[Number(query.page) - 1] };
    },
    [`GET ${root}trees/categories`]: ({ query }) => ({
      json: data.categories[Number(query.page) - 1],
    }),
  });
  const request = (url, options) => {
    expect(new URL(url).origin).toBe('https://api.bigcommerce.com');
    return api.request(api.origin + new URL(url).pathname, options);
  };
  const { credentials, ...source } = await connector.connect(input, { request });
  const result = await runSync(connector, source, { credentials, request });
  const row = result.fake.rows('catalog_sources')[0];
  const repeat = () => syncSource(row, { db: result.fake.db, request });
  return { data, result, repeat };
}

it('exposes the sign-in fields and sends the token only in the request header', async () => {
  expect(storeConnectors().find((c) => c.kind === 'bigcommerce').fields).toMatchObject([
    { name: 'url', secret: false },
    { name: 'storeHash', secret: false },
    { name: 'accessToken', secret: true },
  ]);
  const { result } = await setup();
  expect(result.outcome.status).toBe('ok');
  expect(
    api.calls.every(
      (call) => call.method === 'GET' && call.headers['x-auth-token'] === input.accessToken,
    ),
  ).toBe(true);
  expect(JSON.stringify(api.calls.map(({ path, query }) => ({ path, query })))).not.toContain(
    input.accessToken,
  );
  for (const table of ['catalog_sources', 'catalog_source_credentials']) {
    expect(JSON.stringify(result.fake.rows(table))).not.toContain(input.accessToken);
  }
});

it('syncs both pages and updates only the variant whose price changes', async () => {
  const { data, result, repeat } = await setup();
  const { outcome, variants, products, categories, images } = result;
  expect(outcome).toMatchObject({
    status: 'ok',
    counts: { products: { added: 2 }, variants: { added: 3 }, skipped: 0 },
  });
  expect(
    api.calls
      .filter((c) => c.query.include === 'variants,images' && c.query.is_visible === 'true')
      .map((c) => c.query.page),
  ).toEqual(['1', '2']);
  expect(
    api.calls.filter((c) => c.path.endsWith('/trees/categories')).map((c) => c.query.page),
  ).toEqual(['1', '2']);
  const jar = products.find((p) => p.external_id === '174');
  expect(jar).toMatchObject({
    title: '1L Le Parfait Jar',
    description: 'Glass jar',
    url: 'https://shop.example/all/1l-le-parfait-jar/',
  });
  const beige = variants.find((v) => v.external_id === '382');
  expect(beige).toMatchObject({
    product_id: jar.id,
    sku: 'SMIT',
    price: 10,
    sale_price: 8,
    attributes: { color: 'Beige' },
    availability: 'out_of_stock',
  });
  expect(variants.find((v) => v.external_id === '401')).toMatchObject({
    price: 2,
    availability: 'in_stock',
  });
  expect(categories.map((c) => c.name)).toEqual(['Kitchen > Storage']);
  expect(result.fake.rows('catalog_product_categories')).toContainEqual(
    expect.objectContaining({ product_id: jar.id, category_id: categories[0].id }),
  );
  expect(images.filter((i) => i.variant_id === beige.id).map((i) => i.url)).toEqual([
    'https://images.example/jar-1.jpg',
    'https://images.example/jar-2.jpg',
  ]);
  const before = globalThis.structuredClone({ variants, products, categories, images });
  expect((await repeat()).counts).toMatchObject({
    products: { unchanged: 2, changed: 0 },
    variants: { unchanged: 3, changed: 0 },
  });
  expect({ variants, products, categories, images }).toEqual(before);
  data.products[0].data[0].variants[0].price = 12.345;
  data.products[0].data[0].variants[0].sale_price = 9.875;
  expect((await repeat()).counts).toMatchObject({
    products: { unchanged: 2, changed: 0 },
    variants: { changed: 1, unchanged: 2, added: 0, removed: 0 },
  });
  expect(variants.find((v) => v.id === beige.id)).toMatchObject({ price: 12.35, sale_price: 9.88 });
});

it('finishes both product pages after a rate-limited read', async () => {
  const { result } = await setup({ rateLimitOnce: true });
  expect(api.waits).toHaveLength(1);
  expect(api.waits[0]).toBeGreaterThanOrEqual(2000);
  expect(result.outcome).toMatchObject({ status: 'ok', counts: { items: 3, skipped: 0 } });
});

it('reports a listing with no product name and keeps the valid listings', async () => {
  const { data, repeat } = await setup();
  data.products[1].data[0].name = '';
  const { status, counts } = await repeat();
  expect(status).toBe('ok');
  expect(counts).toMatchObject({ items: 2, skipped: 1 });
  expect(counts.errors[0]).toMatch(/title is missing/i);
});

it.each(['metadata', 'rows'])(
  'preserves the catalog when the last page is missing %s',
  async (missing) => {
    const { data, result, repeat } = await setup();
    if (missing === 'metadata') data.products[1].meta = {};
    else data.products[1].data = [];
    expect((await repeat()).status).toBe('format_error');
    expect(result.products.every((p) => !p.removed_at)).toBe(true);
    expect(result.variants.every((v) => !v.removed_at)).toBe(true);
  },
);

it('explains invalid and refused sign-ins without disclosing the token', async () => {
  const request = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error(input.accessToken), { code: 'auth' }));
  await expect(
    connector.connect({ ...input, storeHash: 'bad/path' }, { request }),
  ).rejects.toBeInstanceOf(ConnectError);
  await expect(
    connector.connect({ ...input, accessToken: '' }, { request }),
  ).rejects.toBeInstanceOf(ConnectError);
  expect(request).not.toHaveBeenCalled();
  await expect(connector.connect(input, { request })).rejects.toMatchObject({
    name: 'ConnectError',
    message: 'Check the store hash, access token and read-only Products permission.',
  });
});
