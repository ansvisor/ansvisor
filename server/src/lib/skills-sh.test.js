import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A skill's skills.sh page (Chat Wave 4 W4-29): read through safe-fetch on
 * skills.sh only, its github.com source link found; no network here.
 */

const fetchPage = vi.fn();
vi.mock('./safe-fetch.js', () => ({ fetchPage: (...args) => fetchPage(...args) }));

const { githubSourceIn, isSkillsShUrl, readSkillsShSource } = await import('./skills-sh.js');

const PAGE = 'https://skills.sh/acme/skills/copy-editing';
const html = (body) => `<!doctype html><html><body>${body}</body></html>`;

beforeEach(() => {
  fetchPage.mockReset();
});

describe('isSkillsShUrl', () => {
  it('takes skills.sh over https only', () => {
    expect(isSkillsShUrl(new URL(PAGE))).toBe(true);
    expect(isSkillsShUrl(new URL('https://www.skills.sh/acme/skills/x'))).toBe(true);
    for (const other of [
      'http://skills.sh/acme/skills/x',
      'https://skills.sh:8443/acme/skills/x',
      'https://user:pw@skills.sh/acme/skills/x',
      'https://evil.skills.sh/acme/skills/x',
      'https://skills.sh.evil.example/x',
      'https://skills.marketing/acme/x',
    ]) {
      expect(isSkillsShUrl(new URL(other)), other).toBe(false);
    }
  });
});

describe('githubSourceIn', () => {
  it('takes the link named as the source, a skill’s folder before its repository', () => {
    const page = html(`
      <a href="https://github.com/someone/else/tree/main/other">a related skill</a>
      <a href="https://github.com/acme/skills">Repository</a>
      <a href="https://github.com/acme/skills/blob/main/copy-editing/SKILL.md?plain=1#L1">View on GitHub</a>
    `);
    expect(githubSourceIn(page, PAGE)).toBe(
      'https://github.com/acme/skills/blob/main/copy-editing/SKILL.md',
    );
  });

  it('turns a repository’s root into its folder link into the same repository', () => {
    const page = html(`
      <a href="https://www.github.com/acme/skills/">Source</a>
      <a href="https://github.com/acme/skills/tree/v1.2/copy-editing">copy-editing</a>
    `);
    expect(githubSourceIn(page, PAGE)).toBe(
      'https://github.com/acme/skills/tree/v1.2/copy-editing',
    );
    expect(githubSourceIn(html('<a href="https://github.com/acme/skills">GitHub</a>'), PAGE)).toBe(
      'https://github.com/acme/skills',
    );
  });

  it('leaves out the site’s own menus, GitHub’s pages and other files', () => {
    const page = html(`
      <header><a href="https://github.com/vercel-labs/skills">GitHub</a></header>
      <nav><a href="https://github.com/vercel-labs/skills">Repo</a></nav>
      <a href="https://github.com/login">Sign in</a>
      <a href="https://github.com/acme/skills/issues/1">Issue</a>
      <a href="https://github.com/acme/skills/blob/main/README.md">Readme</a>
      <a href="http://github.com/acme/skills">Insecure</a>
      <a href="/acme/skills/other">Another skill</a>
      <footer><a href="https://github.com/vercel-labs/skills">Source</a></footer>
    `);
    expect(githubSourceIn(page, PAGE)).toBeNull();
    expect(githubSourceIn(html('<p>No links</p>'), PAGE)).toBeNull();
  });
});

describe('readSkillsShSource', () => {
  it('reads the page through safe-fetch, on skills.sh only', async () => {
    fetchPage.mockResolvedValue({
      url: PAGE,
      status: 200,
      html: html('<a href="https://github.com/acme/skills/tree/main/copy-editing">Source</a>'),
    });
    expect(await readSkillsShSource(PAGE)).toBe(
      'https://github.com/acme/skills/tree/main/copy-editing',
    );
    const [address, opts] = fetchPage.mock.calls[0];
    expect(address).toBe(PAGE);
    expect(opts).toMatchObject({ timeoutMs: 10_000, maxBytes: 1024 * 1024, maxRedirects: 3 });
    // The first address and every redirect's stay on skills.sh.
    expect(opts.allowUrl(new URL(PAGE))).toBe(true);
    expect(opts.allowUrl(new URL('https://github.com/acme/skills'))).toBe(false);
    expect(opts.allowUrl(new URL('https://skills.marketing/acme/x'))).toBe(false);
  });

  it('passes safe-fetch’s refusal on', async () => {
    const refusal = Object.assign(new Error('slow'), { code: 'timeout' });
    fetchPage.mockRejectedValue(refusal);
    await expect(readSkillsShSource(PAGE)).rejects.toBe(refusal);
  });
});
