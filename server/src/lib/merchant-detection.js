/**
 * Classifies merchant destination URLs from AI shopping product cards (#1186).
 *
 * Categorizes a destination URL as:
 * - 'own': the brand's own storefront (matches brandDomains or subdomain)
 * - 'marketplace': a known e-commerce marketplace (Amazon, eBay, Walmart, etc.)
 * - 'reseller': any other retailer or unknown merchant host
 *
 * Extracts standard marketplace product listing IDs (Amazon ASIN, eBay item ID,
 * Walmart item ID, Etsy listing ID) and resolves affiliate/redirect links
 * (e.g. s.click.aliexpress.com, goto.walmart.com) by classifying their destination.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const marketplaces = require('./marketplaces.json');

export const MARKETPLACES = marketplaces;

const REDIRECT_PARAM_CANDIDATES = [
  'dl_target_url',
  'u',
  'url',
  'target_url',
  'target',
  'dest',
  'destination',
  'redirect_url',
  'redirect',
  'link',
  'r',
];

function normalizeHost(host) {
  if (typeof host !== 'string') return '';
  return host
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

function hostMatches(hostname, targetDomain) {
  const normHost = normalizeHost(hostname);
  const normTarget = normalizeHost(targetDomain);
  if (!normHost || !normTarget) return false;
  return normHost === normTarget || normHost.endsWith(`.${normTarget}`);
}

function isValidHttpUrl(str) {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractListingId(marketplace, parsedUrl) {
  const pathname = parsedUrl.pathname;
  if (!pathname) return null;

  switch (marketplace) {
    case 'amazon': {
      // Amazon ASIN from /dp/<ASIN> or /gp/product/<ASIN>. An ASIN is 10 letters or digits; book ASINs are all digits.
      const match = pathname.match(/(?:\/|^)(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:\/|$)/i);
      return match ? match[1] : null;
    }
    case 'ebay': {
      // eBay item id from /itm/<id>
      const match = pathname.match(/\/itm\/(?:[^/]+\/)?([0-9]+)(?:\/|$)/i);
      return match ? match[1] : null;
    }
    case 'walmart': {
      // Walmart item id from /ip/<slug>/<id> (or /ip/<id>)
      const match = pathname.match(/\/ip\/(?:[^/]+\/)?([0-9]+)(?:\/|$)/i);
      return match ? match[1] : null;
    }
    case 'etsy': {
      // Etsy listing id from /listing/<id>
      const match = pathname.match(/\/listing\/([0-9]+)(?:\/|$)/i);
      return match ? match[1] : null;
    }
    default:
      return null;
  }
}

/**
 * Classify a product card merchant URL.
 *
 * @param {string} merchantUrl - Raw merchant destination URL
 * @param {object} [options]
 * @param {string[]} [options.brandDomains] - Known domains for the brand's own storefront
 * @param {number} [depth=0] - Recursion depth for resolving redirect chains
 * @returns {{ kind: 'own' | 'marketplace' | 'reseller', marketplace: string | null, listingId: string | null }}
 */
export function classifyMerchant(merchantUrl, { brandDomains = [] } = {}, depth = 0) {
  if (typeof merchantUrl !== 'string' || !merchantUrl.trim()) {
    return {
      kind: 'reseller',
      marketplace: null,
      listingId: null,
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(merchantUrl.trim());
  } catch {
    try {
      parsedUrl = new URL(`https://${merchantUrl.trim()}`);
    } catch {
      return {
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      };
    }
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      kind: 'reseller',
      marketplace: null,
      listingId: null,
    };
  }

  const hostname = parsedUrl.hostname;
  if (!hostname) {
    return {
      kind: 'reseller',
      marketplace: null,
      listingId: null,
    };
  }

  // Check if host matches any known marketplace redirect host
  let isKnownRedirectHost = false;
  for (const mpConfig of Object.values(marketplaces)) {
    if (mpConfig.redirectHosts?.some((rHost) => hostMatches(hostname, rHost))) {
      isKnownRedirectHost = true;
      break;
    }
  }

  // Handle redirects if destination parameter is present
  if (depth < 3) {
    let destUrl = null;
    for (const param of REDIRECT_PARAM_CANDIDATES) {
      const val = parsedUrl.searchParams.get(param);
      if (val && isValidHttpUrl(val)) {
        destUrl = val.trim();
        break;
      }
    }
    if (!destUrl && isKnownRedirectHost) {
      for (const [, val] of parsedUrl.searchParams) {
        if (val && isValidHttpUrl(val)) {
          destUrl = val.trim();
          break;
        }
      }
    }

    if (destUrl) {
      return classifyMerchant(destUrl, { brandDomains }, depth + 1);
    }
  }

  // 1. Own store check: host is one of brandDomains or a subdomain of one
  const domains = Array.isArray(brandDomains) ? brandDomains : [];
  for (const domain of domains) {
    if (typeof domain === 'string' && domain.trim()) {
      if (hostMatches(hostname, domain.trim())) {
        return {
          kind: 'own',
          marketplace: null,
          listingId: null,
        };
      }
    }
  }

  // 2. Marketplace check: host equals or is a subdomain of a listed host or redirect host
  for (const [mpKey, mpConfig] of Object.entries(marketplaces)) {
    const isDirectHost = mpConfig.hosts?.some((h) => hostMatches(hostname, h));
    const isRedirectHost = mpConfig.redirectHosts?.some((h) => hostMatches(hostname, h));

    if (isDirectHost || isRedirectHost) {
      const listingId = extractListingId(mpKey, parsedUrl);
      return {
        kind: 'marketplace',
        marketplace: mpKey,
        listingId,
      };
    }
  }

  // 3. Fallback: reseller
  return {
    kind: 'reseller',
    marketplace: null,
    listingId: null,
  };
}
