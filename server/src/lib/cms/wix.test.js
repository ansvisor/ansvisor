import { afterEach, describe, expect, it, vi } from 'vitest';

// The harness reaches the Supabase admin client at import time.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { startFakeApi } = await import('../../connectors/testing.js');
const {
  RICOS_CHUNK,
  WixError,
  checkSite,
  createDraftPost,
  readDraftPost,
  ricosChunks,
  siteIdOf,
  toRicos,
  updateDraftPost,
} = await import('./wix.js');

/**
 * Wix's REST API for Send to CMS (#1331, phase 2; 00372): a site checked
 * before its key is kept, a page's HTML turned into Wix's rich content, and
 * draft posts written, against a fake of the API (its answers as Wix's
 * reference shows them). Real keys are tried by the maintainer.
 */

const SITE = '2f8a1c3e-1111-4222-8333-944455556666';
const KEY = 'IST.eyJraWQiOiJQb3pIX2FDMiIsImFsZyI6IlJTMjU2In0.fake-key';
const MEMBER = 'c00e8a5c-322b-4e77-8813-002e3ea7e811';
const POST = '9124f6ef-a537-4bdd-bca3-e7306947deeb';

let api;
afterEach(() => api?.close());

const start = async (routes) => {
  api = await startFakeApi(routes);
  return { base: api.origin, request: api.request };
};

const CONVERT = 'POST /ricos/v1/ricos-document/convert/to-ricos';
const converts = () => ({ json: { document: { nodes: [{ type: 'PARAGRAPH' }] } } });

describe('siteIdOf', () => {
  it("reads the site's id, or the dashboard address it is in", () => {
    expect(siteIdOf(SITE.toUpperCase())).toBe(SITE);
    expect(siteIdOf(`https://manage.wix.com/dashboard/${SITE}/home`)).toBe(SITE);
  });

  it('refuses what has no id', () => {
    expect(() => siteIdOf('my-site.wixsite.com')).toThrow(WixError);
  });
});

describe('checkSite', () => {
  it("checks the Blog and the converter with the key, and takes its newest post's owner and the site's name", async () => {
    const opts = await start({
      'GET /blog/v3/posts': () => ({ json: { posts: [{ id: POST, memberId: MEMBER }] } }),
      [CONVERT]: converts,
      'GET /site-properties/v4/properties': () => ({
        json: { properties: { siteDisplayName: ' Acme Coffee ' } },
      }),
    });

    expect(await checkSite(SITE, KEY, opts)).toEqual({ siteName: 'Acme Coffee', memberId: MEMBER });
    const [first] = api.calls;
    // The key goes as Wix takes it, beside the site's id; never anywhere else.
    expect(first.headers.authorization).toBe(KEY);
    expect(first.headers['wix-site-id']).toBe(SITE);
    expect(first.query).toEqual({ 'paging.limit': '1' });
    // The converter is tried on a line of text: nothing is written to the site.
    expect(api.calls[1]).toMatchObject({
      method: 'POST',
      path: '/ricos/v1/ricos-document/convert/to-ricos',
      body: { html: '<p>x</p>' },
    });
  });

  it('takes a member when the Blog has no post yet, and goes without a name it may not read', async () => {
    const opts = await start({
      'GET /blog/v3/posts': () => ({ json: { posts: [] } }),
      [CONVERT]: converts,
      'POST /members/v1/members/query': () => ({ json: { members: [{ id: MEMBER }] } }),
      'GET /site-properties/v4/properties': () => ({ status: 403, json: {} }),
    });
    expect(await checkSite(SITE, KEY, opts)).toEqual({ siteName: null, memberId: MEMBER });
  });

  it('says what stops it: a refused key, a site with no Blog, no member to own the posts', async () => {
    let opts = await start({ 'GET /blog/v3/posts': () => ({ status: 401, json: {} }) });
    await expect(checkSite(SITE, KEY, opts)).rejects.toMatchObject({ code: 'auth_failed' });
    api.close();

    opts = await start({ 'GET /blog/v3/posts': () => ({ status: 404, json: {} }) });
    await expect(checkSite(SITE, KEY, opts)).rejects.toMatchObject({ code: 'no_blog' });
    api.close();

    opts = await start({
      'GET /blog/v3/posts': () => ({ json: { posts: [] } }),
      [CONVERT]: converts,
      'POST /members/v1/members/query': () => ({ json: { members: [] } }),
    });
    await expect(checkSite(SITE, KEY, opts)).rejects.toMatchObject({ code: 'no_member' });
  });

  it('says the key needs the Ricos permission when the converter refuses it', async () => {
    const opts = await start({
      'GET /blog/v3/posts': () => ({ json: { posts: [{ id: POST, memberId: MEMBER }] } }),
      [CONVERT]: () => ({ status: 403, json: { message: 'PERMISSION_DENIED' } }),
    });
    await expect(checkSite(SITE, KEY, opts)).rejects.toMatchObject({
      code: 'no_ricos_permission',
      message: expect.stringContaining('Manage Ricos Document'),
    });
    // Refused there, nothing else is asked.
    expect(api.calls.map((call) => call.path)).toEqual([
      '/blog/v3/posts',
      '/ricos/v1/ricos-document/convert/to-ricos',
    ]);
  });
});

describe('ricosChunks', () => {
  it('keeps the blocks in order, in pieces Wix converts at once', () => {
    const block = `<p>${'a'.repeat(4000)}</p>`;
    const chunks = ricosChunks(`${block}${block}${block}<h2>End</h2>`);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= RICOS_CHUNK)).toBe(true);
    expect(chunks[1].endsWith('<h2>End</h2>')).toBe(true);
  });

  it('sends a block longer than that as its text, escaped, piece by piece', () => {
    const chunks = ricosChunks(`<table><tr><td>${'x < y & '.repeat(3000)}</td></tr></table>`, 1000);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(chunks.join('')).not.toContain('<table>');
    expect(chunks.join('')).toContain('x &lt; y &amp;');
  });
});

describe('toRicos', () => {
  it("joins each piece's nodes, as Wix's converter gives them", async () => {
    let n = 0;
    const opts = await start({
      'POST /ricos/v1/ricos-document/convert/to-ricos': (req) => ({
        json: {
          document: {
            nodes: [{ type: 'PARAGRAPH', id: `n${(n += 1)}`, html: req.body.html.length }],
          },
        },
      }),
    });
    const block = `<p>${'a'.repeat(6000)}</p>`;
    const doc = await toRicos(SITE, KEY, `${block}${block}`, opts);
    expect(doc.nodes.map((node) => node.id)).toEqual(['n1', 'n2']);
    expect(api.calls[0].body.options.plugins).toContain('HEADING');
  });
});

describe('draft posts', () => {
  it('writes a new draft, never published', async () => {
    const opts = await start({
      'POST /blog/v3/draft-posts': () => ({
        json: {
          draftPost: { id: POST, status: 'UNPUBLISHED', url: 'https://acme.example/post/x' },
        },
      }),
    });
    const post = { title: 'T', richContent: { nodes: [] }, memberId: MEMBER };
    expect(await createDraftPost(SITE, KEY, post, opts)).toEqual({
      id: POST,
      status: 'UNPUBLISHED',
      url: 'https://acme.example/post/x',
    });
    expect(api.calls[0].body).toEqual({ draftPost: post, publish: false, fieldsets: ['URL'] });
  });

  it("reads a draft, null once it's gone", async () => {
    const opts = await start({
      [`GET /blog/v3/draft-posts/${POST}`]: () => ({
        json: {
          draftPost: {
            id: POST,
            status: 'PUBLISHED',
            url: { base: 'https://acme.example/', path: '/post/x' },
          },
        },
      }),
    });
    expect(await readDraftPost(SITE, KEY, POST, opts)).toEqual({
      id: POST,
      status: 'PUBLISHED',
      url: 'https://acme.example/post/x',
    });
    expect(await readDraftPost(SITE, KEY, 'f0000000-0000-4000-8000-000000000000', opts)).toBeNull();
    expect(await readDraftPost(SITE, KEY, 'not-an-id', opts)).toBeNull();
  });

  it("writes a live post's draft version, never the post people read", async () => {
    const opts = await start({
      [`PATCH /blog/v3/draft-posts/${POST}`]: () => ({
        json: { draftPost: { id: POST, status: 'PUBLISHED' } },
      }),
    });
    await updateDraftPost(SITE, KEY, POST, { title: 'T' }, opts);
    await updateDraftPost(SITE, KEY, POST, { title: 'T' }, { ...opts, live: true });
    expect(api.calls.map((call) => call.body.action)).toEqual(['UPDATE', 'UPDATE_PUBLICATION']);
    expect(api.calls[0].body.draftPost).toEqual({ title: 'T', id: POST });
  });
});
