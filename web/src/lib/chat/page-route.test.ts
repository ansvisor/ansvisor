import { describe, expect, it } from 'vitest';
import { PROMPTS_SECTIONS } from '@/lib/prompts-routes';
import { pageRoute, samePage } from './page-route';

/**
 * A page's path as Chat matches it against a read's own page (the
 * maintainer's review of 2026-11-17): /dashboard/prompts opens on Tracked
 * Prompts, so it is that page, whose list list_prompts reads.
 */

describe('pageRoute', () => {
  it('reads /dashboard/prompts as Tracked Prompts, with or without its slash', () => {
    expect(pageRoute('/dashboard/prompts')).toBe('/dashboard/prompts/tracked');
    expect(pageRoute(' /dashboard/prompts/ ')).toBe('/dashboard/prompts/tracked');
    expect(pageRoute('/dashboard/prompts/tracked')).toBe('/dashboard/prompts/tracked');
  });

  it("keeps every other path, the Prompts area's other views too", () => {
    for (const section of PROMPTS_SECTIONS) expect(pageRoute(section.href)).toBe(section.href);
    expect(pageRoute('/dashboard/citations/')).toBe('/dashboard/citations');
    expect(pageRoute('/dashboard/prompts/abc-123')).toBe('/dashboard/prompts/abc-123');
    // Not an own property: never a key of Object's prototype.
    expect(pageRoute('constructor')).toBe('constructor');
    expect(pageRoute('')).toBeNull();
    expect(pageRoute(null)).toBeNull();
    expect(pageRoute(undefined)).toBeNull();
  });
});

describe('samePage', () => {
  it('takes /dashboard/prompts for the page list_prompts reads, and nothing else', () => {
    expect(samePage('/dashboard/prompts/tracked', '/dashboard/prompts')).toBe(true);
    expect(samePage('/dashboard/prompts/tracked', '/dashboard/prompts/tracked/')).toBe(true);
    expect(samePage('/dashboard/prompts/topics', '/dashboard/prompts')).toBe(false);
    expect(samePage('/dashboard/prompts/suggestions', '/dashboard/prompts')).toBe(false);
    expect(samePage(undefined, '/dashboard/prompts')).toBe(false);
    expect(samePage(null, null)).toBe(false);
  });
});
