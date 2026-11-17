import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectSiteSnippet, setupAfterPurchaseSteps } from './connect-site';
import { QUEUE_STUB } from '@/lib/conversion-tracking';

/**
 * "Connect your site", setup after purchase's last, optional screen: the
 * brand's snippet tag as AI Traffic shows it, or none, and how many dots
 * setup then shows.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('connectSiteSnippet', () => {
  it("is the brand's tag on the cloud's public API, as AI Traffic shows it", () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    expect(connectSiteSnippet({ trackingCode: 'abc123' })).toBe(
      '<script src="https://api.ansvisor.com/t.js" data-t="abc123" defer></script>',
    );
  });

  it('follows AI visitors to conversions when the brand has them on', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    const tag = connectSiteSnippet({
      trackingCode: 'abc123',
      conversionsEnabled: true,
      conversionsConsent: 'always',
    });
    expect(tag).toContain(QUEUE_STUB);
    expect(tag).toContain('data-c="1" data-consent="always"');
    // Consent waits unless the brand chose otherwise.
    expect(connectSiteSnippet({ trackingCode: 'abc123', conversionsEnabled: true })).toContain(
      'data-consent="wait"',
    );
  });

  it('is null without a tracking code, or without the server URL', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    expect(connectSiteSnippet({ trackingCode: undefined })).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    expect(connectSiteSnippet({ trackingCode: 'abc123' })).toBeNull();
  });
});

describe('setupAfterPurchaseSteps', () => {
  it('shows six dots, "Connect your site" the last, when the brand has a snippet', () => {
    expect(setupAfterPurchaseSteps('<script></script>', true)).toBe(6);
    // Before the brand is made: every brand gets a tracking code.
    expect(setupAfterPurchaseSteps(null, false)).toBe(6);
  });

  it('shows five when the brand has none, and setup lands at Finish', () => {
    expect(setupAfterPurchaseSteps(null, true)).toBe(5);
  });
});
