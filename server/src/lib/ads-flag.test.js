import { afterEach, describe, expect, it, vi } from 'vitest';
import { adsEnabled } from './ads-flag.js';

/**
 * Ads' switch on the API server (ADS-01, in development): ADS_ENABLED alone,
 * off in production, the same truth table as the web's lib/ads/flag.test.ts.
 * No list of workspaces or people turns it on (owner, 2026-11-10).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('adsEnabled', () => {
  it('is off when ADS_ENABLED is unset, as production leaves it', () => {
    vi.stubEnv('ADS_ENABLED', undefined);
    expect(adsEnabled()).toBe(false);
    expect(adsEnabled({})).toBe(false);
  });

  it('is off for anything but "true"', () => {
    for (const value of ['', 'false', '1', 'yes', 'on', 'TRUE', 'True', ' true', 'true ']) {
      vi.stubEnv('ADS_ENABLED', value);
      expect(adsEnabled(), JSON.stringify(value)).toBe(false);
      expect(adsEnabled({ ADS_ENABLED: value }), JSON.stringify(value)).toBe(false);
    }
  });

  it('is on with "true", for local development and preview deployments', () => {
    vi.stubEnv('ADS_ENABLED', 'true');
    expect(adsEnabled()).toBe(true);
    expect(adsEnabled({ ADS_ENABLED: 'true' })).toBe(true);
  });

  it('has no per-workspace list: one of the Chat flag’s kind turns nothing on', () => {
    const orgs = '22222222-2222-4222-8222-222222222222';
    expect(adsEnabled({ ADS_ORGS: orgs, ADS_ENABLED_ORGS: orgs })).toBe(false);
    // Nor does it narrow the switch: on is on for everyone.
    expect(adsEnabled({ ADS_ENABLED: 'true', ADS_ORGS: orgs, ADS_ENABLED_ORGS: orgs })).toBe(true);
  });

  it('reads the variable when asked, not when loaded', () => {
    vi.stubEnv('ADS_ENABLED', 'false');
    expect(adsEnabled()).toBe(false);
    vi.stubEnv('ADS_ENABLED', 'true');
    expect(adsEnabled()).toBe(true);
    vi.stubEnv('ADS_ENABLED', undefined);
    expect(adsEnabled()).toBe(false);
  });
});
