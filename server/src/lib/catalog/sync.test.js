import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { parseCsvFeed, parseGoogleFeedXml } from '../feeds/index.js';
import { catalogRecords, groupTitle, syncCatalog } from './sync.js';

const BRAND = 'brand-1';
const feed = () =>
  parseGoogleFeedXml(
    readFileSync(new URL('../feeds/__fixtures__/google-feed.xml', import.meta.url), 'utf8'),
  ).items;

/**
 * An in-memory stand-in for the tables the sync writes, with PostgREST's
 * calls as the sync makes them, counting every write.
 */
function fakeDb() {
  const tables = new Map();
  const rows = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const writes = [];
  const uniqueKey = (table, row) =>
    table === 'catalog_categories'
      ? `${row.brand_id}|${row.name}`
      : `${row.brand_id}|${row.source}|${row.external_id}`;
  // The unique keys' rows, by table, as the database's unique indexes find them.
  const byKey = new Map();
  const keyed = (table) => {
    if (!byKey.has(table)) byKey.set(table, new Map());
    return byKey.get(table);
  };

  function from(table) {
    const state = { filters: [], range: null, op: 'select', payload: null, returning: null };
    const run = () => {
      const all = rows(table);
      const match = (row) =>
        state.filters.every(([kind, column, value]) =>
          kind === 'eq' ? row[column] === value : value.includes(row[column]),
        );
      if (state.op === 'select') {
        const found = all.filter(match).sort((a, b) => (a.id < b.id ? -1 : 1));
        const [start, end] = state.range ?? [0, found.length];
        return { data: found.slice(start, end + 1), error: null };
      }
      writes.push({
        table,
        op: state.op,
        count: Array.isArray(state.payload) ? state.payload.length : 1,
      });
      if (state.op === 'upsert') {
        const out = [];
        for (const values of state.payload) {
          const key = uniqueKey(table, values);
          let row = keyed(table).get(key);
          if (row) Object.assign(row, values);
          else {
            row = { id: randomUUID(), removed_at: null, ...values };
            all.push(row);
            keyed(table).set(key, row);
          }
          out.push(row);
        }
        return { data: out, error: null };
      }
      if (state.op === 'insert') {
        for (const values of state.payload) all.push({ id: randomUUID(), ...values });
        return { data: null, error: null };
      }
      if (state.op === 'update') {
        for (const row of all.filter(match)) Object.assign(row, state.payload);
        return { data: null, error: null };
      }
      if (state.op === 'delete') {
        tables.set(
          table,
          all.filter((row) => !match(row)),
        );
        return { data: null, error: null };
      }
      throw new Error(`unexpected ${state.op}`);
    };
    const builder = {
      select: () => builder,
      eq: (column, value) => {
        state.filters.push(['eq', column, value]);
        return builder;
      },
      in: (column, values) => {
        state.filters.push(['in', column, values]);
        return builder;
      },
      order: () => builder,
      range: (start, end) => {
        state.range = [start, end];
        return builder;
      },
      upsert: (payload) => {
        state.op = 'upsert';
        state.payload = payload;
        return builder;
      },
      insert: (payload) => {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      update: (payload) => {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      delete: () => {
        state.op = 'delete';
        return builder;
      },
      then: (onFulfilled, onRejected) => Promise.resolve(run()).then(onFulfilled, onRejected),
    };
    return builder;
  }
  return { db: { from }, rows, writes };
}

let fake;
beforeEach(() => {
  fake = fakeDb();
});

describe('groupTitle', () => {
  it("takes the words an item group's titles start with, without the separator", () => {
    expect(
      groupTitle([
        'Trailrunner Hiking Boot - Red',
        'Trailrunner Hiking Boot - Blue',
        'Trailrunner Hiking Boot - Green',
      ]),
    ).toBe('Trailrunner Hiking Boot');
    expect(groupTitle(['Sock'])).toBe('Sock');
    // Too little in common: the first title.
    expect(groupTitle(['A red boot for hiking', 'A blue sock'])).toBe('A red boot for hiking');
  });
});

describe('catalogRecords', () => {
  it('makes one product per item group and a variant per item', () => {
    const { products, variants } = catalogRecords(feed());
    expect(products.map((p) => [p.external_id, p.title])).toEqual([
      ['TR-100', 'Trailrunner Hiking Boot'],
      ['SOCK-1', 'Merino Hiking Sock'],
    ]);
    expect(variants.map((v) => [v.product_external_id, v.external_id])).toEqual([
      ['TR-100', 'TR-100-RED'],
      ['TR-100', 'TR-100-BLUE'],
      ['TR-100', 'TR-100-GREEN'],
      ['SOCK-1', 'SOCK-1'],
    ]);
    expect(variants[0]).toMatchObject({
      price: 129,
      sale_price: 99,
      currency: 'USD',
      availability: 'in_stock',
      attributes: { color: 'Red', size: '42', material: 'Leather' },
      images: [
        'https://shop.example/img/tr-red.jpg',
        'https://shop.example/img/tr-red-2.jpg',
        'https://shop.example/img/tr-red-3.jpg',
      ],
    });
  });
});

describe('syncCatalog', () => {
  it('writes products, variants, images and categories', async () => {
    const counts = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    expect(counts).toEqual({
      products: { added: 2, changed: 0, removed: 0, unchanged: 0 },
      variants: { added: 4, changed: 0, removed: 0, unchanged: 0 },
    });
    const products = fake.rows('catalog_products');
    const boot = products.find((p) => p.external_id === 'TR-100');
    expect(boot).toMatchObject({
      brand_id: BRAND,
      source: 'feed',
      title: 'Trailrunner Hiking Boot',
    });
    const red = fake.rows('catalog_variants').find((v) => v.external_id === 'TR-100-RED');
    expect(red.product_id).toBe(boot.id);
    const images = fake.rows('catalog_images').filter((i) => i.variant_id === red.id);
    expect(images.map((i) => [i.position, i.url])).toEqual([
      [0, 'https://shop.example/img/tr-red.jpg'],
      [1, 'https://shop.example/img/tr-red-2.jpg'],
      [2, 'https://shop.example/img/tr-red-3.jpg'],
    ]);
    expect(fake.rows('catalog_categories').map((c) => c.name)).toEqual(['Shoes > Hiking Boots']);
    expect(fake.rows('catalog_product_categories')).toEqual([
      expect.objectContaining({ product_id: boot.id }),
    ]);
  });

  it('writes nothing when the same feed comes again', async () => {
    await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    fake.writes.length = 0;
    const counts = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    expect(fake.writes).toEqual([]);
    expect(counts.products).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 2 });
    expect(counts.variants).toEqual({ added: 0, changed: 0, removed: 0, unchanged: 4 });
  });

  it('marks a product gone from the feed as removed, and live again when it comes back', async () => {
    await syncCatalog(BRAND, 'feed', feed(), {
      db: fake.db,
      now: new Date('2026-10-20T00:00:00Z'),
    });
    const withoutSock = feed().filter((i) => i.id !== 'SOCK-1');
    const counts = await syncCatalog(BRAND, 'feed', withoutSock, {
      db: fake.db,
      now: new Date('2026-10-21T00:00:00Z'),
    });
    expect(counts.products.removed).toBe(1);
    expect(counts.variants.removed).toBe(1);
    const sock = fake.rows('catalog_products').find((p) => p.external_id === 'SOCK-1');
    expect(sock.removed_at).toBe('2026-10-21T00:00:00.000Z');
    // Nothing is deleted.
    expect(fake.rows('catalog_products')).toHaveLength(2);

    const back = await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    expect(back.products).toMatchObject({ changed: 1, unchanged: 1 });
    expect(sock.removed_at).toBeNull();
  });

  it("writes a changed price on its variant only, with its product's images again", async () => {
    await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    const items = feed();
    items[1] = { ...items[1], price: { amount: 119, currency: 'USD' } };
    const counts = await syncCatalog(BRAND, 'feed', items, { db: fake.db });
    expect(counts.variants).toMatchObject({ changed: 1, unchanged: 3 });
    expect(counts.products).toMatchObject({ unchanged: 2 });
    expect(fake.rows('catalog_variants').find((v) => v.external_id === 'TR-100-BLUE').price).toBe(
      119,
    );
    // The boot's images were written again, once each.
    const bootImages = fake.rows('catalog_images').filter((i) => i.url.includes('/tr-'));
    expect(bootImages).toHaveLength(5);
  });

  it('keeps sources and brands apart', async () => {
    await syncCatalog(BRAND, 'feed', feed(), { db: fake.db });
    const counts = await syncCatalog(BRAND, 'csv', [], { db: fake.db });
    expect(counts.products.removed).toBe(0);
    const other = await syncCatalog('brand-2', 'feed', feed(), { db: fake.db });
    expect(other.products.added).toBe(2);
  });

  it("leaves out an address that isn't http(s), and clips long values", async () => {
    const [item] = feed();
    await syncCatalog(
      BRAND,
      'feed',
      [
        {
          ...item,
          link: 'javascript:alert(1)',
          imageLink: 'ftp://x/y.jpg',
          title: 'x'.repeat(1200),
        },
      ],
      { db: fake.db },
    );
    const [product] = fake.rows('catalog_products');
    expect(product.url).toBeNull();
    expect(product.title).toHaveLength(1000);
    expect(fake.rows('catalog_images').map((i) => i.url)).not.toContain('ftp://x/y.jpg');
  });

  it('imports a 10,000-row CSV, and a second import writes nothing', async () => {
    const lines = ['id,item_group_id,title,link,price,availability,color,product_type'];
    for (let i = 0; i < 10_000; i++) {
      lines.push(
        `P-${i},G-${Math.floor(i / 4)},Item ${Math.floor(i / 4)} - ${i % 4},https://s.example/p/${i},${i}.99 USD,in stock,C${i % 4},Cat ${Math.floor(i / 4) % 10}`,
      );
    }
    const { items } = parseCsvFeed(lines.join('\n'));
    const first = await syncCatalog(BRAND, 'csv', items, { db: fake.db });
    expect(first.products.added).toBe(2_500);
    expect(first.variants.added).toBe(10_000);
    expect(fake.rows('catalog_categories')).toHaveLength(10);
    fake.writes.length = 0;
    await syncCatalog(BRAND, 'csv', items, { db: fake.db });
    expect(fake.writes).toEqual([]);
  });
});
