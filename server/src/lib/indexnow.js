import { randomBytes } from 'node:crypto';
import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { PageFetchError, fetchPage } from './safe-fetch.js';

/**
 * IndexNow (#2142, part B; 00491): when Send to CMS confirms a page live,
 * Ansvisor tells IndexNow once (Bing, Yandex and the others that share it),
 * so search engines and the AI answers built on them hear of it without
 * waiting for a crawl. It is free and needs no sign-in: the site proves it
 * owns the key with a file at its root, https://<host>/<key>.txt. Ansvisor
 * makes the key, the person puts the file on the site, and Check reads it
 * back (safe-fetch: public addresses only). A CMS that can't put a file at
 * the site's root (Webflow, Wix) keeps it off.
 *
 * An announcement never holds up a publish: it is kept on the page before
 * the call (once per page) and a failed call is logged with codes only.
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** CMSs that can't serve a file at the site's root. */
export const NO_ROOT_FILE_CMS = ['webflow', 'wix'];
const CALL_TIMEOUT_MS = 10_000;
const KEY_FILE_MAX_BYTES = 1024;

/** A new key: 32 hex characters, as IndexNow takes them. */
export function newIndexNowKey() {
  return randomBytes(16).toString('hex');
}

/** A brand domain as a host: lower case, no scheme, path or port. Null when it isn't one. */
export function hostOf(domain) {
  const host = String(domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#:].*$/, '');
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) && host.includes('.') ? host : null;
}

/** Where the key's file must be. */
export function keyFileUrl(host, key) {
  return `https://${host}/${key}.txt`;
}

/**
 * The brand's IndexNow as Settings shows it: its key, host and when it was
 * checked, the CMS that keeps it off (webflow, wix), and the host it would
 * use (the brand's primary domain).
 */
export async function readIndexNow(brandId, { db = supabaseAdmin } = {}) {
  const [brand, cms, domains] = await Promise.all([
    db
      .from('brands')
      .select('indexnow_key, indexnow_host, indexnow_verified_at')
      .eq('id', brandId)
      .maybeSingle(),
    db.from('brand_cms_connections').select('provider').eq('brand_id', brandId),
    db.from('brand_domains').select('domain, is_primary').eq('brand_id', brandId),
  ]);
  for (const read of [brand, cms, domains]) {
    if (read.error) throw new Error(`Could not read IndexNow: ${read.error.message}`);
  }
  const blockedBy =
    (cms.data ?? []).map((row) => row.provider).find((p) => NO_ROOT_FILE_CMS.includes(p)) ?? null;
  const ordered = [...(domains.data ?? [])].sort(
    (a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)),
  );
  const domainHost = ordered.map((row) => hostOf(row.domain)).find(Boolean) ?? null;
  const key = brand.data?.indexnow_key ?? null;
  const host = brand.data?.indexnow_host ?? null;
  return {
    key,
    host,
    keyUrl: key && host ? keyFileUrl(host, key) : null,
    verifiedAt: brand.data?.indexnow_verified_at ?? null,
    blockedBy,
    domainHost,
  };
}

/** A host without its leading www., to tell example.com and www.example.com apart from another site. */
const bareHost = (host) => host.replace(/^www\./, '');

/**
 * Whether the key's file is at its address: `state` is 'ok', 'mismatch' (a
 * file, but not the key), 'not_found' or 'unreachable'. `host` is the host
 * the file finally loaded from: a redirect between example.com and
 * www.example.com moves it there, and pages are announced on that host, as
 * IndexNow takes only pages on the key file's own host. A redirect to
 * another site isn't the brand's file.
 */
export async function checkKeyFile(host, key, { fetch = fetchPage } = {}) {
  try {
    const { url, status, html } = await fetch(keyFileUrl(host, key), {
      types: /^text\/plain\b/i,
      accept: 'text/plain',
      maxBytes: KEY_FILE_MAX_BYTES,
      truncate: true,
      timeoutMs: CALL_TIMEOUT_MS,
    });
    if (status < 200 || status > 299) return { state: 'not_found', host };
    let loadedFrom = host;
    try {
      loadedFrom = new URL(url).host.toLowerCase();
    } catch {
      // No address after redirects: the one asked for.
    }
    if (bareHost(loadedFrom) !== bareHost(host)) return { state: 'not_found', host };
    return { state: html.trim() === key ? 'ok' : 'mismatch', host: loadedFrom };
  } catch (err) {
    if (err instanceof PageFetchError) {
      const state =
        err.code === 'http_error' || err.code === 'not_html' ? 'not_found' : 'unreachable';
      return { state, host };
    }
    return { state: 'unreachable', host };
  }
}

/**
 * Tells IndexNow a page went live, once (above). Never throws: answers what
 * it did ('pinged', 'off', 'other_host', 'already', 'failed') for the tests
 * and the log.
 *
 * @param {{ draftId: string, url: string }} page
 */
export async function announcePublishedPage(
  { draftId, url },
  { db = supabaseAdmin, fetch = globalThis.fetch, now = new Date() } = {},
) {
  try {
    const { data: draft, error } = await db
      .from('content_drafts')
      .select('brand_id, indexnow_pinged_at')
      .eq('id', draftId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!draft) return 'off';
    if (draft.indexnow_pinged_at) return 'already';
    const { data: brand, error: brandError } = await db
      .from('brands')
      .select('indexnow_key, indexnow_host, indexnow_verified_at')
      .eq('id', draft.brand_id)
      .maybeSingle();
    if (brandError) throw new Error(brandError.message);
    if (!brand?.indexnow_key || !brand.indexnow_host || !brand.indexnow_verified_at) return 'off';
    let pageHost;
    try {
      pageHost = new URL(url).host.toLowerCase();
    } catch {
      return 'other_host';
    }
    // IndexNow takes only pages on the key file's own host.
    if (pageHost !== brand.indexnow_host) return 'other_host';

    // Kept before the call: two reads of the same publish announce it once.
    const { data: claimed, error: claimError } = await db
      .from('content_drafts')
      .update({ indexnow_pinged_at: now.toISOString() })
      .eq('id', draftId)
      .is('indexnow_pinged_at', null)
      .select('id');
    if (claimError) throw new Error(claimError.message);
    if (!claimed?.length) return 'already';

    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: brand.indexnow_host,
        key: brand.indexnow_key,
        keyLocation: keyFileUrl(brand.indexnow_host, brand.indexnow_key),
        urlList: [url],
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (res.status === 200 || res.status === 202) return 'pinged';
    logger.warn({ status: res.status }, '[indexnow] the announcement was refused');
    return 'failed';
  } catch (err) {
    logger.warn(
      { code: err?.code ?? err?.name ?? 'error' },
      '[indexnow] could not announce a page',
    );
    return 'failed';
  }
}
