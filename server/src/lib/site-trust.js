import * as cheerio from 'cheerio';
import supabaseAdmin from '../config/supabase.js';
import { jsonLd, typesOf } from './audit/signals/helpers.js';
import { fetchPage } from './safe-fetch.js';

/**
 * A brand's site trust (Content Editor Quality spec §8, CE-043): five
 * site-level checks Site Audit shows as "Site trust {n}/5", and Trust's 5
 * points on every page. Read from the brand's page list (site_pages), its
 * home page and its authors (Settings › Authors), at most once a day or when
 * someone asks again (not more than every few minutes), and kept in
 * site_trust (00254). Only the brand's own site is read.
 */

export const SITE_TRUST_CHECKS = [
  'about',
  'contact',
  'editorial',
  'organizationSchema',
  'authorPages',
];
/** How long a read holds, and how soon asking again reads again. */
export const SITE_TRUST_TTL_MS = 24 * 60 * 60 * 1000;
export const RECHECK_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_BYTES = 1024 * 1024;

/**
 * The pages three checks look for: a whole part of the address, in the
 * languages the app reads, or a title that is just that ("About us · Acme",
 * not "About our pricing"); and the addresses
 * tried on the site when the page list has none, whose title or H1 must
 * have the word.
 */
const PAGES = {
  about: {
    part: /^(?:about|about-us|company|who-we-are|our-story|hakkimizda|hakkımızda|uber-uns|ueber-uns|a-propos|sobre-nosotros|quienes-somos)$/i,
    title:
      /^(?:about(?:\s+us)?|who we are|hakkımızda|über uns|à propos|sobre nosotros|quiénes somos)(?:\s*[|·•–—:-]|$)/i,
    probe: ['/about', '/about-us'],
    word: /\babout\b|hakkımızda|über uns|à propos|sobre nosotros|quiénes somos/i,
  },
  contact: {
    part: /^(?:contact|contact-us|contacts|iletisim|iletişim|kontakt|contacto|nous-contacter)$/i,
    title: /^(?:contact(?:\s+us)?|iletişim|kontakt|contacto|nous contacter)(?:\s*[|·•–—:-]|$)/i,
    probe: ['/contact', '/contact-us'],
    word: /\bcontact|iletişim|kontakt|contacto/i,
  },
  editorial: {
    part: /^(?:editorial-policy|editorial-guidelines|editorial-standards|editorial-process|how-we-review|how-we-test|review-process|methodology|our-methodology|fact-checking-policy)$/i,
    title:
      /editorial (?:policy|guidelines|standards|process)|how we (?:review|test)|our methodology|fact[- ]checking policy/i,
    probe: ['/editorial-policy', '/how-we-review'],
    word: /editorial|how we (?:review|test)|methodology|fact[- ]check/i,
  },
};

/** Organization and its kinds, as JSON-LD names them. */
const ORGANIZATION_TYPES = new Set([
  'organization',
  'corporation',
  'localbusiness',
  'onlinestore',
  'onlinebusiness',
  'store',
  'newsmediaorganization',
  'educationalorganization',
  'governmentorganization',
  'medicalorganization',
  'ngo',
  'professionalservice',
]);

const pathParts = (url) => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return [];
  }
};

/** The page of the list a check looks for (its address or its title), or null. */
export function findPage(pages, kind) {
  const { part, title } = PAGES[kind];
  const found = pages.find(
    (p) => pathParts(p.url).some((x) => part.test(x)) || title.test((p.title ?? '').trim()),
  );
  return found?.url ?? null;
}

/** Whether a page's JSON-LD names an Organization (or a kind of one). */
export function hasOrganization(html) {
  return jsonLd({ $: cheerio.load(html) }).nodes.some((n) =>
    typesOf(n).some((t) => ORGANIZATION_TYPES.has(t)),
  );
}

/** "Ada Lovelace" → "ada-lovelace": how an author's page address names them. */
export function nameSlug(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * An author's page on the site: one of the list's whose address has the
 * author's name as a whole part ("/authors/ada-lovelace") or whose title
 * starts with it, or a profile link of theirs on the brand's own site.
 */
export function authorPage(pages, author, onSite) {
  const slug = nameSlug(author.name);
  const name = author.name.trim().toLowerCase();
  const found = pages.find(
    (p) =>
      (slug && pathParts(p.url).some((x) => x.toLowerCase() === slug)) ||
      (p.title ?? '').trim().toLowerCase().startsWith(name),
  );
  if (found) return found.url;
  return (author.same_as ?? []).find((link) => onSite(link)) ?? null;
}

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

/** The brand's main domain, bare ("acme.com"), or null. */
function mainDomain(domains) {
  const primary = domains.find((d) => d.is_primary) ?? domains[0];
  if (!primary) return null;
  return bareHost(primary.domain.replace(/^https?:\/\//, '').split('/')[0]);
}

/**
 * Whether an address on the brand's site is the page a check looks for: it
 * reads, doesn't land on another page (a redirect to the home page isn't
 * one), and its title or H1 says what it is (a site that answers every
 * address with its home page doesn't pass).
 */
async function answers(url, kind, fetcher) {
  try {
    const page = await fetcher(url, { timeoutMs: PROBE_TIMEOUT_MS, maxBytes: PROBE_MAX_BYTES });
    const asked = new URL(url).pathname.replace(/\/+$/, '');
    if (new URL(page.url).pathname.replace(/\/+$/, '') !== asked) return false;
    const $ = cheerio.load(page.html);
    const { word } = PAGES[kind];
    return word.test($('title').first().text()) || word.test($('h1').first().text());
  } catch {
    return false;
  }
}

/**
 * Reads the five checks for a brand: each with whether it passes and the page
 * that passes it.
 */
export async function computeSiteTrust(brandId, { db = supabaseAdmin, fetcher = fetchPage } = {}) {
  const { data: brand, error: brandError } = await db
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .single();
  if (brandError) throw new Error(brandError.message);
  const [domainsRes, pagesRes, authorsRes] = await Promise.all([
    db.from('brand_domains').select('domain, is_primary').eq('brand_id', brandId),
    db.from('site_pages').select('url, title').eq('brand_id', brandId),
    db
      .from('content_authors')
      .select('name, same_as')
      .eq('organization_id', brand.organization_id)
      .order('name'),
  ]);
  for (const res of [domainsRes, pagesRes, authorsRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const domain = mainDomain(domainsRes.data ?? []);
  const pages = pagesRes.data ?? [];
  const onSite = (link) => {
    try {
      const host = bareHost(new URL(link).hostname);
      return !!domain && (host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  };

  const checks = {};
  for (const kind of ['about', 'contact', 'editorial']) {
    let url = findPage(pages, kind);
    // Not in the page list: the usual addresses on the site itself.
    for (const path of domain && !url ? PAGES[kind].probe : []) {
      if (await answers(`https://${domain}${path}`, kind, fetcher)) {
        url = `https://${domain}${path}`;
        break;
      }
    }
    checks[kind] = { ok: !!url, url };
  }

  const home = domain ? `https://${domain}/` : null;
  let organization = false;
  if (home) {
    try {
      organization = hasOrganization((await fetcher(home, { timeoutMs: PROBE_TIMEOUT_MS })).html);
    } catch {
      organization = false;
    }
  }
  checks.organizationSchema = { ok: organization, url: home };

  const authors = (authorsRes.data ?? []).map((a) => ({
    name: a.name,
    url: authorPage(pages, a, onSite),
  }));
  checks.authorPages = { ok: authors.length > 0 && authors.every((a) => a.url), authors };

  return { checks, score: SITE_TRUST_CHECKS.filter((k) => checks[k].ok).length };
}

/**
 * The brand's site trust: the kept read while it holds (a day; when asked
 * again, a few minutes), else a new read, kept.
 *
 * @returns {Promise<{ checks: object, score: number, checkedAt: string }>}
 */
export async function readSiteTrust(
  brandId,
  { refresh = false, db = supabaseAdmin, fetcher = fetchPage, now = Date.now() } = {},
) {
  const { data: kept, error } = await db
    .from('site_trust')
    .select('checks, score, checked_at')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (kept) {
    const age = now - Date.parse(kept.checked_at);
    if (age < (refresh ? RECHECK_MS : SITE_TRUST_TTL_MS)) {
      return { checks: kept.checks, score: kept.score, checkedAt: kept.checked_at };
    }
  }
  const { checks, score } = await computeSiteTrust(brandId, { db, fetcher });
  const checkedAt = new Date(now).toISOString();
  const { error: keepError } = await db
    .from('site_trust')
    .upsert(
      { brand_id: brandId, checks, score, checked_at: checkedAt },
      { onConflict: 'brand_id' },
    );
  if (keepError) throw new Error(keepError.message);
  return { checks, score, checkedAt };
}
