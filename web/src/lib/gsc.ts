/**
 * Google Search Console property matching (#642).
 *
 * A GSC property is either a URL-prefix ("https://www.example.com/") or a
 * domain property ("sc-domain:example.com"). A brand knows its domains
 * (brand_domains). Auto-mapping picks the property that matches a brand
 * domain — and only auto-applies when the match is unambiguous.
 */

function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

/** True when the property covers the given (normalized) brand domain. */
export function propertyMatchesDomain(siteUrl: string, domain: string): boolean {
  const host = normalizeHost(domain);
  if (!host) return false;

  if (siteUrl.startsWith('sc-domain:')) {
    // Domain properties cover the apex and every subdomain.
    const apex = siteUrl.slice('sc-domain:'.length).trim().toLowerCase();
    return host === apex || host.endsWith(`.${apex}`);
  }

  return normalizeHost(siteUrl) === host;
}

/**
 * The single property matching any of the brand's domains, or null when
 * none or several match (ambiguity needs a human pick).
 */
export function matchGscProperty(propertyUrls: string[], brandDomains: string[]): string | null {
  const matches = propertyUrls.filter((siteUrl) =>
    brandDomains.some((domain) => propertyMatchesDomain(siteUrl, domain)),
  );
  return matches.length === 1 ? matches[0] : null;
}
