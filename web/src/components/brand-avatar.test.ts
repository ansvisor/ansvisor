/**
 * brand-avatar.test.ts  (issue #759)
 *
 * Tests the pure helpers exported from brand-avatar.tsx.
 * Importing from the real source means these tests fail if the component changes.
 */

import { describe, expect, test } from 'vitest';
import {
  advance,
  getInitials,
  getPrimaryDomain,
  resolveInitialStage,
  resolveUrl,
  type Stage,
} from './brand-avatar';
import { getFaviconUrl } from '../lib/favicon';

// ─── getFaviconUrl ────────────────────────────────────────────────────────────

describe('getFaviconUrl', () => {
  test('returns a Google s2/favicons URL', () => {
    const url = getFaviconUrl('example.com');
    expect(url).toContain('google.com/s2/favicons');
    expect(url).toContain('example.com');
  });

  test('strips https:// prefix from domain', () => {
    const url = getFaviconUrl('https://example.com');
    expect(url).not.toContain('https%3A%2F%2F');
    expect(url).toContain('example.com');
  });

  test('strips path from domain', () => {
    const url = getFaviconUrl('example.com/some/path');
    expect(url).not.toContain('some');
  });

  test('default size is 128', () => {
    const url = getFaviconUrl('example.com');
    expect(url).toContain('sz=128');
  });

  test('custom size is respected', () => {
    const url = getFaviconUrl('example.com', 64);
    expect(url).toContain('sz=64');
  });

  test('empty domain returns empty string', () => {
    expect(getFaviconUrl('')).toBe('');
  });
});

// ─── resolveInitialStage ──────────────────────────────────────────────────────

describe('resolveInitialStage', () => {
  test('manual logo URL → stage is manual', () => {
    expect(resolveInitialStage('https://example.com/logo.png', 'example.com')).toBe('manual');
  });

  test('no manual URL but has primary domain → stage is google', () => {
    expect(resolveInitialStage(undefined, 'example.com')).toBe('google');
  });

  test('no manual URL, no primary domain → stage is fallback (initials)', () => {
    expect(resolveInitialStage(undefined, undefined)).toBe('fallback');
  });

  test('empty string logoUrl treated same as undefined → google', () => {
    const emptyLogo = '' as string | undefined;
    const stage = resolveInitialStage(emptyLogo || undefined, 'example.com');
    expect(stage).toBe('google');
  });
});

// ─── resolveUrl ───────────────────────────────────────────────────────────────

describe('resolveUrl', () => {
  const domain = 'example.com';
  const manualUrl = 'https://cdn.example.com/logo.png';

  test('manual stage → returns manual logoUrl', () => {
    expect(resolveUrl('manual', manualUrl, domain)).toBe(manualUrl);
  });

  test('google stage → returns Google favicon URL for domain', () => {
    const url = resolveUrl('google', undefined, domain);
    expect(url).toContain('google.com/s2/favicons');
    expect(url).toContain(domain);
  });

  test('ico stage → returns /favicon.ico URL', () => {
    expect(resolveUrl('ico', undefined, domain)).toBe(`https://${domain}/favicon.ico`);
  });

  test('fallback stage → returns undefined (show initials)', () => {
    expect(resolveUrl('fallback', undefined, domain)).toBeUndefined();
  });

  test('google stage without domain → returns undefined', () => {
    expect(resolveUrl('google', undefined, undefined)).toBeUndefined();
  });

  test('ico stage without domain → returns undefined', () => {
    expect(resolveUrl('ico', undefined, undefined)).toBeUndefined();
  });
});

// ─── advance ─────────────────────────────────────────────────────────────────

describe('advance (fallback chain)', () => {
  const domain = 'example.com';

  test('manual → google (when domain exists)', () => {
    expect(advance('manual', domain)).toBe('google');
  });

  test('manual → fallback (when no domain)', () => {
    expect(advance('manual', undefined)).toBe('fallback');
  });

  test('google → ico (when domain exists)', () => {
    expect(advance('google', domain)).toBe('ico');
  });

  test('google → fallback (when no domain)', () => {
    expect(advance('google', undefined)).toBe('fallback');
  });

  test('ico → fallback (end of chain)', () => {
    expect(advance('ico', domain)).toBe('fallback');
  });

  test('fallback → fallback (already at bottom)', () => {
    expect(advance('fallback', domain)).toBe('fallback');
  });
});

// ─── Full chain walkthroughs ──────────────────────────────────────────────────

describe('full fallback chain', () => {
  test('brand with manual URL: stays at manual on success', () => {
    const logoUrl = 'https://cdn.acme.com/logo.svg';
    const domain = 'acme.com';
    const stage = resolveInitialStage(logoUrl, domain);
    expect(stage).toBe('manual');
    expect(resolveUrl(stage, logoUrl, domain)).toBe(logoUrl);
  });

  test('brand with no manual URL walks: google → ico → fallback', () => {
    const domain = 'obscure-startup.io';
    let stage = resolveInitialStage(undefined, domain);
    expect(stage).toBe('google');
    expect(resolveUrl(stage, undefined, domain)).toContain('google.com/s2/favicons');

    stage = advance(stage, domain);
    expect(stage).toBe('ico');
    expect(resolveUrl(stage, undefined, domain)).toBe(`https://${domain}/favicon.ico`);

    stage = advance(stage, domain);
    expect(stage).toBe('fallback');
    expect(resolveUrl(stage, undefined, domain)).toBeUndefined();
  });

  test('brand with no domain at all: goes straight to fallback', () => {
    const stage = resolveInitialStage(undefined, undefined);
    expect(stage).toBe('fallback');
    expect(resolveUrl(stage, undefined, undefined)).toBeUndefined();
  });

  test('manual URL fails → falls through entire chain', () => {
    const domain = 'example.com';
    let stage: Stage = 'manual';
    stage = advance(stage, domain);
    expect(stage).toBe('google');
    stage = advance(stage, domain);
    expect(stage).toBe('ico');
    stage = advance(stage, domain);
    expect(stage).toBe('fallback');
  });
});

// ─── getInitials ──────────────────────────────────────────────────────────────

describe('getInitials', () => {
  test('single word → first letter uppercased', () => {
    expect(getInitials('Acme')).toBe('A');
  });

  test('two words → two initials', () => {
    expect(getInitials('Acme Corp')).toBe('AC');
  });

  test('three words → capped at 2', () => {
    expect(getInitials('Acme Big Corp')).toBe('AB');
  });

  test('already uppercase input', () => {
    expect(getInitials('GOOGLE')).toBe('G');
  });

  test('lowercase input → uppercased', () => {
    expect(getInitials('vercel')).toBe('V');
  });
});

// ─── getPrimaryDomain ─────────────────────────────────────────────────────────

describe('getPrimaryDomain', () => {
  test('returns primary domain from list', () => {
    const domains = [
      { domain: 'other.com', isPrimary: false },
      { domain: 'main.com', isPrimary: true },
    ];
    expect(getPrimaryDomain(domains)).toBe('main.com');
  });

  test('returns undefined when no primary', () => {
    expect(getPrimaryDomain([{ domain: 'other.com', isPrimary: false }])).toBeUndefined();
  });

  test('returns undefined for empty array', () => {
    expect(getPrimaryDomain([])).toBeUndefined();
  });

  test('returns undefined for undefined input', () => {
    expect(getPrimaryDomain(undefined)).toBeUndefined();
  });
});
