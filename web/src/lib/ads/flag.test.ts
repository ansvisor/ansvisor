import { afterEach, describe, expect, it, vi } from 'vitest';
import { adsEnabled } from './flag';

/**
 * Ads' switch (ADS-01, in development): ADS_ENABLED alone, off in
 * production. No list of workspaces or people turns it on (owner, 2026-11-10).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('adsEnabled', () => {
  it('is off when ADS_ENABLED is unset, as production leaves it', () => {
    vi.stubEnv('ADS_ENABLED', undefined);
    expect(adsEnabled()).toBe(false);
  });

  it('is off for anything but "true"', () => {
    for (const value of ['', 'false', '1', 'yes', 'on', 'TRUE', ' true', 'true ']) {
      vi.stubEnv('ADS_ENABLED', value);
      expect(adsEnabled()).toBe(false);
    }
  });

  it('is on with "true", for local development and preview deployments', () => {
    vi.stubEnv('ADS_ENABLED', 'true');
    expect(adsEnabled()).toBe(true);
  });

  it('has no per-workspace list: one of the Chat flag’s kind turns nothing on', () => {
    vi.stubEnv('ADS_ENABLED', undefined);
    vi.stubEnv('ADS_ORGS', '22222222-2222-4222-8222-222222222222');
    vi.stubEnv('ADS_ENABLED_ORGS', '22222222-2222-4222-8222-222222222222');
    expect(adsEnabled()).toBe(false);
    // Nor does it narrow the switch: on is on for everyone.
    vi.stubEnv('ADS_ENABLED', 'true');
    expect(adsEnabled()).toBe(true);
    expect(adsEnabled.length).toBe(0);
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
