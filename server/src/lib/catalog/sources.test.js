import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { PageFetchError } from '../safe-fetch.js';
import { fakeDb } from './__fixtures__/fake-db.js';
import { FEED_MAX_BYTES, FEED_TYPES } from '../../connectors/feed-url/index.js';
import { sourceKey, sweepCatalogSources, syncSource } from './sources.js';

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
});
