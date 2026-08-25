/**
 * brand-logo-guard.ts
 *
 * Pure predicate that decides whether a domain save should update logo_url
 * in the database.
 *
 * The design invariant (issue #759):
 *   logo_url = null  →  derived at render time (Google favicon → /favicon.ico → initials)
 *   logo_url = URL   →  a URL the user explicitly chose; never overwritten by domain saves
 *
 * Since derived Google favicon URLs are no longer stored at brand creation,
 * a non-null logo_url always means a manual override. Domain saves must leave
 * it untouched.
 */

interface Domain {
  domain: string;
  isPrimary: boolean;
}

/**
 * Returns true when a domain save should write a new logo_url to the DB.
 *
 * Conditions (both must hold):
 *   1. The primary domain actually changed.
 *   2. The brand has no manually-set logo URL (logo_url is null/undefined).
 *
 * When logo_url is already set the user chose it deliberately — leave it alone.
 */
export function shouldUpdateLogoUrl(
  oldDomains: Domain[],
  newDomains: Domain[],
  currentLogoUrl: string | null | undefined,
): boolean {
  const oldPrimary = oldDomains.find((d) => d.isPrimary)?.domain;
  const newPrimary = newDomains.find((d) => d.isPrimary)?.domain;
  return newPrimary !== oldPrimary && !currentLogoUrl;
}
