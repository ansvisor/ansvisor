// @vitest-environment node
import { isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Ads' page (ADS-01), in development: there only with ADS_ENABLED on, for
 * everyone or for no one; otherwise not found, on the server, before anything
 * of it is drawn.
 */

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
);
vi.mock('next/navigation', () => ({ notFound }));
vi.mock('./_ads-view', () => ({ AdsView: () => null }));

const page = await import('./page');
const { AdsView } = await import('./_ads-view');

afterEach(() => {
  vi.unstubAllEnvs();
  notFound.mockClear();
});

describe('the Ads page', () => {
  it('is not found while ADS_ENABLED is unset, as in production', () => {
    vi.stubEnv('ADS_ENABLED', undefined);
    expect(() => page.default()).toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('is not found for any value but "true"', () => {
    for (const value of ['', 'false', '1', 'TRUE']) {
      vi.stubEnv('ADS_ENABLED', value);
      expect(() => page.default()).toThrow('NEXT_NOT_FOUND');
    }
  });

  it('draws the Ads view with ADS_ENABLED on', () => {
    vi.stubEnv('ADS_ENABLED', 'true');
    const element = page.default();
    expect(notFound).not.toHaveBeenCalled();
    expect(isValidElement(element) && element.type).toBe(AdsView);
  });

  it('reads the flag on each request, never from the build', () => {
    expect(page.dynamic).toBe('force-dynamic');
  });
});
