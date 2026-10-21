import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Optimize content › Page URL (Content Editor CE-003): only the brand's own
 * pages are read, and a page that can't be read says why.
 */

// Seeded brands' ids aren't RFC 4122 versions; the route must still take them.
const BRAND = '33333333-3333-3333-3333-333333333333';
let org;
let fetched;
let fetchResult;

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (name) => {
      const result =
        name === 'brands'
          ? { data: { id: BRAND, organization_id: 'o1' }, error: null }
          : {
              data: [{ domain: 'https://www.Northwind.example/' }, { domain: 'northwind.shop' }],
              error: null,
            };
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => result,
        then: (resolve) => resolve(result),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/plan-guard.js', () => ({ getOrgIdForUser: async () => org }));
vi.mock('../lib/safe-fetch.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchPage: async (url) => {
      fetched.push(url);
      if (fetchResult instanceof Error) throw fetchResult;
      return fetchResult;
    },
  };
});

const { default: router } = await import('./content-pages.js');
const { PageFetchError } = await import('../lib/safe-fetch.js');

let server;
let baseUrl;

beforeEach(async () => {
  org = 'o1';
  fetched = [];
  fetchResult = {
    url: 'https://northwind.example/pricing',
    status: 200,
    html: '<main><h1>Pricing</h1><p>Plans</p></main>',
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/content-pages', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content-pages`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const importPage = (url, brandId = BRAND) =>
  fetch(`${baseUrl}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brandId, url }),
  });

describe('POST /api/content-pages/import', () => {
  it('reads a page of the brand’s, a bare host as https, and returns its content', async () => {
    const res = await importPage('blog.northwind.example/pricing');
    expect(res.status).toBe(200);
    expect(fetched).toEqual(['https://blog.northwind.example/pricing']);
    await expect(res.json()).resolves.toEqual({
      url: 'https://northwind.example/pricing',
      title: 'Pricing',
      html: '<h1>Pricing</h1><p>Plans</p>',
    });
  });

  it('reads no page off the brand’s site', async () => {
    for (const url of [
      'https://competitor.example/pricing',
      'https://northwind.example.evil.com/',
    ]) {
      const res = await importPage(url);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'off_site' });
    }
    expect(fetched).toEqual([]);
  });

  it('refuses a page that redirects off the site', async () => {
    fetchResult = { url: 'https://elsewhere.example/', status: 200, html: '<p>x</p>' };
    const res = await importPage('https://northwind.shop/old');
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'off_site' });
  });

  it('says why a page couldn’t be read', async () => {
    fetchResult = new PageFetchError('http_error', 'The page answered 404', { status: 404 });
    let res = await importPage('https://northwind.example/gone');
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'http_error', status: 404 });

    fetchResult = new PageFetchError('timeout', 'slow');
    res = await importPage('https://northwind.example/slow');
    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toMatchObject({ code: 'timeout' });
  });

  it('refuses another organization’s brand, and an id that isn’t one', async () => {
    org = 'o2';
    let res = await importPage('https://northwind.example/pricing');
    expect(res.status).toBe(403);
    res = await importPage('https://northwind.example/pricing', 'nope');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid' });
    expect(fetched).toEqual([]);
  });
});
