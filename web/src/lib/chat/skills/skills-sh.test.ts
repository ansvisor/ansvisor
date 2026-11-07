// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findSkillsShSource, isSkillsShUrl } from './skills-sh';

/**
 * A skill's skills.sh page (W4-29): only skills.sh links are read, through
 * the API's guarded fetch (mocked here: no network), and its GitHub link
 * comes back, or why it couldn't.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const PAGE = 'https://skills.sh/acme/skills/copy-editing';

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'chat-secret');
});
afterEach(() => vi.unstubAllEnvs());

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const answer = (status: number, body: unknown) =>
  vi.fn<Fetcher>(async () => Response.json(body, { status }));

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
  it('asks the API’s guarded read for the page’s GitHub link', async () => {
    const fetch = answer(200, { source: 'https://github.com/acme/skills/tree/main/copy-editing' });
    expect(await findSkillsShSource(` ${PAGE} `, ORG, { fetch })).toEqual({
      ok: true,
      url: 'https://github.com/acme/skills/tree/main/copy-editing',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/internal\/chat\/pages\/skill-source$/);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer chat-secret' });
    expect(JSON.parse(String(init?.body))).toEqual({ url: PAGE, orgId: ORG });
  });

  it('says why: no GitHub link, a timeout, unreachable, or another reason', async () => {
    const find = (status: number, body: unknown) =>
      findSkillsShSource(PAGE, ORG, { fetch: answer(status, body) });
    expect(await find(200, { source: null })).toEqual({
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
  });
});
