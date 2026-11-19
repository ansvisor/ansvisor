import supabaseAdmin from '../config/supabase.js';
import { fetchPage } from './safe-fetch.js';
import { logger } from './logger.js';
import { ownDomainMatcher } from './response-parser.js';
import { preferredDomains, readSourceRules, sourceAllowed } from './content-rules.js';

/**
 * Where the Content Agent may link (Content Agent rule gaps, A): the brand's
 * own pages for internal links, and the sources the draft keeps for outbound
 * links and inline citations. The agent links only to these, by their URL;
 * keepSuggestions unwraps any other link, so it never invents one.
 */

/** No targets: every link an agent writes is unwrapped. */
export const NO_LINK_TARGETS = Object.freeze({ own: [], sources: [] });

/** The brand's pages offered, the most cited and visited first. */
export const MAX_OWN_PAGES = 40;
/** The draft's sources offered, as the Sources tab lists them (its top 20). */
export const MAX_SOURCE_PAGES = 20;

/** Query parameters that only track a visit. */
const TRACKING = /^(utm_\w+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref)$/i;

/** A path without the slashes it ends in, read back from its end. */
function withoutTrailingSlashes(path) {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end -= 1;
  return path.slice(0, end);
}

/**
 * A URL as links compare: an http(s) address, its host lower-cased without
 * www, no hash, no tracking parameters, no trailing slash. Null for anything else.
 */
export function linkKey(url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? '').trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...parsed.searchParams].filter(([name]) => !TRACKING.test(name));
  const search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return `${host}${withoutTrailingSlashes(parsed.pathname)}${search}`;
}

/** A URL as a link keeps it: without tracking parameters or a hash; null when not http(s). */
export function linkHref(url) {
  if (!linkKey(url)) return null;
  const parsed = new URL(String(url).trim());
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING.test(name)) parsed.searchParams.delete(name);
  }
  parsed.hash = '';
  return parsed.toString();
}

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

/** A site's canonical host is looked up once in a while, not per draft. */
const HOST_TTL_MS = 6 * 60 * 60 * 1000;
const HOST_RETRY_MS = 5 * 60 * 1000;
const HOST_TIMEOUT_MS = 4000;
const hostCache = new Map();

/** Clears what canonicalHost remembers (tests). */
export function resetCanonicalHosts() {
  hostCache.clear();
}

/**
 * The host the brand's site answers on, with its www or without: where its
 * home page lands after redirects. The page inventory stores hosts without
 * www (site-pages.js normalizePageUrl), so an internal link would otherwise
 * point at the redirected form. Null when it can't be told (the stored host stays).
 */
export async function canonicalHost(domain) {
  const bare = bareHost(domain);
  const known = hostCache.get(bare);
  if (known && known.until > Date.now()) return known.host;
  let host = null;
  try {
    // Through safe-fetch: public addresses only, redirects checked each hop;
    // only the start of the home page is read.
    const res = await fetchPage(`https://${bare}/`, {
      timeoutMs: HOST_TIMEOUT_MS,
      maxBytes: 64 * 1024,
      truncate: true,
    });
    const landed = new URL(res.url).hostname.toLowerCase();
    // Only the same site's www or bare form; a redirect elsewhere says nothing.
    if (bareHost(landed) === bare) host = landed;
  } catch {
    // Unreachable: keep the stored host, and try again soon.
  }
  hostCache.set(bare, { host, until: Date.now() + (host ? HOST_TTL_MS : HOST_RETRY_MS) });
  return host;
}

/** A page's URL on the canonical host, when it is on the brand's own domain itself. */
function onHost(url, domain, host) {
  if (!host) return url;
  try {
    const parsed = new URL(url);
    if (bareHost(parsed.hostname) !== bareHost(domain) || parsed.hostname === host) return url;
    parsed.hostname = host;
    return parsed.toString();
  } catch {
    return url;
  }
}

const clean = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** The brand's primary domain and the host its site answers on; null when unknown. */
async function readCanonicalHost(brandId) {
  try {
    const { data } = await supabaseAdmin
      .from('brand_domains')
      .select('domain, is_primary')
      .eq('brand_id', brandId);
    const row = (data ?? []).find((d) => d.is_primary) ?? data?.[0];
    if (!row) return null;
    const domain = bareHost(
      String(row.domain)
        .replace(/^https?:\/\//, '')
        .split('/')[0],
    );
    return { domain, host: await canonicalHost(domain) };
  } catch {
    return null;
  }
}

/**
 * The draft's link targets: `own` (the brand's pages) and `sources` (pages AI
 * answers cite for the draft's prompts, without the brand's own and its
 * competitors', without the ones the person left out, with the ones they
 * added), each { url, title }; the brand's own pages on the host its site
 * answers on (www or not). A failed read leaves its list empty: the agent
 * then links nothing there, as before.
 */
export async function readLinkTargets({ brandId, draftId, sourceUrl, ruleKeys }) {
  // Each list is read only for the rules that use it.
  const wantsOwn = ruleKeys.has('internalLinks');
  const wantsSources = ruleKeys.has('outboundLinks') || ruleKeys.has('citeInline');
  if (!wantsOwn && !wantsSources) return NO_LINK_TARGETS;
  const none = { data: null, error: null };
  const rulesRead = wantsSources ? readSourceRules(brandId) : null;
  const [pagesRead, sourcesRead, choicesRead, host] = await Promise.all([
    wantsOwn
      ? supabaseAdmin
          .from('site_pages')
          .select('url, title, h1')
          .eq('brand_id', brandId)
          // Not fetched yet, or answered: 0 is a fetch that failed outright (00104).
          .or('fetch_status.is.null,and(fetch_status.gte.200,fetch_status.lt.400)')
          .order('ai_citations', { ascending: false })
          .order('ga_sessions', { ascending: false })
          .limit(MAX_OWN_PAGES + 1)
      : none,
    wantsSources
      ? supabaseAdmin.rpc('content_draft_sources', { p_draft_id: draftId, p_days: 30 })
      : none,
    wantsSources
      ? supabaseAdmin
          .from('content_draft_sources')
          .select('ref, included, added')
          .eq('draft_id', draftId)
          .eq('kind', 'cited_page')
      : none,
    wantsOwn ? readCanonicalHost(brandId) : null,
  ]);
  for (const [what, read] of [
    ['site pages', pagesRead],
    ['sources', sourcesRead],
    ['source choices', choicesRead],
  ]) {
    if (read.error) {
      logger.warn({ err: read.error, draftId }, `[content-links] reading ${what} failed`);
    }
  }

  const seen = new Set([linkKey(sourceUrl)].filter(Boolean));
  const take = (list, max, page) => {
    const key = linkKey(page.url);
    if (!key || seen.has(key) || list.length >= max) return;
    seen.add(key);
    const url = linkHref(page.url);
    list.push({ url, title: clean(page.title) || url });
  };

  const own = [];
  for (const page of pagesRead.error ? [] : (pagesRead.data ?? [])) {
    take(own, MAX_OWN_PAGES, {
      url: host ? onHost(page.url, host.domain, host.host) : page.url,
      title: page.title || page.h1,
    });
  }

  const data = sourcesRead.error ? null : sourcesRead.data;
  // Without the read, competitors can't be told apart: no outbound targets.
  if (!data) return { own, sources: [] };
  const choices = choicesRead.error ? [] : (choicesRead.data ?? []);
  const leftOut = new Set(choices.filter((c) => !c.included).map((c) => linkKey(c.ref)));
  // The brand's and its competitors' own sites, a domain written with a path too.
  const closed = ownDomainMatcher([
    ...(data.brandDomains ?? []),
    ...(data.competitorDomains ?? []),
  ]);
  // The brand's own blocked and allowed domains (Content rules) narrow the sources further.
  const rules = await rulesRead;
  const permitted = sourceAllowed(rules, data.brandDomains ?? []);
  const sources = [];
  const candidates = [
    ...(data.citedPages ?? []),
    // Added by the person in the Sources tab: kept, even with no answer citing them yet.
    ...choices.filter((c) => c.added && c.included).map((c) => ({ url: c.ref, title: '' })),
  ];
  for (const page of candidates) {
    if (leftOut.has(linkKey(page.url)) || closed(page.url) || !permitted(page.url)) continue;
    take(sources, MAX_SOURCE_PAGES, page);
  }
  return { own, sources, prefer: preferredDomains(rules) };
}

/**
 * The targets as the model reads them, by the rules asked for; '' when there
 * are none. A draft's shopping path (shopping-links.js withShopping) comes
 * first, whatever the rules: it's the page's plan.
 */
export function linkTargetsPrompt(targets, ruleKeys) {
  const lines = (list) => list.map((p) => `- ${p.title} — ${p.url}`).join('\n');
  const parts = [];
  if (targets.shopping?.length) {
    parts.push(
      `The shopping path, the brand's shop pages this page sends readers to: link each where the page names it, once:\n${lines(targets.shopping)}`,
    );
  }
  if (targets.own.length && ruleKeys.has('internalLinks')) {
    parts.push(
      `Pages on the brand's site you may link to (internal links):\n${lines(targets.own)}`,
    );
  }
  if (targets.sources.length && (ruleKeys.has('outboundLinks') || ruleKeys.has('citeInline'))) {
    parts.push(
      `Sources you may link to and cite (outbound links, inline citations):\n${lines(targets.sources)}`,
    );
  }
  if (targets.prefer?.length && targets.sources.length) {
    parts.push(`Prefer sources on these domains when you choose: ${targets.prefer.join(', ')}.`);
  }
  return parts.join('\n\n');
}

/**
 * The URL a link may keep, by its key: every target's. A link to anything
 * else is unwrapped.
 */
export function linkAllowList(targets) {
  return new Map(
    [...targets.own, ...targets.sources, ...(targets.shopping ?? [])].map((p) => [
      linkKey(p.url),
      p.url,
    ]),
  );
}
