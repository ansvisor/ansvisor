import { describe, expect, it, vi } from 'vitest';
import * as cheerio from 'cheerio';

/**
 * Where a page's canonical tag points (AC plan P-11): itself, or a live,
 * indexable page of the same site; read once with the free reader.
 */

const { PageFetchError } = await import('../safe-fetch.js');
const { canonicalHref, canonicalIssue, canonicalKey, probeAuditCanonical, probeCanonical } =
  await import('./canonical.js');

const PAGE = 'https://www.acme.example/pricing/';
const page = (url, html = '<p>ok</p>', status = 200) => ({ url, status, html });

describe('canonicalHref and canonicalKey', () => {
  it('reads the tag, and keys an address by its host without www and its path', () => {
    expect(canonicalHref(cheerio.load('<link rel="canonical" href=" /pricing ">'))).toBe(
      '/pricing',
    );
    expect(canonicalHref(cheerio.load('<link rel="canonical" href="">'))).toBeNull();
    expect(canonicalKey('https://WWW.Acme.example/Pricing/?a=1#x')).toBe(
      'acme.example/Pricing?a=1',
    );
    expect(canonicalKey('mailto:a@b.c')).toBeNull();
  });
});

describe('probeCanonical', () => {
  it('reads nothing for the page itself, another site or no tag', async () => {
    const fetchImpl = vi.fn();
    expect(await probeCanonical(PAGE, '/pricing', { fetchImpl })).toEqual({
      state: 'self',
      target: 'https://www.acme.example/pricing',
    });
    expect(await probeCanonical(PAGE, 'https://other.example/pricing', { fetchImpl })).toEqual({
      state: 'other_host',
      target: 'https://other.example/pricing',
    });
    expect(await probeCanonical(PAGE, null, { fetchImpl })).toBeNull();
    expect(await probeCanonical(PAGE, 'http://[bad', { fetchImpl })).toEqual({ state: 'invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads another page of the site: live, a redirect, noindex, missing or an error', async () => {
    const target = 'https://acme.example/plans';
    const answer = (impl) => probeCanonical(PAGE, '/plans', { fetchImpl: impl });
    expect(await answer(async (url) => page(url))).toEqual({
      state: 'ok',
      target: 'https://www.acme.example/plans',
    });
    expect(await answer(async () => page(`${target}-2026`))).toMatchObject({
      state: 'redirect',
      to: `${target}-2026`,
    });
    expect(
      await answer(async (url) => page(url, '<meta name="robots" content="noindex, follow">')),
    ).toMatchObject({ state: 'noindex' });
    const failing = (status) => async () => {
      throw Object.assign(new PageFetchError('http_error', 'no'), { status });
    };
    expect((await answer(failing(404))).state).toBe('not_found');
    expect(await answer(failing(503))).toMatchObject({ state: 'error_status', status: 503 });
    // A bot wall or a timeout says nothing.
    expect((await answer(failing(403))).state).toBe('unreadable');
    expect((await answer(async () => Promise.reject(new Error('timeout')))).state).toBe(
      'unreadable',
    );
  });
});

describe('probeAuditCanonical', () => {
  it('compares a tag with the page after its redirects, so a redirect to another site pointing to itself is right', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'https://acme.example/old') return page('https://new.example/pricing');
      throw new Error(`unexpected read ${url}`);
    });
    expect(
      await probeAuditCanonical('https://acme.example/old', 'https://new.example/pricing/', {
        fetchImpl,
      }),
    ).toEqual({ state: 'self', target: 'https://new.example/pricing/' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads nothing for the requested address itself', async () => {
    const fetchImpl = vi.fn();
    expect(await probeAuditCanonical(PAGE, '/pricing', { fetchImpl })).toEqual({
      state: 'self',
      target: 'https://www.acme.example/pricing',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('says nothing about another site when the page itself can’t be read', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new PageFetchError('http_error', 'Forbidden', { status: 403 });
    });
    expect(await probeAuditCanonical(PAGE, 'https://other.example/pricing', { fetchImpl })).toEqual(
      { state: 'unreadable', target: 'https://other.example/pricing' },
    );
  });

  it('still flags another site when the page ends on its own site', async () => {
    const fetchImpl = vi.fn(async (url) => page(url));
    expect(await probeAuditCanonical(PAGE, 'https://other.example/pricing', { fetchImpl })).toEqual(
      { state: 'other_host', target: 'https://other.example/pricing' },
    );
  });
});

describe('canonicalIssue', () => {
  it('names a missing tag and a target that is an issue; none for one that is right or unread', () => {
    expect(canonicalIssue({ canonical: null })).toBe('missing');
    expect(canonicalIssue({ canonical: '/x', target: { state: 'redirect' } })).toBe('redirect');
    expect(canonicalIssue({ canonical: '/x', target: { state: 'ok' } })).toBeNull();
    expect(canonicalIssue({ canonical: '/x', target: { state: 'unreadable' } })).toBeNull();
    // Audited before the target was read: only a missing tag is known.
    expect(canonicalIssue({ canonical: '/x' })).toBeNull();
  });
});
