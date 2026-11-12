import { afterEach, describe, expect, it, vi } from 'vitest';
import { businessHubEnabled } from './flag';

/**
 * The ChatGPT Business Hub switch: BUSINESS_HUB_ENABLED alone, off in
 * production until Business Hub's pages, names and regions are confirmed.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('businessHubEnabled', () => {
  it('is off when BUSINESS_HUB_ENABLED is unset, as production leaves it', () => {
    vi.stubEnv('BUSINESS_HUB_ENABLED', undefined);
    expect(businessHubEnabled()).toBe(false);
  });

  it('is off for anything but "true"', () => {
    for (const value of ['', 'false', '1', 'yes', 'on', 'TRUE', ' true', 'true ']) {
      vi.stubEnv('BUSINESS_HUB_ENABLED', value);
      expect(businessHubEnabled()).toBe(false);
    }
  });

  it('is on with "true", read again each time it is asked', () => {
    vi.stubEnv('BUSINESS_HUB_ENABLED', 'true');
    expect(businessHubEnabled()).toBe(true);
    vi.stubEnv('BUSINESS_HUB_ENABLED', '');
    expect(businessHubEnabled()).toBe(false);
  });
});
