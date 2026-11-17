import { getPublicApiBaseUrl } from '@/config/api';
import { trackingSnippetTag } from '@/lib/conversion-tracking';
import type { Brand } from '@/types';

/**
 * "Connect your site" (onboarding's new order, PR 3 of 3): setup after
 * purchase (setup-after-purchase.ts) ends on one more, optional screen, once
 * Finish has started the brand's first run: the AI Traffic snippet, to copy
 * into the site's head, with AI Traffic's own Check again. Done and Later
 * both land where Finish lands (setupLanding).
 *
 * A plain module: the onboarding page decides with it.
 */

/** The step's number in onboarding's state and analytics; its name is 'connect_site'. */
export const CONNECT_SITE_STEP = 7;

/**
 * The brand's snippet tag, as AI Traffic shows it (trackingSnippetTag), with
 * conversions when the brand has them on; null without a tracking code or
 * the server's public URL, and then setup lands at once, as before.
 */
export function connectSiteSnippet(
  brand: Pick<Brand, 'trackingCode' | 'conversionsEnabled' | 'conversionsConsent'>,
): string | null {
  const conversions = brand.conversionsEnabled ? (brand.conversionsConsent ?? 'wait') : null;
  return trackingSnippetTag(getPublicApiBaseUrl(), brand.trackingCode, conversions);
}

/**
 * How many steps setup after purchase shows as dots: its five, and "Connect
 * your site" as the sixth when the brand has a snippet to show (assumed
 * until the brand is made: every brand gets a tracking code).
 */
export function setupAfterPurchaseSteps(snippet: string | null, brandMade: boolean): 5 | 6 {
  return !brandMade || snippet != null ? 6 : 5;
}
