import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MARKETPLACES = require('./merchant-marketplaces.json');
const MARKETPLACE_ENTRIES = Object.entries(MARKETPLACES);
const REDIRECTS = MARKETPLACE_ENTRIES.flatMap(([marketplace, config]) =>
  (config.redirects ?? []).map((redirect) => ({ marketplace, ...redirect })),
);

function normalizeHost(host) {
  return typeof host === 'string' ? host.trim().toLowerCase().replace(/\.$/, '') : '';
}

/** A host matches a registered domain only at a label boundary. */
function hostMatches(host, domain) {
  const candidate = normalizeHost(host);
  const registered = normalizeHost(domain);
  return Boolean(
    candidate && registered && (candidate === registered || candidate.endsWith(`.${registered}`)),
  );
}

/**
 * Parse only HTTP(S) destinations. Scheme-less merchant links are accepted,
 * but opaque schemes such as javascript: are not merchant URLs.
 */
function parseHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  let parsed;

  try {
    parsed = new URL(raw);
  } catch {
    // Many merchant URLs omit the scheme. Do not prepend one to an explicitly
    // unsupported scheme, because that would turn malformed input into a host.
    if (/^[a-z][a-z\d+.-]*:/i.test(raw)) return null;
    try {
      parsed = new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
  return parsed;
}

function redirectTarget(value, baseUrl) {
  const candidates = [value];
  let decoded = value;
  // searchParams decodes one URL-encoding layer already. A few redirectors
  // encode the destination again, so allow two extra decode attempts.
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      candidates.push(decoded);
    } catch {
      break;
    }
  }

  for (const candidate of candidates) {
    const absolute = parseHttpUrl(candidate);
    if (absolute) return absolute;
    if (typeof candidate === 'string' && candidate.startsWith('/')) {
      try {
        const relative = new URL(candidate, baseUrl);
        if (['http:', 'https:'].includes(relative.protocol)) return relative;
      } catch {
        // Try the next candidate; malformed redirect parameters aren't fatal.
      }
    }
  }
  return null;
}

/** Resolve known affiliate links before checking marketplace or brand hosts. */
function resolveMerchantUrl(initialUrl) {
  let url = initialUrl;
  const visited = new Set([url.href]);

  // Do not follow untrusted general-purpose redirects. Only hosts and query
  // parameters listed in merchant-marketplaces.json are inspected.
  for (let depth = 0; depth < 3; depth += 1) {
    const host = normalizeHost(url.hostname);
    const redirect = REDIRECTS.find((entry) =>
      entry.hosts.some((registered) => hostMatches(host, registered)),
    );
    if (!redirect) break;

    let target = null;
    for (const parameter of redirect.parameters ?? []) {
      const candidate = url.searchParams.get(parameter);
      if (!candidate) continue;
      target = redirectTarget(candidate, url);
      if (target) break;
    }
    if (!target || visited.has(target.href)) break;

    visited.add(target.href);
    url = target;
  }

  return url;
}

function detectMarketplace(host) {
  for (const [marketplace, config] of MARKETPLACE_ENTRIES) {
    if ((config.hosts ?? []).some((registered) => hostMatches(host, registered))) {
      return marketplace;
    }
  }
  return null;
}

function normalizeBrandDomain(value) {
  const url = parseHttpUrl(value);
  return url
    ? normalizeHost(url.hostname).replace(/^www\./, '')
    : normalizeHost(value).replace(/^www\./, '');
}

function isOwnDomain(host, brandDomains) {
  if (!Array.isArray(brandDomains)) return false;
  return brandDomains.some((domain) => {
    const normalized = normalizeBrandDomain(domain);
    return normalized && hostMatches(host, normalized);
  });
}

function listingIdFor(marketplace, pathname) {
  const segments = pathname.split('/').filter(Boolean);
  const segmentIndex = (name) => segments.findIndex((segment) => segment.toLowerCase() === name);

  if (marketplace === 'amazon') {
    const match = pathname.match(/\/(?:dp|gp\/product)\/([a-z\d]{10})(?:\/|$)/i);
    return match ? match[1].toUpperCase() : null;
  }

  if (marketplace === 'ebay') {
    const index = segmentIndex('itm');
    if (index < 0) return null;
    const direct = segments[index + 1];
    if (/^\d+$/.test(direct ?? '')) return direct;
    const slugged = segments[index + 2];
    return /^\d+$/.test(slugged ?? '') ? slugged : null;
  }

  if (marketplace === 'walmart') {
    const index = segmentIndex('ip');
    if (index < 0) return null;
    const first = segments[index + 1];
    if (/^\d+$/.test(first ?? '')) return first;
    const withSlug = segments[index + 2];
    return /^\d+$/.test(withSlug ?? '') ? withSlug : null;
  }

  if (marketplace === 'etsy') {
    const index = segmentIndex('listing');
    const id = segments[index + 1];
    return index >= 0 && /^\d+$/.test(id ?? '') ? id : null;
  }

  return null;
}

/**
 * Classify the destination behind an AI shopping card's merchant URL.
 *
 * Marketplace host and redirect rules live in merchant-marketplaces.json, so
 * new country domains and redirectors can be added without changing logic.
 * Unknown and malformed URLs intentionally fall back to reseller.
 *
 * @param {string} merchantUrl
 * @param {{ brandDomains?: string[] }} [options]
 * @returns {{ kind: 'own'|'marketplace'|'reseller', marketplace: string|null, listingId: string|null }}
 */
export function classifyMerchant(merchantUrl, { brandDomains = [] } = {}) {
  const parsed = parseHttpUrl(merchantUrl);
  if (!parsed) return { kind: 'reseller', marketplace: null, listingId: null };

  const destination = resolveMerchantUrl(parsed);
  const host = normalizeHost(destination.hostname);
  const marketplace = detectMarketplace(host);

  if (marketplace) {
    return {
      kind: 'marketplace',
      marketplace,
      listingId: listingIdFor(marketplace, destination.pathname),
    };
  }

  if (isOwnDomain(host, brandDomains)) {
    return { kind: 'own', marketplace: null, listingId: null };
  }

  return { kind: 'reseller', marketplace: null, listingId: null };
}
