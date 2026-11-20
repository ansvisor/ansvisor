/**
 * Page fetching for the Site Audit. The target page goes through Scrape.do
 * (proxy + JS render), so we get the same HTML an AI render bot would, or
 * through Firecrawl when `AUDIT_FETCHER=firecrawl` and `FIRECRAWL_API_KEY` are
 * set. Small auxiliary files (robots.txt, llms.txt) are fetched directly —
 * they're public by convention and not worth a proxy credit each.
 */

import { nestsTooDeep } from '../html-depth.js';

const SCRAPEDO_API = 'https://api.scrape.do';
const FIRECRAWL_SCRAPE_API = 'https://api.firecrawl.dev/v2/scrape';
/** Firecrawl gives a scrape up to 60s on its side; a hung connection must not hold the audit longer. */
const FIRECRAWL_TIMEOUT_MS = 75_000;

/** Firecrawl fetches the pages only when asked for and its key is set; Scrape.do is the default. */
function usesFirecrawl() {
  return (
    (process.env.AUDIT_FETCHER || 'scrapedo').trim().toLowerCase() === 'firecrawl' &&
    Boolean(process.env.FIRECRAWL_API_KEY)
  );
}

/** Whether a proxy fetcher is configured, so callers know a blocked page can be fetched again. */
export function proxyFetcherConfigured() {
  return usesFirecrawl() || Boolean(process.env.SCRAPEDO_API_KEY);
}

function getToken() {
  const token = process.env.SCRAPEDO_API_KEY;
  if (!token) throw new Error('SCRAPEDO_API_KEY must be configured');
  return token;
}

/**
 * Fetch a URL through Scrape.do and return the rendered HTML, or through
 * Firecrawl when `AUDIT_FETCHER=firecrawl` is configured, so every caller
 * follows the setting (Firecrawl always renders, so `render` applies to
 * Scrape.do only). A page nested deeper than any browser keeps comes back
 * not ok, with no HTML and the error 'too_deep', so it isn't parsed
 * (html-depth.js).
 *
 * @param {string} targetUrl
 * @param {{ render?: boolean, retries?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, html: string, contentType: string|null, error?: string }>}
 */
export async function fetchViaScrapeDo(targetUrl, { render = true, retries = 1 } = {}) {
  if (usesFirecrawl()) return fetchViaFirecrawl(targetUrl, { retries });
  const params = new URLSearchParams({ token: getToken(), url: targetUrl });
  if (render) params.set('render', 'true');
  const endpoint = `${SCRAPEDO_API}/?${params.toString()}`;

  let last = { ok: false, status: 0, html: '', contentType: null };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(endpoint);
      const html = await res.text();
      const contentType = res.headers.get('content-type');
      if (res.ok && nestsTooDeep(html)) {
        return { ok: false, status: res.status, html: '', contentType, error: 'too_deep' };
      }
      last = { ok: res.ok, status: res.status, html, contentType };
      // Retry only on proxy-side 5xx (transient); 4xx is the target's verdict.
      if (res.ok || res.status < 500) return last;
    } catch (err) {
      last = { ok: false, status: 0, html: '', contentType: null, error: err.message };
    }
  }
  return last;
}

/**
 * Fetch a URL through Firecrawl's scrape endpoint and return the page's raw
 * HTML, in the same shape as fetchViaScrapeDo. Firecrawl always renders, so
 * there is no `render` option, and `maxAge: 0` asks for a live read rather
 * than a cached one. The status is the target page's own; a failure on
 * Firecrawl's side (a refused key, no credits, an unreachable host) comes back
 * as status 0 with Firecrawl's error, so it is never taken for the page's
 * answer. A deeply nested page comes back as 'too_deep' the same way.
 *
 * @param {string} targetUrl
 * @param {{ retries?: number }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, html: string, contentType: string|null, error?: string }>}
 */
export async function fetchViaFirecrawl(targetUrl, { retries = 1 } = {}) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY must be configured');

  let last = { ok: false, status: 0, html: '', contentType: null };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(FIRECRAWL_SCRAPE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          url: targetUrl,
          formats: ['rawHtml'],
          maxAge: 0,
          origin: 'ansvisor',
        }),
        signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => null);
      const data = body?.data;
      if (!res.ok || !body?.success || typeof data?.rawHtml !== 'string') {
        last = {
          ok: false,
          status: 0,
          html: '',
          contentType: null,
          error: String(body?.error || `Firecrawl HTTP ${res.status}`),
        };
        // Retry only when Firecrawl itself had a transient (5xx) failure.
        if (res.status < 500) return last;
        continue;
      }
      const status = data.metadata?.statusCode ?? res.status;
      const contentType = data.metadata?.contentType ?? null;
      const ok = status >= 200 && status < 300;
      if (ok && nestsTooDeep(data.rawHtml)) {
        return { ok: false, status, html: '', contentType, error: 'too_deep' };
      }
      last = { ok, status, html: data.rawHtml, contentType };
      // Retry only on the target's 5xx (transient); 4xx is the target's verdict.
      if (ok || status < 500) return last;
    } catch (err) {
      last = { ok: false, status: 0, html: '', contentType: null, error: err.message };
    }
  }
  return last;
}

/**
 * Direct fetch of a small text resource (robots.txt / llms.txt). Returns null
 * on any failure or non-2xx so the caller can decide whether to fall back.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string|null>}
 */
async function fetchTextDirect(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'AnsvisorSiteAudit/1.0 (+https://ansvisor.com)' },
      redirect: 'follow',
    });
    if (res.ok) return { body: await res.text(), blocked: false };
    // 404 / 410 → the file genuinely isn't there (don't waste a proxy credit).
    // 401/403/405/406/429/503 → smells like an anti-bot block, worth a retry.
    const blocked = [401, 403, 405, 406, 429, 503].includes(res.status);
    return { body: null, blocked };
  } catch {
    // Timeout / TLS / network error — could be a block; let the caller retry.
    return { body: null, blocked: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a small text resource (robots.txt / llms.txt), trying a cheap direct
 * request first and falling back to Scrape.do when the site blocks us (so
 * Cloudflare-style anti-bot doesn't produce a false "absent" reading). Returns
 * null only when both paths fail.
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export async function fetchText(url) {
  const direct = await fetchTextDirect(url);
  if (direct.body !== null) return direct.body;
  // Clean 404 → the file is genuinely absent; no point spending a proxy credit.
  if (!direct.blocked) return null;

  // Direct request looked blocked — retry through the proxy (no JS render
  // needed for a text file). Treat HTML error pages as "absent".
  try {
    const viaProxy = await fetchViaScrapeDo(url, { render: false, retries: 0 });
    if (!viaProxy.ok || !viaProxy.html) return null;
    if (/<html[\s>]/i.test(viaProxy.html)) return null;
    return viaProxy.html;
  } catch {
    return null;
  }
}
