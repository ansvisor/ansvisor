import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { ConnectorHttpError } from '../../connectors/http.js';
import { logger } from '../logger.js';
import { PageFetchError } from '../safe-fetch.js';
import { fakeDb } from './__fixtures__/fake-db.js';
import { saveCredentials } from './credentials.js';
import feedUrl, { FEED_MAX_BYTES, FEED_TYPES } from '../../connectors/feed-url/index.js';
import { redact, sourceKey, sweepCatalogSources, syncSource } from './sources.js';

const fixture = (name) =>
  readFileSync(new URL(`../feeds/__fixtures__/${name}`, import.meta.url), 'utf8');

const SOURCE_ID = '0b8d6a1e-2a3c-4d5e-8f90-123456789abc';
const NOW = new Date('2026-10-25T09:00:00Z');

let fake;
let source;
beforeEach(() => {
  fake = fakeDb();
  source = {
    id: SOURCE_ID,
    brand_id: 'brand-1',
    kind: 'feed_url',
    format: 'auto',
    url: 'https://shop.example/feed.xml',
  };
  fake.rows('catalog_sources').push({ ...source, last_synced_at: null });
});
afterEach(() => {
  delete process.env.IS_CLOUD;
  vi.restoreAllMocks();
});

const kept = () => fake.rows('catalog_sources').find((s) => s.id === SOURCE_ID);

describe('sourceKey', () => {
  it("is the catalog's source: src_ and the id without dashes, as 00279 keys it", () => {
    expect(sourceKey(SOURCE_ID)).toBe('src_0b8d6a1e2a3c4d5e8f90123456789abc');
    expect(sourceKey(SOURCE_ID)).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
  });
});

describe('syncSource', () => {
  it('reads a feed through its connector, safely, and records how it went', async () => {
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    const outcome = await syncSource(source, { db: fake.db, now: NOW, fetch });
    expect(fetch).toHaveBeenCalledWith('https://shop.example/feed.xml', {
      timeoutMs: 60_000,
      maxBytes: FEED_MAX_BYTES,
      types: FEED_TYPES,
      accept: expect.stringContaining('application/xml'),
    });
    expect(outcome).toMatchObject({
      status: 'ok',
      counts: {
        format: 'google_xml',
        items: 4,
        skipped: 0,
        products: { added: 2 },
        variants: { added: 4 },
      },
    });
    expect(kept()).toMatchObject({
      last_synced_at: NOW.toISOString(),
      last_status: 'ok',
      last_error: null,
    });
    // Its products are kept under its own key.
    expect(new Set(fake.rows('catalog_products').map((p) => p.source))).toEqual(
      new Set([sourceKey(SOURCE_ID)]),
    );
  });

  it("imports an upload's text, with the products it skipped and why", async () => {
    const outcome = await syncSource(
      { ...source, kind: 'upload', url: null },
      { db: fake.db, now: NOW, text: fixture('store-export.csv') },
    );
    expect(outcome.counts).toMatchObject({
      format: 'csv',
      items: 2,
      skipped: 1,
      errors: ['Row 3: price is missing.'],
    });
  });

  it("records a feed that couldn't be fetched, in plain words, and writes no product", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(
        new PageFetchError('http_error', 'The page answered 404', { status: 404 }),
      );
    const outcome = await syncSource(source, { db: fake.db, now: NOW, fetch });
    expect(outcome).toEqual({ status: 'failed', error: "The feed's address answered 404." });
    expect(kept()).toMatchObject({ last_status: 'failed', last_counts: null });
    expect(fake.rows('catalog_products')).toEqual([]);
  });

  it("records a file that isn't a feed as a format error, and keeps the products it had", async () => {
    await syncSource(source, {
      db: fake.db,
      now: NOW,
      fetch: async () => ({ html: fixture('google-feed.xml') }),
    });
    const outcome = await syncSource(source, {
      db: fake.db,
      now: NOW,
      fetch: async () => ({ html: 'name,email\nAda,ada@example.com' }),
    });
    expect(outcome.status).toBe('format_error');
    expect(outcome.error).toMatch(/no id, link, price, availability column/);
    // A broken feed doesn't mark the catalog removed.
    expect(fake.rows('catalog_products').every((p) => p.removed_at === null)).toBe(true);
  });
});

describe('syncSource for a store (00282)', () => {
  const STORE_ID = '2c8d6a1e-2a3c-4d5e-8f90-123456789abc';
  const KEY = 'sk_live_store_secret';
  let store;
  let saved;
  const item = {
    id: 'v1',
    itemGroupId: 'p1',
    title: 'Trail Boot',
    description: null,
    link: 'https://shop.example/boot',
    imageLink: null,
    additionalImageLinks: [],
    brand: null,
    gtin: null,
    mpn: null,
    price: { amount: 129, currency: 'USD' },
    salePrice: null,
    availability: 'in_stock',
    condition: null,
    color: null,
    size: null,
    material: null,
    productType: null,
  };
  const connector = (readCatalog) => ({
    kind: 'acme_store',
    label: 'Acme Store',
    fields: [],
    connect: vi.fn(),
    readCatalog: vi.fn(readCatalog),
  });

  beforeEach(() => {
    saved = process.env.CONNECTOR_CREDENTIALS_KEY;
    process.env.CONNECTOR_CREDENTIALS_KEY = randomBytes(32).toString('base64');
    store = { id: STORE_ID, brand_id: 'brand-1', kind: 'acme_store', format: 'auto', url: null };
    fake.rows('catalog_sources').push({ ...store, last_synced_at: null });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CONNECTOR_CREDENTIALS_KEY;
    else process.env.CONNECTOR_CREDENTIALS_KEY = saved;
  });
  const row = () => fake.rows('catalog_sources').find((s) => s.id === STORE_ID);

  it('reads a store with its saved sign-in', async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    const acme = connector(async (_source, ctx) => {
      await ctx.request('https://shop.example/api/products');
      return { items: [item], errors: [], format: 'acme_store' };
    });
    const request = vi.fn().mockResolvedValue({ status: 200, headers: {}, data: null });
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      request,
      connectors: { acme_store: acme },
    });
    expect(acme.readCatalog).toHaveBeenCalledWith(store, {
      request: expect.any(Function),
      credentials: { apiKey: KEY },
    });
    // Every call the read makes carries its deadline.
    expect(request).toHaveBeenCalledWith('https://shop.example/api/products', {
      signal: expect.any(AbortSignal),
    });
    expect(outcome).toMatchObject({ status: 'ok', counts: { format: 'acme_store', items: 1 } });
    expect(fake.rows('catalog_products')).toHaveLength(1);
  });

  it("stops a store's calls at the read's deadline", async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    let signal;
    const acme = connector(async (_source, ctx) => {
      await ctx.request('https://shop.example/api/products');
      return { items: [], errors: [], format: 'acme_store' };
    });
    const request = vi.fn(async (_address, opts) => {
      signal = opts.signal;
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (opts.signal.aborted) {
        throw new ConnectorHttpError('timeout', 'GET shop.example/api/products was stopped');
      }
      return { status: 200, headers: {}, data: null };
    });
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      request,
      readMs: 5,
      connectors: { acme_store: acme },
    });
    expect(signal.aborted).toBe(true);
    expect(outcome).toEqual({ status: 'failed', error: 'The store took too long to answer.' });
  });

  it("doesn't read a source twice at once", async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    let release;
    const acme = connector(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ items: [], errors: [], format: 'acme_store' });
        }),
    );
    const options = { db: fake.db, now: NOW, connectors: { acme_store: acme } };
    const first = syncSource(store, options);
    await vi.waitFor(() => expect(release).toBeDefined());
    await expect(syncSource(store, options)).resolves.toEqual({
      status: 'failed',
      error: 'This source is being read right now. Try again in a minute.',
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 'ok' });
    expect(acme.readCatalog).toHaveBeenCalledTimes(1);
  });

  it("asks for the sign-in again when there's none it can open, and reads nothing", async () => {
    const acme = connector(async () => ({ items: [item], errors: [], format: 'acme_store' }));
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      connectors: { acme_store: acme },
    });
    expect(outcome).toEqual({
      status: 'auth_failed',
      error: "The store's saved sign-in can't be read. Update it in Settings › Integrations.",
    });
    expect(acme.readCatalog).not.toHaveBeenCalled();
    expect(row()).toMatchObject({ last_status: 'auth_failed' });
  });

  it("records the store's refusal, its wait and its errors in plain words", async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    const cases = [
      [
        new ConnectorHttpError('auth', 'GET x/api refused the sign-in (401)', { status: 401 }),
        'auth_failed',
        /refused the saved sign-in/,
      ],
      [
        new ConnectorHttpError('rate_limited', 'GET x/api asked to wait', { status: 429 }),
        'failed',
        /asked to wait/,
      ],
      [
        new ConnectorHttpError('http_error', 'GET x/api answered 500', { status: 500 }),
        'failed',
        /answered 500/,
      ],
    ];
    for (const [err, status, words] of cases) {
      const acme = connector(async () => {
        throw err;
      });
      const outcome = await syncSource(store, {
        db: fake.db,
        now: NOW,
        connectors: { acme_store: acme },
      });
      expect(outcome.status).toBe(status);
      expect(outcome.error).toMatch(words);
    }
  });

  it('keeps the sign-in out of the log when a connector fails on its own', async () => {
    await saveCredentials(STORE_ID, { apiKey: KEY }, { db: fake.db });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const acme = connector(async () => {
      throw new Error(`unexpected answer for key ${KEY}`);
    });
    const outcome = await syncSource(store, {
      db: fake.db,
      now: NOW,
      connectors: { acme_store: acme },
    });
    expect(outcome).toEqual({
      status: 'failed',
      error: "The source couldn't be synced. Try again later.",
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(error.mock.calls)).toContain('[redacted]');
  });

  it('records a kind this server has no connector for', async () => {
    const outcome = await syncSource(store, { db: fake.db, now: NOW, connectors: {} });
    expect(outcome).toEqual({
      status: 'failed',
      error: "This server can't read this kind of source.",
    });
  });
});

describe('redact', () => {
  it('takes every credential value out of a message, but not short ones', () => {
    expect(
      redact('key abcd1234 and secret s3cr3t!', { a: 'abcd1234', b: 's3cr3t!', c: 'ab' }),
    ).toBe('key [redacted] and secret [redacted]');
    expect(redact(undefined, null)).toBe('');
  });
});

describe('sweepCatalogSources', () => {
  it('syncs the due feeds, skipping workspaces without an active subscription on the cloud', async () => {
    process.env.IS_CLOUD = 'true';
    const [first] = fake.rows('catalog_sources');
    first.brands = { organizations: { subscription_status: 'active' } };
    fake.rows('catalog_sources').push({
      id: '1b8d6a1e-2a3c-4d5e-8f90-123456789abc',
      brand_id: 'brand-2',
      kind: 'feed_url',
      format: 'auto',
      url: 'https://other.example/feed.xml',
      last_synced_at: null,
      brands: { organizations: { subscription_status: 'canceled' } },
    });
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    const result = await sweepCatalogSources({ db: fake.db, now: NOW, fetch });
    expect(result).toEqual({ due: 2, synced: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://shop.example/feed.xml');
  });

  it('reads stores too, and never an upload', async () => {
    fake.rows('catalog_sources').push(
      {
        id: '3b8d6a1e-2a3c-4d5e-8f90-123456789abc',
        brand_id: 'brand-1',
        kind: 'upload',
        format: 'auto',
        url: null,
        last_synced_at: null,
      },
      {
        id: '4b8d6a1e-2a3c-4d5e-8f90-123456789abc',
        brand_id: 'brand-1',
        kind: 'acme_store',
        format: 'auto',
        url: null,
        last_synced_at: null,
      },
    );
    const fetch = vi.fn().mockResolvedValue({ html: fixture('google-feed.xml') });
    const result = await sweepCatalogSources({
      db: fake.db,
      now: NOW,
      fetch,
      connectors: { feed_url: feedUrl },
    });
    expect(result).toEqual({ due: 2, synced: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const tried = fake.rows('catalog_sources').filter((s) => s.last_status);
    expect(tried.map((s) => [s.kind, s.last_status]).sort()).toEqual([
      ['acme_store', 'failed'],
      ['feed_url', 'ok'],
    ]);
  });
});
