/**
 * A brand's site trust (Content Editor Quality spec §8, CE-043), as the API
 * reads it (site-trust.js, site_trust 00254): five site-level checks, shown
 * in Site Audit as "Site trust {n}/5" and worth 5 Trust points on every page.
 */

export const SITE_TRUST_CHECKS = [
  'about',
  'contact',
  'editorial',
  'organizationSchema',
  'authorPages',
] as const;
export type SiteTrustCheck = (typeof SITE_TRUST_CHECKS)[number];

export interface SiteTrust {
  checks: Record<Exclude<SiteTrustCheck, 'authorPages'>, { ok: boolean; url: string | null }> & {
    authorPages: { ok: boolean; authors: { name: string; url: string | null }[] };
  };
  /** How many of the five pass. */
  score: number;
  checkedAt: string;
}

/** Where Quality's "Fix in Site Audit" goes: the card in Site Audit. */
export const SITE_TRUST_PATH = '/dashboard/audit#site-trust';

/** The checks that don't pass, in order. */
export function siteTrustMissing(trust: SiteTrust): SiteTrustCheck[] {
  return SITE_TRUST_CHECKS.filter((check) => !trust.checks[check]?.ok);
}
