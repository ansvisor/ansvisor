import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

import example from '../../connectors/__example__/index.js';
import { startFakeApi } from '../../connectors/testing.js';
import { logger } from '../logger.js';
import { fakeDb } from './__fixtures__/fake-db.js';
import { readCredentials } from './credentials.js';
import { StoreError, connectStore, disconnectStore, readInput, reconnectStore } from './stores.js';

/** Connecting a store, replacing its sign-in and removing it (#1263, 00282). */

const BRAND = 'brand-1';
const KEY = 'ex_live_0123456789abcdef';
const connectors = { example_store: example };

let api;
let fake;
let saved;
beforeEach(async () => {
  saved = process.env.CONNECTOR_CREDENTIALS_KEY;
  process.env.CONNECTOR_CREDENTIALS_KEY = randomBytes(32).toString('base64');
  fake = fakeDb();
  api = await startFakeApi({
    'GET /api/shop': (req) =>
      req.headers.authorization === `Bearer ${KEY}` ||
      req.headers.authorization === 'Bearer ex_new_key'
        ? { json: { domain: 'shop.example', name: 'Acme Outdoor' } }
        : { status: 401 },
  });
});
afterEach(async () => {
  await api.close();
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.CONNECTOR_CREDENTIALS_KEY;
  else process.env.CONNECTOR_CREDENTIALS_KEY = saved;
});

const opts = () => ({ db: fake.db, connectors, request: api.request });
const connect = (input = { url: api.origin, apiKey: KEY }) =>
  connectStore({ brandId: BRAND, kind: 'example_store', input, userId: 'user-1' }, opts());

describe('readInput', () => {
  it("keeps the connector's fields only, as strings", () => {
    expect(readInput(example, { url: 'https://s.example', apiKey: 'k', other: 'x' })).toEqual({
      url: 'https://s.example',
      apiKey: 'k',
    });
    expect(readInput(example, {})).toEqual({ url: '', apiKey: '' });
    expect(() => readInput(example, { apiKey: 'x'.repeat(2001) })).toThrow(StoreError);
    expect(() => readInput(example, null)).toThrow(StoreError);
  });
});

describe('connectStore', () => {
  it('makes the source with its account, and keeps the sign-in sealed', async () => {
    const source = await connect();
    expect(source).toMatchObject({
      brand_id: BRAND,
      kind: 'example_store',
      account: 'shop.example',
      url: api.origin,
      label: 'Acme Outdoor',
    });
    expect(fake.rows('catalog_sources')[0]).toMatchObject({ created_by: 'user-1' });
    const [row] = fake.rows('catalog_source_credentials');
    expect(row).toMatchObject({ source_id: source.id, set_by: 'user-1' });
    expect(row.secret).not.toContain(KEY);
    await expect(readCredentials(source.id, { db: fake.db })).resolves.toEqual({ apiKey: KEY });
  });

  it('says why it connected nothing', async () => {
    const cases = [
      [() => connect({ url: 'nope', apiKey: KEY }), 400, 'connect_failed'],
      [() => connect({ url: api.origin, apiKey: 'wrong' }), 400, 'auth_failed'],
      [() => connect({ url: 'http://127.0.0.1/', apiKey: KEY }), 400, 'connect_failed'],
      [
        () =>
          connectStore({ brandId: BRAND, kind: 'feed_url', input: {}, userId: 'user-1' }, opts()),
        404,
        'not_found',
      ],
    ];
    for (const [run, status, code] of cases) {
      await expect(run()).rejects.toMatchObject({ status, code });
    }
    expect(fake.rows('catalog_sources')).toEqual([]);
    expect(fake.rows('catalog_source_credentials')).toEqual([]);
  });

  it('connects nothing on a server that has no key for sign-ins', async () => {
    delete process.env.CONNECTOR_CREDENTIALS_KEY;
    await expect(connect()).rejects.toMatchObject({ status: 503, code: 'not_configured' });
    expect(api.calls).toEqual([]);
  });

  it('connects a store once a brand', async () => {
    await connect();
    await expect(connect()).rejects.toMatchObject({ status: 409, code: 'duplicate' });
    expect(fake.rows('catalog_sources')).toHaveLength(1);
  });

  it("logs only a broken connector's error name, never what the person typed", async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const broken = {
      ...example,
      connect: async (input) => {
        throw new TypeError(`cannot read ${input.apiKey}`);
      },
    };
    await expect(
      connectStore(
        {
          brandId: BRAND,
          kind: 'example_store',
          input: { url: api.origin, apiKey: KEY },
          userId: 'u',
        },
        { ...opts(), connectors: { example_store: broken } },
      ),
    ).rejects.toMatchObject({ status: 502, code: 'unreachable' });
    expect(JSON.stringify(error.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(error.mock.calls)).toContain('TypeError');
  });
});

describe('reconnectStore', () => {
  it('replaces the sign-in of the same store, and clears the last refusal', async () => {
    const source = await connect();
    fake.rows('catalog_sources')[0].last_status = 'auth_failed';
    await reconnectStore(
      { source, input: { url: api.origin, apiKey: 'ex_new_key' }, userId: 'user-2' },
      opts(),
    );
    await expect(readCredentials(source.id, { db: fake.db })).resolves.toEqual({
      apiKey: 'ex_new_key',
    });
    expect(fake.rows('catalog_sources')[0]).toMatchObject({ last_status: null, last_error: null });
    expect(fake.rows('catalog_source_credentials')[0]).toMatchObject({ set_by: 'user-2' });
  });

  it("won't swap one store for another under the same source", async () => {
    const source = await connect();
    await expect(
      reconnectStore(
        {
          source: { ...source, account: 'other.example' },
          input: { url: api.origin, apiKey: KEY },
        },
        opts(),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'other_account' });
  });
});

describe('disconnectStore', () => {
  it('revokes the sign-in at the store, best effort, then removes the source', async () => {
    const source = await connect();
    const disconnect = vi.fn().mockRejectedValue(new Error('store down'));
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await disconnectStore(source, {
      ...opts(),
      connectors: { example_store: { ...example, disconnect } },
    });
    expect(disconnect).toHaveBeenCalledWith(source, {
      request: api.request,
      credentials: { apiKey: KEY },
    });
    expect(fake.rows('catalog_sources')).toEqual([]);
  });
});
