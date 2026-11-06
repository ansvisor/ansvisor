import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * IndexNow (#2142, part B; 00491): the key, its file at the site's root, and
 * a page announced once when Send to CMS confirms it live. An announcement
 * never throws: a failure is logged with codes only.
 */

const warnings = [];
vi.mock('./logger.js', () => ({ logger: { warn: (...args) => warnings.push(args) } }));
vi.mock('../config/supabase.js', () => ({ default: {} }));

const { PageFetchError } = await import('./safe-fetch.js');
const {
  INDEXNOW_ENDPOINT,
  announcePublishedPage,
  checkKeyFile,
  hostOf,
  keyFileUrl,
  newIndexNowKey,
  readIndexNow,
} = await import('./indexnow.js');

const KEY = '0123456789abcdef0123456789abcdef';
const HOST = 'www.acme.example';
const LIVE = 'https://www.acme.example/blog/cold-brew';
const NOW = new Date('2026-11-06T12:00:00Z');

/** Tables in memory, with the filters the module uses. */
function fakeDb(tables) {
  return {
    from: (name) => {
      const filters = [];
      let patch = null;
      const hit = () =>
        (tables[name] ?? []).filter((row) =>
          filters.every(([op, col, value]) =>
            op === 'is' ? (row[col] ?? null) === value : row[col] === value,
          ),
        );
      const answer = () => {
        if (patch) {
          const rows = hit();
          for (const row of rows) Object.assign(row, patch);
          return { data: rows.map((row) => ({ id: row.id })), error: null };
        }
        return { data: hit(), error: null };
      };
      const chain = {
        select: () => chain,
        update: (fields) => ((patch = fields), chain),
        eq: (col, value) => (filters.push(['eq', col, value]), chain),
        is: (col, value) => (filters.push(['is', col, value]), chain),
        maybeSingle: async () => ({ data: hit()[0] ?? null, error: null }),
        then: (resolve) => resolve(answer()),
      };
      return chain;
    },
  };
}

let tables;
const ping = vi.fn();

beforeEach(() => {
  warnings.length = 0;
  ping.mockReset().mockResolvedValue({ status: 200 });
  tables = {
    content_drafts: [{ id: 'dr1', brand_id: 'b1', indexnow_pinged_at: null }],
    brands: [
      {
        id: 'b1',
        indexnow_key: KEY,
        indexnow_host: HOST,
        indexnow_verified_at: '2026-11-01T00:00:00Z',
      },
    ],
    brand_cms_connections: [],
    brand_domains: [],
  };
});

describe('the key and its file', () => {
  it('is 32 hex characters, its file at the host’s root', () => {
    expect(newIndexNowKey()).toMatch(/^[a-f0-9]{32}$/);
    expect(newIndexNowKey()).not.toBe(newIndexNowKey());
    expect(keyFileUrl(HOST, KEY)).toBe(`https://${HOST}/${KEY}.txt`);
  });

  it('reads a brand domain as a host', () => {
    expect(hostOf('https://WWW.Acme.example/blog?x=1')).toBe('www.acme.example');
    expect(hostOf('acme.example:8080')).toBe('acme.example');
    expect(hostOf('localhost')).toBeNull();
    expect(hostOf('')).toBeNull();
  });

  it('is found when the file holds the key, as plain text, through safe-fetch', async () => {
    const fetch = vi.fn(async () => ({ status: 200, html: `${KEY}\n` }));
    expect(await checkKeyFile(HOST, KEY, { fetch })).toEqual({ state: 'ok', host: HOST });
    expect(fetch).toHaveBeenCalledWith(
      `https://${HOST}/${KEY}.txt`,
      expect.objectContaining({ accept: 'text/plain', types: /^text\/plain\b/i }),
    );
  });

  it('says what it found otherwise: another text, no file, or no answer', async () => {
    expect(
      (await checkKeyFile(HOST, KEY, { fetch: async () => ({ status: 200, html: 'hi' }) })).state,
    ).toBe('mismatch');
    const refusing = (code) => async () => {
      throw new PageFetchError(code, 'no');
    };
    expect((await checkKeyFile(HOST, KEY, { fetch: refusing('http_error') })).state).toBe(
      'not_found',
    );
    // A page in its place (a CMS's 404 page served as HTML) isn't the file.
    expect((await checkKeyFile(HOST, KEY, { fetch: refusing('not_html') })).state).toBe(
      'not_found',
    );
    expect((await checkKeyFile(HOST, KEY, { fetch: refusing('blocked') })).state).toBe(
      'unreachable',
    );
  });

  it('keeps the host the file loaded from after a www redirect, and refuses another site', async () => {
    const redirected = (to) => async () => ({
      url: `https://${to}/${KEY}.txt`,
      status: 200,
      html: KEY,
    });
    expect(
      await checkKeyFile('acme.example', KEY, { fetch: redirected('www.acme.example') }),
    ).toEqual({
      state: 'ok',
      host: 'www.acme.example',
    });
    expect(
      await checkKeyFile('www.acme.example', KEY, { fetch: redirected('acme.example') }),
    ).toEqual({
      state: 'ok',
      host: 'acme.example',
    });
    expect(
      (await checkKeyFile('acme.example', KEY, { fetch: redirected('parked.other.example') }))
        .state,
    ).toBe('not_found');
  });
});

describe('the brand’s IndexNow', () => {
  it('is kept off by a CMS that can’t put a file at the root, and would use the primary domain', async () => {
    tables.brand_cms_connections = [{ brand_id: 'b1', provider: 'wix' }];
    tables.brand_domains = [
      { brand_id: 'b1', domain: 'shop.acme.example', is_primary: false },
      { brand_id: 'b1', domain: 'https://www.acme.example/', is_primary: true },
    ];
    expect(await readIndexNow('b1', { db: fakeDb(tables) })).toEqual({
      key: KEY,
      host: HOST,
      keyUrl: `https://${HOST}/${KEY}.txt`,
      verifiedAt: '2026-11-01T00:00:00Z',
      blockedBy: 'wix',
      domainHost: 'www.acme.example',
    });
  });
});

describe('announcing a page that went live', () => {
  it('tells IndexNow once, with the key’s file, and keeps when', async () => {
    const db = fakeDb(tables);
    expect(
      await announcePublishedPage({ draftId: 'dr1', url: LIVE }, { db, fetch: ping, now: NOW }),
    ).toBe('pinged');
    expect(ping).toHaveBeenCalledWith(
      INDEXNOW_ENDPOINT,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(ping.mock.calls[0][1].body)).toEqual({
      host: HOST,
      key: KEY,
      keyLocation: `https://${HOST}/${KEY}.txt`,
      urlList: [LIVE],
    });
    expect(tables.content_drafts[0].indexnow_pinged_at).toBe(NOW.toISOString());
    // Read as live again: not announced again.
    expect(
      await announcePublishedPage({ draftId: 'dr1', url: LIVE }, { db, fetch: ping, now: NOW }),
    ).toBe('already');
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('announces nothing until the key’s file was found, or for a page on another host', async () => {
    const db = fakeDb(tables);
    tables.brands[0].indexnow_verified_at = null;
    expect(await announcePublishedPage({ draftId: 'dr1', url: LIVE }, { db, fetch: ping })).toBe(
      'off',
    );
    tables.brands[0].indexnow_verified_at = '2026-11-01T00:00:00Z';
    expect(
      await announcePublishedPage(
        { draftId: 'dr1', url: 'https://blog.acme.example/cold-brew' },
        { db, fetch: ping },
      ),
    ).toBe('other_host');
    expect(ping).not.toHaveBeenCalled();
    expect(tables.content_drafts[0].indexnow_pinged_at).toBeNull();
  });

  it('never throws: a refusal or a failed call is logged with codes only', async () => {
    ping.mockResolvedValueOnce({ status: 403 });
    expect(
      await announcePublishedPage(
        { draftId: 'dr1', url: LIVE },
        { db: fakeDb(tables), fetch: ping },
      ),
    ).toBe('failed');
    expect(warnings[0]).toEqual([{ status: 403 }, '[indexnow] the announcement was refused']);

    tables.content_drafts[0].indexnow_pinged_at = null;
    const down = vi.fn(async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    });
    expect(
      await announcePublishedPage(
        { draftId: 'dr1', url: LIVE },
        { db: fakeDb(tables), fetch: down },
      ),
    ).toBe('failed');
    expect(warnings[1]).toEqual([{ code: 'ENOTFOUND' }, '[indexnow] could not announce a page']);
  });
});
