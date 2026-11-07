import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The web's Chat engine opens a page server to server with CRON_SECRET: the
 * page as Chat reads it comes back, or why it couldn't be opened; nothing of
 * the page or its address is logged.
 */

class PageFetchError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.status = extra.status;
  }
}
const openPage = vi.fn();
const readSkillsShSource = vi.fn();
vi.mock('../lib/safe-fetch.js', () => ({ PageFetchError }));
vi.mock('../lib/page-open.js', () => ({ openPage: (...args) => openPage(...args) }));
vi.mock('../lib/skills-sh.js', () => ({
  readSkillsShSource: (...args) => readSkillsShSource(...args),
}));

const { default: router } = await import('./internal-chat-pages.js');

let server;
let base;
const logged = vi.fn();
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: logged };
    next();
  });
  app.use('/api/internal/chat/pages', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/internal/chat/pages`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'chat-secret');
  openPage.mockReset();
  readSkillsShSource.mockReset();
  logged.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const ORG = '11111111-1111-4111-8111-111111111111';
const SITES = { hosts: ['acme.example'], domains: ['northwind.example'] };
const ASK = { ...SITES, orgId: ORG };

const post = (body, secret = 'chat-secret', path = '/open') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });

describe('POST /api/internal/chat/pages/open', () => {
  it('answers only with the secret', async () => {
    expect((await post({ url: 'https://acme.example/', ...SITES }, null)).status).toBe(401);
    expect((await post({ url: 'https://acme.example/', ...SITES }, 'nope')).status).toBe(401);
    expect(openPage).not.toHaveBeenCalled();
  });

  it('gives back the page as Chat reads it', async () => {
    openPage.mockResolvedValue({ url: 'https://acme.example/', title: 'Acme', text: 'Hello' });
    const res = await post({ url: ' https://acme.example/ ', ...SITES, orgId: ORG });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      page: { url: 'https://acme.example/', title: 'Acme', text: 'Hello' },
    });
    // Every redirect stays on the run's sites.
    expect(openPage).toHaveBeenCalledWith('https://acme.example/', { sites: SITES });
    // A name that isn't a host name is refused, not passed on as a rule.
    expect(
      (await post({ url: 'https://acme.example/', hosts: ['*.com'], domains: [], orgId: ORG }))
        .status,
    ).toBe(400);
  });

  it('says why a page couldn’t be opened', async () => {
    for (const [code, status] of [
      ['blocked', 400],
      ['not_allowed', 422],
      ['too_many_redirects', 422],
      ['not_html', 422],
      ['too_large', 422],
      ['timeout', 504],
      ['unreachable', 502],
    ]) {
      openPage.mockRejectedValueOnce(new PageFetchError(code, `Because ${code}`));
      const res = await post({ url: 'https://acme.example/', ...ASK });
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code, message: `Because ${code}` });
    }
    expect((await post({ url: '', ...ASK })).status).toBe(400);
    expect((await post({ url: 'https://acme.example/', ...ASK, extra: 1 })).status).toBe(400);
    // The run's sites are always given.
    expect((await post({ url: 'https://acme.example/', orgId: ORG })).status).toBe(400);
    expect((await post({ url: 'https://acme.example/', hosts: [], orgId: ORG })).status).toBe(400);
  });

  it('opens a page only for a named workspace', async () => {
    openPage.mockResolvedValue({ url: 'https://acme.example/' });
    // Without one, every caller would share one workspace's places.
    expect((await post({ url: 'https://acme.example/', ...SITES })).status).toBe(400);
    expect((await post({ url: 'https://acme.example/', ...SITES, orgId: '' })).status).toBe(400);
    expect(
      (await post({ url: 'https://acme.example/', ...SITES, orgId: 'not-a-workspace' })).status,
    ).toBe(400);
    expect(openPage).not.toHaveBeenCalled();
  });

  it('logs a failure without the page or its address', async () => {
    openPage.mockRejectedValue(new Error('parser broke'));
    const res = await post({ url: 'https://secret-customer.example/plan', ...ASK });
    expect(res.status).toBe(500);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-customer');
  });

  it('opens 2 pages at once for a workspace, and says busy to a third', async () => {
    const waits = [];
    openPage.mockImplementation(
      () => new Promise((resolve) => waits.push(() => resolve({ url: 'https://acme.example/' }))),
    );
    const first = post({ url: 'https://acme.example/a', ...SITES, orgId: ORG });
    const second = post({ url: 'https://acme.example/b', ...SITES, orgId: ORG });
    await vi.waitFor(() => expect(waits).toHaveLength(2));
    const third = await post({ url: 'https://acme.example/c', ...SITES, orgId: ORG });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: 'busy' });
    // Another workspace isn't held up.
    const other = post({
      url: 'https://acme.example/d',
      ...SITES,
      orgId: '22222222-2222-4222-8222-222222222222',
    });
    await vi.waitFor(() => expect(waits).toHaveLength(3));
    for (const done of waits) done();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await other).status).toBe(200);
    // Once they're done, the workspace opens pages again.
    openPage.mockResolvedValue({ url: 'https://acme.example/' });
    expect((await post({ url: 'https://acme.example/e', ...SITES, orgId: ORG })).status).toBe(200);
  });

  it('frees a workspace’s place once a page fails, refused or broken', async () => {
    openPage.mockRejectedValueOnce(new PageFetchError('timeout', 'slow'));
    openPage.mockRejectedValueOnce(new Error('parser broke'));
    openPage.mockRejectedValueOnce(new PageFetchError('blocked', 'no'));
    expect((await post({ url: 'https://acme.example/a', ...SITES, orgId: ORG })).status).toBe(504);
    expect((await post({ url: 'https://acme.example/b', ...SITES, orgId: ORG })).status).toBe(500);
    expect((await post({ url: 'https://acme.example/c', ...SITES, orgId: ORG })).status).toBe(400);
    // Three failures in a row, and the workspace still opens two at once.
    const waits = [];
    openPage.mockImplementation(
      () => new Promise((resolve) => waits.push(() => resolve({ url: 'https://acme.example/' }))),
    );
    const first = post({ url: 'https://acme.example/d', ...SITES, orgId: ORG });
    const second = post({ url: 'https://acme.example/e', ...SITES, orgId: ORG });
    await vi.waitFor(() => expect(waits).toHaveLength(2));
    for (const done of waits) done();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });
});

describe('POST /api/internal/chat/pages/skill-source', () => {
  const PAGE = 'https://skills.sh/acme/skills/copy-editing';
  const ask = (body, secret = 'chat-secret') => post(body, secret, '/skill-source');

  it('gives back the skill’s github.com link and name from its skills.sh page', async () => {
    expect((await ask({ url: PAGE, orgId: ORG }, null)).status).toBe(401);
    const found = { source: 'https://github.com/acme/skills', skill: 'copy-editing' };
    readSkillsShSource.mockResolvedValueOnce(found);
    const res = await ask({ url: ` ${PAGE} `, orgId: ORG });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(found);
    expect(readSkillsShSource).toHaveBeenCalledWith(PAGE);
    readSkillsShSource.mockResolvedValueOnce({ source: null, skill: null });
    expect(await (await ask({ url: PAGE, orgId: ORG })).json()).toEqual({
      source: null,
      skill: null,
    });
  });

  it('says why the page couldn’t be read, and needs a workspace', async () => {
    readSkillsShSource.mockRejectedValueOnce(new PageFetchError('timeout', 'slow'));
    expect((await ask({ url: PAGE, orgId: ORG })).status).toBe(504);
    readSkillsShSource.mockRejectedValueOnce(new PageFetchError('not_allowed', 'off skills.sh'));
    const off = await ask({ url: 'https://skills.marketing/x', orgId: ORG });
    expect(off.status).toBe(422);
    expect(await off.json()).toMatchObject({ code: 'not_allowed' });
    expect((await ask({ url: PAGE })).status).toBe(400);
    expect((await ask({ url: PAGE, orgId: ORG, hosts: [] })).status).toBe(400);
    expect(readSkillsShSource).toHaveBeenCalledTimes(2);
  });
});
