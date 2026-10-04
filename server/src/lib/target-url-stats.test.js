import { describe, expect, it } from 'vitest';

import { normalizeUrlForMatch } from './target-url-stats.js';

describe('normalizeUrlForMatch', () => {
  it('normalizes protocol, www, query strings, and trailing slashes', () => {
    expect(normalizeUrlForMatch('https://www.example.com/blog/x?a=1')).toBe(
      'example.com/blog/x',
    );
    expect(normalizeUrlForMatch('http://example.com/blog/x/')).toBe('example.com/blog/x');
  });

  it('ignores fragments, lowercases the host, and strips repeated trailing slashes', () => {
    expect(normalizeUrlForMatch('HTTPS://WWW.Example.COM/Blog/X///#section')).toBe(
      'example.com/Blog/X',
    );
  });

  it('removes the root path slash', () => {
    expect(normalizeUrlForMatch('https://example.com/')).toBe('example.com');
    expect(normalizeUrlForMatch('https://example.com///')).toBe('example.com');
  });

  it.each([null, '', 123, {}, [], undefined])(
    'returns null for invalid input: %j',
    (value) => {
      expect(normalizeUrlForMatch(value)).toBeNull();
    },
  );

  it('trims surrounding whitespace before parsing', () => {
    expect(normalizeUrlForMatch('  https://www.example.com/path  ')).toBe(
      'example.com/path',
    );
  });
});
