import { describe, expect, it } from 'vitest';
import { canonicalAuditUrl, preferredAuditUrl } from './audit-address.js';

describe('canonicalAuditUrl', () => {
  it('adopts the canonical address of the same page on the www host', () => {
    expect(
      canonicalAuditUrl('https://ansvisor.com/pricing', 'https://www.ansvisor.com/pricing'),
    ).toBe('https://www.ansvisor.com/pricing');
  });

  it('resolves a relative canonical against the address fetched', () => {
    expect(canonicalAuditUrl('https://acme.com/a/', '/a')).toBe('https://acme.com/a');
  });

  it('drops a query and fragment from the canonical', () => {
    expect(canonicalAuditUrl('https://acme.com/a', 'https://www.acme.com/a?ref=x#top')).toBe(
      'https://www.acme.com/a',
    );
  });

  it('keeps the address fetched when there is no tag', () => {
    expect(canonicalAuditUrl('https://acme.com/a', null)).toBe('https://acme.com/a');
  });

  it('keeps the address fetched when the canonical is another page or another site', () => {
    expect(canonicalAuditUrl('https://acme.com/a', 'https://acme.com/b')).toBe(
      'https://acme.com/a',
    );
    expect(canonicalAuditUrl('https://acme.com/a', 'https://other.com/a')).toBe(
      'https://acme.com/a',
    );
  });

  it('keeps the address fetched when the canonical is not an address', () => {
    expect(canonicalAuditUrl('https://acme.com/a', 'javascript:void(0)')).toBe(
      'https://acme.com/a',
    );
    expect(canonicalAuditUrl('not a url', 'https://acme.com/a')).toBe('not a url');
  });
});

describe('preferredAuditUrl', () => {
  it('moves a non-www address to the www host the site is known to use', () => {
    expect(
      preferredAuditUrl('https://ansvisor.com/pricing', ['https://www.ansvisor.com/blog']),
    ).toBe('https://www.ansvisor.com/pricing');
  });

  it('moves a www address to a known non-www host', () => {
    expect(preferredAuditUrl('https://www.acme.com/a?x=1', ['https://acme.com/'])).toBe(
      'https://acme.com/a?x=1',
    );
  });

  it('takes a stored domain given as a bare host', () => {
    expect(preferredAuditUrl('https://acme.com/a', ['www.acme.com'])).toBe(
      'https://www.acme.com/a',
    );
  });

  it('uses the first known host that matches, newest first', () => {
    expect(
      preferredAuditUrl('https://acme.com/a', [
        'https://other.com/',
        'https://www.acme.com/x',
        'acme.com',
      ]),
    ).toBe('https://www.acme.com/a');
  });

  it('leaves an address alone when nothing is known, or it is on another site', () => {
    expect(preferredAuditUrl('https://acme.com/a', [])).toBe('https://acme.com/a');
    expect(preferredAuditUrl('https://rival.com/a', ['https://www.acme.com/'])).toBe(
      'https://rival.com/a',
    );
  });

  it('never matches a different subdomain', () => {
    expect(preferredAuditUrl('https://blog.acme.com/a', ['https://www.acme.com/'])).toBe(
      'https://blog.acme.com/a',
    );
  });
});
