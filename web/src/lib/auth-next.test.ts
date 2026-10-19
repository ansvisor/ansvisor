import { describe, expect, it } from 'vitest';
import { DEFAULT_NEXT, nextFromCookie, nextFromRequest, safeNextPath } from './auth-next';

/** After signing in, back to the page asked for — and only to one of ours. */

describe('safeNextPath', () => {
  it('keeps a page on this site, with its query and hash', () => {
    expect(safeNextPath('/dashboard/traffic')).toBe('/dashboard/traffic');
    expect(safeNextPath('/dashboard/settings?tab=notifications')).toBe(
      '/dashboard/settings?tab=notifications',
    );
    expect(safeNextPath('/dashboard/action-center/actions?action=a1#tasks')).toBe(
      '/dashboard/action-center/actions?action=a1#tasks',
    );
  });

  it('sends anything that could leave the site to the dashboard', () => {
    for (const value of [
      null,
      undefined,
      '',
      'dashboard',
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      'https://evil.example/dashboard',
      'javascript:alert(1)',
      '@evil.example',
      '/dash\tboard',
      '/\nevil',
    ]) {
      expect(safeNextPath(value), String(value)).toBe(DEFAULT_NEXT);
    }
  });
});

describe('nextFromRequest', () => {
  it('names the page without its locale prefix, query included', () => {
    expect(nextFromRequest('/dashboard/traffic', '?tab=pages')).toBe(
      '/dashboard/traffic?tab=pages',
    );
    expect(nextFromRequest('/dashboard', '')).toBe('/dashboard');
  });
});

describe('nextFromCookie', () => {
  it('reads the page the OAuth buttons stored, encoded', () => {
    expect(nextFromCookie(encodeURIComponent('/dashboard/traffic?tab=pages'))).toBe(
      '/dashboard/traffic?tab=pages',
    );
    expect(nextFromCookie(undefined)).toBeNull();
    expect(nextFromCookie('%E0%A4%A')).toBeNull();
  });
});
