/**
 * Which address a page is audited at. A page is one page across www and
 * non-www (history.js pageKey), but the site only answers at one of them and
 * redirects the other: auditing the wrong one costs a redirect hop on every
 * fetch, and the AI-bot checks may test the redirect instead of the page.
 * The inventories that feed bulk and auto-audits drop www (site-pages.js), so
 * those addresses are the wrong one on a www site.
 *
 * Two corrections, both pure here: before the fetch, `preferredAuditUrl`
 * moves the address to the host the brand's site is known to use; after it,
 * `canonicalAuditUrl` adopts the page's own canonical address when it names
 * the same page. The audit then stores and shows that address (final_url).
 */

import { pageKey } from './history.js';

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

/** A URL's parts, or null when it isn't an http(s) address. */
function parse(address) {
  try {
    const u = new URL(address);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

/**
 * The page's own canonical address (its canonical tag, resolved against the
 * address fetched) when it is the same page on the same site: the same host
 * once www is ignored, and the same path once a trailing slash is. Query and
 * fragment are dropped (a tracking parameter isn't part of the page). The
 * address fetched for anything else: no tag, another site, another page.
 *
 * @param {string} url - the address fetched
 * @param {string|null} href - its canonical tag's href
 * @returns {string}
 */
export function canonicalAuditUrl(url, href) {
  if (!href) return url;
  const fetched = parse(url);
  let target;
  try {
    target = fetched ? parse(new URL(href, fetched).href) : null;
  } catch {
    target = null;
  }
  if (!fetched || !target) return url;
  if (pageKey(target.href)?.key !== pageKey(fetched.href)?.key) return url;
  target.search = '';
  target.hash = '';
  return target.toString();
}

/**
 * The address to fetch: `url` on the host the brand's site is known to use.
 * `knownUrls` are addresses of the brand's pages as the site itself gave them
 * (the final URLs of earlier audits, newest first, then the brand's stored
 * domains); the first whose host is `url`'s host with or without www wins.
 * The scheme and path stay as asked.
 *
 * @param {string} url
 * @param {string[]} knownUrls
 * @returns {string}
 */
export function preferredAuditUrl(url, knownUrls = []) {
  const asked = parse(url);
  if (!asked) return url;
  for (const known of knownUrls) {
    const candidate = parse(/^https?:\/\//i.test(String(known)) ? known : `https://${known}`);
    if (!candidate || bareHost(candidate.hostname) !== bareHost(asked.hostname)) continue;
    if (candidate.host !== asked.host) {
      asked.host = candidate.host;
      return asked.toString();
    }
    return url;
  }
  return url;
}
