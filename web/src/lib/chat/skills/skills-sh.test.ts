// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findSkillsShSource, isSkillsShUrl } from './skills-sh';

/**
 * A skill's skills.sh page (W4-29): only skills.sh links are read, through
 * the API's guarded fetch, and the skill's folder is found in the
 * repository it names (the API and GitHub both mocked here: no network),
 * or why it couldn't be.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const PAGE = 'https://skills.sh/acme/skills/copy-editing';

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'chat-secret');
});
afterEach(() => vi.unstubAllEnvs());

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

describe('isSkillsShUrl', () => {
  it('takes a skills.sh page over https, and no other directory', () => {
    expect(isSkillsShUrl(PAGE)).toBe(true);
    expect(isSkillsShUrl(' https://www.skills.sh/acme/skills/x ')).toBe(true);
    for (const other of [
      'http://skills.sh/acme/skills/x',
      'https://skills.sh:8443/acme/skills/x',
      'https://user@skills.sh/acme/skills/x',
      'https://evil.skills.sh/x',
      'https://skills.marketing/acme/x',
      'https://github.com/acme/skills',
      'not a link',
    ]) {
      expect(isSkillsShUrl(other), other).toBe(false);
    }
  });
});

describe('findSkillsShSource', () => {
  const SHA = 'a'.repeat(40);
  const GITHUB = 'https://api.github.com/repos/acme/skills';
  /** The API's answer for the page, then GitHub's, by URL: no network. */
  const answers = (
    page: { status?: number; body: unknown },
    routes: Record<string, unknown> = {},
  ) =>
    vi.fn<Fetcher>(async (url) => {
      if (url.endsWith('/api/internal/chat/pages/skill-source')) {
        return Response.json(page.body, { status: page.status ?? 200 });
      }
      return url in routes
        ? new Response(
            typeof routes[url] === 'string' ? (routes[url] as string) : JSON.stringify(routes[url]),
          )
        : new Response('Not Found', { status: 404 });
    });

  it('asks the API’s guarded read for the page, then finds the skill’s folder', async () => {
    const fetch = answers(
      { body: { source: 'https://github.com/acme/skills', skill: 'copy-editing' } },
      {
        [`${GITHUB}/commits/HEAD`]: SHA,
        [`${GITHUB}/contents/skills/copy-editing?ref=${SHA}`]: [{ name: 'SKILL.md', type: 'file' }],
      },
    );
    expect(await findSkillsShSource(` ${PAGE} `, ORG, { fetch, token: null })).toEqual({
      ok: true,
      url: `https://github.com/acme/skills/tree/${SHA}/skills/copy-editing`,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/internal\/chat\/pages\/skill-source$/);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer chat-secret' });
    expect(JSON.parse(String(init?.body))).toEqual({ url: PAGE, orgId: ORG });
  });

  it('takes a link to the skill’s own folder as it is, or a repository with no name', async () => {
    const folder = 'https://github.com/acme/skills/tree/main/copy-editing';
    const fetch = answers({ body: { source: folder, skill: 'copy-editing' } });
    expect(await findSkillsShSource(PAGE, ORG, { fetch })).toEqual({ ok: true, url: folder });
    const unnamed = answers({ body: { source: 'https://github.com/acme/skills', skill: null } });
    expect(await findSkillsShSource(PAGE, ORG, { fetch: unnamed })).toEqual({
      ok: true,
      url: 'https://github.com/acme/skills',
    });
    // GitHub isn't asked for either.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(unnamed).toHaveBeenCalledTimes(1);
  });

  it('says why: no GitHub link, a timeout, unreachable, another reason, no such skill', async () => {
    const find = (status: number, body: unknown) =>
      findSkillsShSource(PAGE, ORG, { fetch: answers({ status, body }) });
    expect(await find(200, { source: null, skill: null })).toEqual({
      ok: false,
      refusal: { code: 'skills_sh_no_github' },
    });
    expect(await find(504, { code: 'timeout' })).toMatchObject({
      refusal: { code: 'page_timeout' },
    });
    expect(await find(502, { code: 'unreachable' })).toMatchObject({
      refusal: { code: 'page_unreachable' },
    });
    expect(await find(429, { code: 'busy' })).toMatchObject({
      refusal: { code: 'page_unreachable' },
    });
    // A redirect off skills.sh, an error page…
    expect(await find(422, { code: 'not_allowed' })).toMatchObject({
      refusal: { code: 'page_failed' },
    });
    await expect(find(500, { code: 'failed' })).rejects.toThrow('returned 500');
    const missing = answers(
      { body: { source: 'https://github.com/acme/skills', skill: 'grill-me' } },
      {
        [`${GITHUB}/commits/HEAD`]: SHA,
        [`${GITHUB}/git/trees/${SHA}?recursive=1`]: { tree: [] },
      },
    );
    expect(await findSkillsShSource(PAGE, ORG, { fetch: missing, token: null })).toEqual({
      ok: false,
      refusal: { code: 'skill_not_in_repo', detail: { name: 'grill-me' } },
    });
  });
});
