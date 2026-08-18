import { describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { extractDomain, normalizeCitations, MAX_URL_LENGTH } from './citation-rows.js';

/**
 * What gets written per citation (#732).
 *
 * The stored domain has to group exactly the way the Citations page groups, or
 * the aggregate and the surface disagree about what a domain is — so these
 * pin the rule rather than the implementation.
 */
describe('extractDomain', () => {
  it('lowercases the host and drops www.', () => {
    expect(extractDomain('https://WWW.Example.COM/a/b?c=d')).toBe('example.com');
  });

  it('keeps subdomains other than www', () => {
    expect(extractDomain('https://docs.example.com/guide')).toBe('docs.example.com');
    expect(extractDomain('https://www2.example.com/')).toBe('www2.example.com');
  });

  it('ignores port, path, query and fragment', () => {
    expect(extractDomain('https://example.com:8443/x?y=1#z')).toBe('example.com');
  });

  // 252 of the 2,023,979 citations in production arrive without a scheme.
  // The page counts them today by recovering a hostname-like token, so a
  // writer that dropped them would quietly lower every figure once the page
  // reads these rows instead.
  it('recovers a host from a URL with no scheme', () => {
    expect(extractDomain('example.com/page')).toBe('example.com');
    expect(extractDomain('www.example.com/page')).toBe('example.com');
    expect(extractDomain('WWW.EXAMPLE.COM')).toBe('example.com');
  });

  it('returns null only when there is no host-like token at all', () => {
    for (const bad of ['', '   ', '/relative/path', null, undefined, 42, {}]) {
      expect(extractDomain(bad)).toBeNull();
    }
  });
});

describe('normalizeCitations', () => {
  it('keeps the array index as position', () => {
    const rows = normalizeCitations([
      { url: 'https://a.com/1' },
      { url: 'https://b.com/2' },
      { url: 'https://c.com/3' },
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  // Dropping an entry must not renumber the ones after it: position is half
  // the primary key, so a shifted index would collide with a different
  // citation on a re-run.
  it('preserves the original index when an entry is dropped', () => {
    const rows = normalizeCitations([
      { url: 'https://a.com/1' },
      { url: '/relative/only' },
      { url: 'https://c.com/3' },
    ]);
    expect(rows.map((r) => r.position)).toEqual([0, 2]);
    expect(rows.map((r) => r.domain)).toEqual(['a.com', 'c.com']);
  });

  it('drops entries with no usable URL rather than storing a null domain', () => {
    const rows = normalizeCitations([
      { url: '' },
      { url: '   ' },
      { title: 'no url at all' },
      { url: '/relative/only' },
      null,
      undefined,
    ]);
    expect(rows).toEqual([]);
  });

  it('truncates a URL that would not fit a btree entry', () => {
    const long = `https://example.com/${'x'.repeat(5000)}`;
    const [row] = normalizeCitations([{ url: long }]);
    expect(row.url).toHaveLength(MAX_URL_LENGTH);
    expect(row.domain).toBe('example.com');
  });

  it('trims the title and stores null when it is empty', () => {
    expect(normalizeCitations([{ url: 'https://a.com', title: '  Hello  ' }])[0].title).toBe(
      'Hello',
    );
    expect(normalizeCitations([{ url: 'https://a.com', title: '   ' }])[0].title).toBeNull();
    expect(normalizeCitations([{ url: 'https://a.com' }])[0].title).toBeNull();
  });

  it('returns an empty list for anything that is not an array', () => {
    for (const bad of [null, undefined, {}, 'citations', 7]) {
      expect(normalizeCitations(bad)).toEqual([]);
    }
  });

  // The same page cited twice in one answer is two citations, not one: the
  // page's own count of how often it was cited depends on it.
  it('keeps repeated URLs as separate rows', () => {
    const rows = normalizeCitations([{ url: 'https://a.com/x' }, { url: 'https://a.com/x' }]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
  });
});
