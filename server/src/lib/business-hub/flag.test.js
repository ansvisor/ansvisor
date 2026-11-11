import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessHubEnabled, openRegions } from './flag.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('businessHubEnabled', () => {
  it('is on only for "true"', () => {
    expect(businessHubEnabled({ BUSINESS_HUB_ENABLED: 'true' })).toBe(true);
    for (const value of [undefined, '', 'false', '1', 'TRUE', 'yes', ' true']) {
      expect(businessHubEnabled({ BUSINESS_HUB_ENABLED: value })).toBe(false);
    }
  });

  it("reads the process's environment each time it is asked", () => {
    vi.stubEnv('BUSINESS_HUB_ENABLED', '');
    expect(businessHubEnabled()).toBe(false);
    vi.stubEnv('BUSINESS_HUB_ENABLED', 'true');
    expect(businessHubEnabled()).toBe(true);
  });
});

describe('openRegions', () => {
  it('is the US only when unset or empty', () => {
    expect(openRegions({})).toEqual(['US']);
    expect(openRegions({ BUSINESS_HUB_OPEN_REGIONS: '' })).toEqual(['US']);
    expect(openRegions({ BUSINESS_HUB_OPEN_REGIONS: ' , ' })).toEqual(['US']);
  });

  it('reads a comma-separated list as upper-case country codes, once each', () => {
    expect(openRegions({ BUSINESS_HUB_OPEN_REGIONS: 'us, tr ,GB,us' })).toEqual(['US', 'TR', 'GB']);
  });

  it('drops anything that is not a two-letter code, and falls back to the US with none left', () => {
    expect(openRegions({ BUSINESS_HUB_OPEN_REGIONS: 'US,Turkey,T1,DE' })).toEqual(['US', 'DE']);
    expect(openRegions({ BUSINESS_HUB_OPEN_REGIONS: 'everywhere' })).toEqual(['US']);
  });

  it("reads the process's environment by default", () => {
    vi.stubEnv('BUSINESS_HUB_OPEN_REGIONS', 'TR');
    expect(openRegions()).toEqual(['TR']);
  });
});
