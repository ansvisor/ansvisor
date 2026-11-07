/**
 * A skill's source on GitHub, found on its skills.sh page (Chat Wave 4
 * W4-29; owner decision 17: skills.sh is the only directory read). The page
 * is read through safe-fetch, with Chat's page limits (page-open.js: 10 s,
 * 1 MB, 3 redirects), and every step of it, the first and each redirect's,
 * must stay on skills.sh over https ('not_allowed' otherwise): no other host
 * is read for it. Only its github.com link comes back, never the page; the
 * web then imports the skill from GitHub as any other, pinned to a commit
 * (web/src/lib/chat/skills/github.ts).
 */

import * as cheerio from 'cheerio';

import { OPEN_PAGE_LIMITS } from './page-open.js';
import { fetchPage } from './safe-fetch.js';

/** The directory's hosts: the only ones read. */
export const SKILLS_SH_HOSTS = new Set(['skills.sh', 'www.skills.sh']);

/** Whether a URL is a skills.sh page: https, its own host, no sign-in or port. */
export function isSkillsShUrl(url) {
  return (
    url.protocol === 'https:' &&
    SKILLS_SH_HOSTS.has(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.port
  );
}

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

/** github.com's own pages, never a repository's owner. */
const NOT_OWNERS = new Set([
  'about',
  'apps',
  'collections',
  'enterprise',
  'explore',
  'features',
  'join',
  'login',
  'marketplace',
  'new',
  'orgs',
  'pricing',
  'search',
  'settings',
  'signup',
  'site',
  'sponsors',
  'topics',
  'trending',
]);

/** A link's words that name it the skill's source ("Repository", "View on GitHub"). */
const SOURCE_WORDS = /\b(?:source|repo|repository|github)\b/i;

/**
 * What a github.com link names: a SKILL.md, a folder, a repository, or
 * null for anything else (an issue, another file, GitHub's own pages).
 */
function githubKind(url) {
  if (url.protocol !== 'https:' || !GITHUB_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password || url.port) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || NOT_OWNERS.has(parts[0].toLowerCase())) return null;
  if (parts.length === 2) return 'repo';
  if (parts[2] === 'tree' && parts.length === 4) return 'repo';
  if (parts[2] === 'tree' && parts.length > 4) return 'folder';
  if (parts[2] === 'blob' && parts[parts.length - 1] === 'SKILL.md') return 'skill';
  return null;
}

/**
 * The skill's github.com link on a skills.sh page, or null when it links
 * to none. The site's own header, menu and footer aren't read. A link
 * named as the source ("Repository", "Source", "View on GitHub") comes
 * before any other; of those, one to a SKILL.md or a skill's folder before
 * a repository's root, else the first. A repository's root gives way to a
 * SKILL.md or folder link into the same repository, which names the skill.
 *
 * @param {string} html
 * @param {string} pageUrl the page's address, for relative links
 * @returns {string | null} https://github.com/…, without query or fragment
 */
export function githubSourceIn(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const a = $(el);
    if (a.closest('header, nav, footer').length > 0) return;
    let url;
    try {
      url = new URL(a.attr('href') ?? '', pageUrl);
    } catch {
      return;
    }
    const kind = githubKind(url);
    if (!kind) return;
    const words = [a.text(), a.attr('aria-label'), a.attr('title')].filter(Boolean).join(' ');
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    links.push({
      url: `https://github.com${url.pathname.replace(/\/+$/, '')}`,
      kind,
      named: SOURCE_WORDS.test(words),
      repo: `${owner}/${repo}`.toLowerCase(),
    });
  });
  const named = links.filter((link) => link.named);
  const pool = named.length > 0 ? named : links;
  const best = pool.find((link) => link.kind !== 'repo') ?? pool[0];
  if (!best) return null;
  if (best.kind !== 'repo') return best.url;
  const inside = links.find((link) => link.kind !== 'repo' && link.repo === best.repo);
  return (inside ?? best).url;
}

/**
 * Reads a skills.sh page and finds its skill's github.com link (above), or
 * null. Throws safe-fetch's PageFetchError when the page can't be read:
 * not_allowed (not skills.sh over https, or a redirect off it), timeout,
 * unreachable, http_error, not_html, too_large…
 *
 * @param {string} address
 * @param {{ lookup?: Function, ports?: string[], signal?: AbortSignal }} [opts] as safe-fetch's
 */
export async function readSkillsShSource(address, opts = {}) {
  const page = await fetchPage(address, {
    ...OPEN_PAGE_LIMITS,
    ...opts,
    allowUrl: isSkillsShUrl,
  });
  return githubSourceIn(page.html, page.url);
}
