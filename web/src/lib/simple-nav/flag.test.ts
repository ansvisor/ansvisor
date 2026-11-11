import { afterEach, describe, expect, it, vi } from 'vitest';
import { simpleNavEnabled } from './flag';

/**
 * The simplified layout's switch: SIMPLE_NAV alone, off in production until
 * the launch removes it. No list of workspaces or people turns it on.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('simpleNavEnabled', () => {
  it('is off when SIMPLE_NAV is unset, as production leaves it', () => {
    vi.stubEnv('SIMPLE_NAV', undefined);
    expect(simpleNavEnabled()).toBe(false);
  });

  it('is off for anything but "true"', () => {
    for (const value of ['', 'false', '1', 'yes', 'on', 'TRUE', ' true', 'true ']) {
      vi.stubEnv('SIMPLE_NAV', value);
      expect(simpleNavEnabled()).toBe(false);
    }
  });

  it('is on with "true", for local development and preview deployments', () => {
    vi.stubEnv('SIMPLE_NAV', 'true');
    expect(simpleNavEnabled()).toBe(true);
  });

  it('has no per-workspace list: one of the Chat flag’s kind turns nothing on', () => {
    vi.stubEnv('SIMPLE_NAV', undefined);
    vi.stubEnv('SIMPLE_NAV_ORGS', '22222222-2222-4222-8222-222222222222');
    expect(simpleNavEnabled()).toBe(false);
    vi.stubEnv('SIMPLE_NAV', 'true');
    expect(simpleNavEnabled()).toBe(true);
    expect(simpleNavEnabled.length).toBe(0);
  });

  it('is its own switch: Ads on turns nothing on', () => {
    vi.stubEnv('SIMPLE_NAV', undefined);
    vi.stubEnv('ADS_ENABLED', 'true');
    expect(simpleNavEnabled()).toBe(false);
  });

  it('reads the variable when asked, not when loaded', () => {
    vi.stubEnv('SIMPLE_NAV', 'false');
    expect(simpleNavEnabled()).toBe(false);
    vi.stubEnv('SIMPLE_NAV', 'true');
    expect(simpleNavEnabled()).toBe(true);
    vi.stubEnv('SIMPLE_NAV', undefined);
    expect(simpleNavEnabled()).toBe(false);
  });
});
