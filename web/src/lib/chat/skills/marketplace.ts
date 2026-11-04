import marketplace from './marketplace.json';

/**
 * The Library (CHAT-17, "701 · MIT"; Chat Wave 4, W4-17): third-party skills
 * a workspace can add, as a catalog. Not Ansvisor's own skills, which are
 * library.ts's: in code the third-party catalog is the "marketplace", so the
 * two never mix.
 *
 * The catalog is meta data only (owner decision 9): each skill's name, line,
 * repo, topics, stars, installs, license and the GitHub file it is pinned
 * to. No SKILL.md body is kept in the repo; the detail and Add read it from
 * that pinned commit. The source is marketplace.csv, next to this file: the
 * 701 skills of the 2026-10-18 import whose MIT license was verified on
 * GitHub, one row each. marketplace.json is built from it by
 * buildMarketplace, and marketplace.test.ts keeps the two in step (refresh:
 * `yarn test -u src/lib/chat/skills`).
 *
 * Attribution: each skill's name and description belong to its authors,
 * under the MIT license of the repository its row names. When a workspace
 * adds a skill, that license's text is read from the pinned commit and kept
 * with the skill, as for any import (00458).
 *
 * The directory's own security score is left out (owner decision 10): the
 * Library shows Ansvisor's own scan instead, when a skill is read. Only MIT
 * skills are listed (decision 11). Server only: the page gets what an API
 * route hands it.
 */

/** The Library's topics, in the chips' order (CHAT-17 item 2). */
export const MARKETPLACE_TOPICS = [
  'seo',
  'content',
  'brand',
  'analytics',
  'social',
  'cro',
  'email',
  'paid-ads',
  'growth',
  'gtm',
] as const;
export type MarketplaceTopic = (typeof MARKETPLACE_TOPICS)[number];

/**
 * A catalog line's text to drop when the skill is read (CHAT-17 item 15):
 * named here by what it is, and found by marketplace-cleanup (W4-18) in the
 * skill's text.
 *   - research-lines: lines citing a competitor's research figures;
 *   - extension-line: a line listing a competitor's extension;
 *   - promo-block: a paid-pack promo between community-cta markers.
 */
export const MARKETPLACE_CLEANUPS = ['research-lines', 'extension-line', 'promo-block'] as const;
export type MarketplaceCleanup = (typeof MARKETPLACE_CLEANUPS)[number];

export interface MarketplaceSkill {
  /** owner/repo/folder: its id in the API, and chat_skills.library_ref (00465). */
  id: string;
  name: string;
  /** The catalog's line, at most 200 characters, cut at a whole sentence or word. */
  description: string;
  /** owner/repo on GitHub. */
  repo: string;
  /** None for 14 skills, which show only under All. */
  topics: MarketplaceTopic[];
  /** The repo's GitHub stars (per repo, not per skill). */
  stars: number;
  /** Installs on skills.sh; null when it has none (2 skills). */
  installs: number | null;
  license: 'MIT';
  /** The SKILL.md on GitHub at the commit the import read. */
  source: { url: string; commit: string; path: string };
  /** What to drop from its text before it is shown or added; absent when nothing. */
  cleanup?: MarketplaceCleanup[];
}

/** The catalog, as marketplace.json keeps it: by id. */
export const MARKETPLACE_SKILLS: readonly MarketplaceSkill[] = (
  marketplace as { skills: MarketplaceSkill[] }
).skills;

const BY_ID = new Map(MARKETPLACE_SKILLS.map((skill) => [skill.id, skill]));

/** A catalog skill by its id, or null. */
export function marketplaceSkill(id: string): MarketplaceSkill | null {
  return BY_ID.get(id) ?? null;
}

/**
 * A count as the cards show it (CHAT-17 item 6): under 1,000 as is,
 * 1,000–9,999 with one decimal ("6.9K"), 10,000 and up without ("48K"),
 * millions with one ("1.2M"). A trailing ".0" is dropped.
 */
export function formatSkillCount(value: number): string {
  const n = Math.max(0, Math.round(value));
  const short = (num: number, digits: number) => num.toFixed(digits).replace(/\.0$/, '');
  if (n < 1000) return String(n);
  if (n < 9950) return `${short(n / 1000, 1)}K`;
  if (n < 999_500) return `${short(n / 1000, 0)}K`;
  return `${short(n / 1_000_000, 1)}M`;
}

export type MarketplaceSort = 'stars' | 'installs';

/**
 * The skills a filter shows (CHAT-17 items 3–4): one topic or all, those
 * whose name, line or repo hold every word searched for, by stars or by
 * installs (a missing count last), ties by stars, then by name.
 */
export function filterMarketplace(
  skills: readonly MarketplaceSkill[],
  {
    topic = null,
    query = '',
    sort = 'stars',
  }: { topic?: MarketplaceTopic | null; query?: string; sort?: MarketplaceSort } = {},
): MarketplaceSkill[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const byName = (a: MarketplaceSkill, b: MarketplaceSkill) =>
    a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return skills
    .filter((skill) => !topic || skill.topics.includes(topic))
    .filter((skill) => {
      if (words.length === 0) return true;
      const text = `${skill.name}\n${skill.description}\n${skill.repo}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) =>
      sort === 'installs'
        ? (b.installs ?? -1) - (a.installs ?? -1) || b.stars - a.stars || byName(a, b)
        : b.stars - a.stars || byName(a, b),
    );
}

/** How many skills each topic chip holds, and All (CHAT-17 item 2). */
export function marketplaceTopicCounts(
  skills: readonly MarketplaceSkill[],
): { all: number } & Record<MarketplaceTopic, number> {
  const counts = Object.fromEntries(MARKETPLACE_TOPICS.map((topic) => [topic, 0])) as Record<
    MarketplaceTopic,
    number
  >;
  for (const skill of skills) for (const topic of skill.topics) counts[topic] += 1;
  return { all: skills.length, ...counts };
}

// ─── Building marketplace.json from the CSV ─────────────────────────────────

/** The CSV's topic names, as the import wrote them. */
const TOPIC_OF: Record<string, MarketplaceTopic> = {
  SEO: 'seo',
  Content: 'content',
  Brand: 'brand',
  Analytics: 'analytics',
  Social: 'social',
  CRO: 'cro',
  Email: 'email',
  'Paid Ads': 'paid-ads',
  Growth: 'growth',
  GTM: 'gtm',
};

/** A pinned SKILL.md on GitHub: owner, repo, a 40-character commit and the file's path. */
const PINNED =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{40})\/((?:.+\/)?SKILL\.md)$/;

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "1.4K" → 1400, "43" → 43, "" → null. */
function countOf(value: string): number | null {
  const match = /^([\d.]+)\s*([KM]?)$/i.exec(value.trim().replace(/,/g, ''));
  if (!match) return null;
  const scale = { '': 1, K: 1000, M: 1_000_000 }[match[2].toUpperCase() as '' | 'K' | 'M'];
  return Math.round(Number(match[1]) * scale);
}

/**
 * The import cut lines near 200 characters, often mid-word, and the directory
 * added "It gives the agent…" to many. A cut line drops that clause, then ends
 * at its last whole sentence when that keeps 60 characters, else at its last
 * whole word with an ellipsis.
 */
function descriptionOf(value: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  const cut = text.length >= 190 || text.includes(' It gives the agent');
  if (!cut || /[.!?)]$/.test(text)) return text;
  const own = text.split(' It gives the agent')[0];
  if (own !== text && /[.!?)]$/.test(own)) return own;
  const sentence = own.slice(0, Math.max(own.lastIndexOf('. '), 0) + 1);
  if (sentence.length >= 60) return sentence;
  const words = own === text ? own.slice(0, own.lastIndexOf(' ')) : own;
  return `${words.replace(/[\s,;:—–-]+$/, '')}…`;
}

/** A row's Cleanup cell (CHAT-17 item 15): the cleanups, `;` between them. */
function cleanupOf(value: string, name: string): MarketplaceCleanup[] | undefined {
  const out = value
    .split(';')
    .map((cleanup) => cleanup.trim())
    .filter(Boolean)
    .map((cleanup) => {
      if (!(MARKETPLACE_CLEANUPS as readonly string[]).includes(cleanup)) {
        throw new Error(`"${name}": unknown cleanup ${cleanup}`);
      }
      return cleanup as MarketplaceCleanup;
    });
  return out.length > 0 ? out : undefined;
}

/** marketplace.csv's columns, in order. */
export const MARKETPLACE_CSV_COLUMNS = [
  'Id',
  'Skill',
  'Description',
  'Repo',
  'Topics',
  'License',
  'GitHub stars',
  'skills.sh installs',
  'Cleanup',
  'SKILL.md source (pinned commit)',
] as const;

/**
 * marketplace.json from marketplace.csv: every row, each MIT (verified on
 * GitHub, decision 11) and pinned to a commit, by id. A row whose id isn't
 * its pinned file's owner/repo/folder, or whose repo or license doesn't
 * match, is refused.
 */
export function buildMarketplace(csv: string): { skills: MarketplaceSkill[] } {
  const [header, ...rows] = parseCsv(csv).filter((row) => row.some((cell) => cell !== ''));
  const col = (name: (typeof MARKETPLACE_CSV_COLUMNS)[number]) => {
    const at = header.indexOf(name);
    if (at < 0) throw new Error(`marketplace.csv has no "${name}" column`);
    return at;
  };
  const c = {
    id: col('Id'),
    name: col('Skill'),
    description: col('Description'),
    repo: col('Repo'),
    topics: col('Topics'),
    license: col('License'),
    stars: col('GitHub stars'),
    installs: col('skills.sh installs'),
    cleanup: col('Cleanup'),
    source: col('SKILL.md source (pinned commit)'),
  };
  const skills = rows
    .map((row): MarketplaceSkill => {
      const url = row[c.source];
      const pin = PINNED.exec(url);
      if (!pin) throw new Error(`"${row[c.name]}": no pinned SKILL.md link`);
      const [, owner, repo, commit, file] = pin;
      if (`${owner}/${repo}` !== row[c.repo]) throw new Error(`"${row[c.name]}": repo mismatch`);
      if (row[c.license] !== 'MIT') throw new Error(`"${row[c.name]}": not MIT`);
      const folder = file.split('/').slice(-2, -1)[0] ?? repo;
      const id = `${owner}/${repo}/${folder}`;
      if (row[c.id] !== id) throw new Error(`"${row[c.name]}": id isn't ${id}`);
      const topics = row[c.topics]
        .split(';')
        .map((topic) => topic.trim())
        .filter(Boolean)
        .map((topic) => {
          const id = TOPIC_OF[topic];
          if (!id) throw new Error(`"${row[c.name]}": unknown topic ${topic}`);
          return id;
        });
      const cleanup = cleanupOf(row[c.cleanup], row[c.name]);
      return {
        id,
        name: row[c.name].trim(),
        description: descriptionOf(row[c.description]),
        repo: row[c.repo],
        topics: MARKETPLACE_TOPICS.filter((topic) => topics.includes(topic)),
        stars: countOf(row[c.stars]) ?? 0,
        installs: countOf(row[c.installs]),
        license: 'MIT',
        source: { url, commit, path: file },
        ...(cleanup ? { cleanup } : {}),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { skills };
}
