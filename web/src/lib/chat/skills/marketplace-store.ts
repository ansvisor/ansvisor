import { supabaseAdmin } from '@/lib/supabase/admin';
import { readGithubSkill, type GithubOptions } from './github';
import { parseSkillImport, type ParsedImport } from './import';
import {
  MARKETPLACE_SKILLS,
  MARKETPLACE_TOPICS,
  filterMarketplace,
  marketplaceSkill,
  marketplaceTopicCounts,
  type MarketplaceSkill,
  type MarketplaceSort,
  type MarketplaceTopic,
} from './marketplace';
import { cleanMarketplaceFiles, editWords, type MarketplaceEdit } from './marketplace-cleanup';
import {
  canImportSkill,
  canSaveSkills,
  hasLibrarySkill,
  importSkill,
  skillRefusal,
  type ImportedSkill,
  type SkillRefusalCode,
  type SkillResult,
  type SkillStatus,
  type SkillViewer,
} from './store';

/**
 * The Library in a workspace (CHAT-17; Chat Wave 4 W4-18 and W4-19): the
 * catalog's cards by topic, search and sort, 30 at a time; a skill's
 * detail, read from the commit its row pins; and Add.
 *
 *   - Browse (items 1–6): the chips count the whole catalog; the meta row
 *     counts what the topic and the search leave. A card is meta data only
 *     (decision 9): no SKILL.md is read for it.
 *   - Detail (item 9): its SKILL.md and LICENSE read through the GitHub
 *     reader at the pinned commit, cleaned (item 15, marketplace-cleanup),
 *     then cleaned and scanned as an import is, by the Library's rules (its
 *     front matter read as a safe YAML subset; a price, an email address or
 *     a tracking URL worth a look, not a block: owner, 2026-11-05). What the
 *     card shows in place of the directory's score is Ansvisor's own scan
 *     (decision 10).
 *     A read is kept in memory by its pinned commit, which never changes.
 *   - Add (items 11–13): the import path of 00458 with the catalog row it
 *     came from (00465's library_ref). It waits off and private for an
 *     Admin's review; a Manager's Add asks the Admins. Only MIT (decision
 *     11). Once per workspace.
 *
 * Every role browses; Admins add and Managers ask (CHAT-17 v2, CHAT-20 §4).
 * Server only.
 */

/** Cards per page: the first 30, then "Show more" adds 30 (item 4). */
export const MARKETPLACE_PAGE = 30;

/** A card as the Library shows it (items 5–6), with the workspace's copy when it has one. */
export interface MarketplaceCard {
  id: string;
  name: string;
  description: string;
  /** owner/repo on GitHub. */
  repo: string;
  topics: MarketplaceTopic[];
  stars: number;
  installs: number | null;
  license: 'MIT';
  /**
   * The workspace's copy (00465's library_ref): its review status, and its
   * id for whoever may open its review (an Admin, or who added it).
   */
  added: { status: SkillStatus; skillId: string | null } | null;
}

/**
 * Add for an Admin and a Manager: the skill is on for them at once (owner,
 * 2026-11-09); nothing for the others. 'request' was a Manager's before.
 */
export type MarketplaceAdd = 'add' | 'request' | null;

export interface MarketplacePage {
  skills: MarketplaceCard[];
  /** How many the topic and the search leave: the meta row's count. */
  total: number;
  /** Where the next 30 start, or null at the end. */
  next: number | null;
  /** The chips' counts: the whole catalog's (item 2). */
  counts: { all: number } & Record<MarketplaceTopic, number>;
  can: { add: MarketplaceAdd };
}

export interface MarketplaceQuery {
  topic: MarketplaceTopic | null;
  sort: MarketplaceSort;
  q: string;
  offset: number;
}

/** The list's query from the address: a topic chip, the sort, the search and where to start. */
export function marketplaceQuery(params: URLSearchParams): MarketplaceQuery {
  const topic = params.get('topic');
  const offset = Number(params.get('offset') ?? 0);
  return {
    topic: (MARKETPLACE_TOPICS as readonly string[]).includes(topic ?? '')
      ? (topic as MarketplaceTopic)
      : null,
    sort: params.get('sort') === 'installs' ? 'installs' : 'stars',
    q: (params.get('q') ?? '').slice(0, 200),
    offset:
      Number.isInteger(offset) && offset > 0 ? Math.min(offset, MARKETPLACE_SKILLS.length) : 0,
  };
}

/** Whether the person adds (an Admin), asks (a Manager) or only browses, while the workspace isn't read-only. */
export function marketplaceAdd(viewer: Pick<SkillViewer, 'role' | 'plan'>): MarketplaceAdd {
  if (!canSaveSkills(viewer.role) || !viewer.plan.writable) return null;
  return 'add';
}

type AddedRow = { id: string; library_ref: string; status: string; created_by: string | null };

/** The workspace's Library skills by their catalog row. */
async function addedSkills(viewer: SkillViewer): Promise<Map<string, MarketplaceCard['added']>> {
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .select('id, library_ref, status, created_by')
    .eq('organization_id', viewer.organizationId)
    .not('library_ref', 'is', null);
  if (error) throw new Error(`Could not read the workspace's skills: ${error.message}`);
  const added = new Map<string, MarketplaceCard['added']>();
  for (const row of (data ?? []) as AddedRow[]) {
    added.set(row.library_ref, {
      status: row.status as SkillStatus,
      skillId: viewer.role === 'admin' || row.created_by === viewer.userId ? row.id : null,
    });
  }
  return added;
}

const cardOf = (
  skill: MarketplaceSkill,
  added: Map<string, MarketplaceCard['added']>,
): MarketplaceCard => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  repo: skill.repo,
  topics: skill.topics,
  stars: skill.stars,
  installs: skill.installs,
  license: skill.license,
  added: added.get(skill.id) ?? null,
});

/** One page of the Library's cards (items 2–4), with the workspace's copies. */
export async function listMarketplace(
  viewer: SkillViewer,
  query: MarketplaceQuery,
): Promise<MarketplacePage> {
  const matching = filterMarketplace(MARKETPLACE_SKILLS, {
    topic: query.topic,
    query: query.q,
    sort: query.sort,
  });
  const page = matching.slice(query.offset, query.offset + MARKETPLACE_PAGE);
  const added = await addedSkills(viewer);
  const end = query.offset + page.length;
  return {
    skills: page.map((skill) => cardOf(skill, added)),
    total: matching.length,
    next: end < matching.length ? end : null,
    counts: marketplaceTopicCounts(MARKETPLACE_SKILLS),
    can: { add: marketplaceAdd(viewer) },
  };
}

// ─── Reading a skill at its pinned commit ───────────────────────────────────

/** What a read found: the skill as an import keeps it, and what Ansvisor's cleanup took out. */
export interface MarketplaceRead {
  parsed: ParsedImport;
  /** The skill's folder at the pinned commit (kept as source_url). */
  sourceUrl: string;
  commitSha: string;
  edits: MarketplaceEdit[];
}

/** The skill's folder on GitHub at the commit its row pins. */
export function marketplaceFolderUrl(skill: MarketplaceSkill): string {
  const folder = skill.source.path.replace(/(^|\/)SKILL\.md$/, '');
  const tail = folder ? `/${folder.split('/').map(encodeURIComponent).join('/')}` : '';
  return `https://github.com/${skill.repo}/tree/${skill.source.commit}${tail}`;
}

/** Reads kept by id: a pinned commit never changes. The oldest goes first past the cap. */
const READS = new Map<string, MarketplaceRead>();
const MAX_READS = 100;

/** Forgets the reads kept (tests). */
export function forgetMarketplaceReads(): void {
  READS.clear();
}

/**
 * A catalog skill read at its pinned commit: its files through the GitHub
 * reader, its SKILL.md cleaned as its row says, then cleaned, scanned and
 * its license read as any import is. Only MIT is taken (decision 11).
 * Refusals as values.
 */
export async function readMarketplaceSkill(
  skill: MarketplaceSkill,
  github?: GithubOptions,
): Promise<SkillResult<MarketplaceRead>> {
  const kept = READS.get(skill.id);
  if (kept) return { ok: true, value: kept };
  const read = await readGithubSkill(marketplaceFolderUrl(skill), github);
  if (!read.ok) return skillRefusal(read.refusal.code, read.refusal.detail);
  const cleaned = cleanMarketplaceFiles(read.value.files, skill.cleanup);
  // A Library skill's own rules: its YAML read, and only item 16's findings block it.
  const parsed = parseSkillImport(cleaned.files, { library: true });
  if (!parsed.ok) return skillRefusal(parsed.refusal.code, parsed.refusal.detail);
  if (parsed.value.parts.license !== 'MIT') return skillRefusal('library_license');
  const value: MarketplaceRead = {
    parsed: {
      ...parsed.value,
      // Ansvisor's own edits first, in the removed list a review shows.
      removed: [...cleaned.edits.map(editWords), ...parsed.value.removed],
    },
    sourceUrl: read.value.sourceUrl,
    commitSha: read.value.commitSha,
    edits: cleaned.edits,
  };
  READS.set(skill.id, value);
  if (READS.size > MAX_READS) READS.delete(READS.keys().next().value as string);
  return { ok: true, value };
}

/** A skill's detail (item 9): its card, its source at the pinned commit, and what Ansvisor read. */
export interface MarketplaceDetail {
  skill: MarketplaceCard;
  /** The SKILL.md on GitHub at the pinned commit (…/blob/<commit>/<path>). */
  fileUrl: string;
  commit: string;
  read:
    | {
        ok: true;
        title: string;
        /** The cleaned body, plain text: nothing in it runs. */
        body: string;
        compatibility: string | null;
        license: 'MIT';
        licenseText: string | null;
        /** Ansvisor's own scan (decision 10). */
        scan: { blocks: string[]; warns: string[] };
        /** What adding it leaves out (scripts, other files, fields, comments). */
        removed: string[];
        /** "Edited by Ansvisor" (item 15): the row's cleanups that took something out. */
        edits: MarketplaceEdit[];
      }
    | { ok: false; code: SkillRefusalCode; error: string };
  can: { add: MarketplaceAdd };
}

/** A catalog skill's detail, by its id; null when the catalog has none. */
export async function readMarketplaceDetail(
  viewer: SkillViewer,
  id: string,
  github?: GithubOptions,
): Promise<MarketplaceDetail | null> {
  const skill = marketplaceSkill(id);
  if (!skill) return null;
  const [added, read] = await Promise.all([
    addedSkills(viewer),
    readMarketplaceSkill(skill, github),
  ]);
  return {
    skill: cardOf(skill, added),
    fileUrl: skill.source.url,
    commit: skill.source.commit,
    read: read.ok
      ? {
          ok: true,
          title: read.value.parsed.parts.title,
          body: read.value.parsed.parts.body,
          compatibility: read.value.parsed.parts.compatibility ?? null,
          license: 'MIT',
          licenseText: read.value.parsed.licenseText,
          scan: read.value.parsed.scan,
          // The import's own (the edits' words lead the list, one each: they show apart).
          removed: read.value.parsed.removed.slice(read.value.edits.length),
          edits: read.value.edits,
        }
      : { ok: false, code: read.refusal.code, error: read.refusal.message },
    can: { add: marketplaceAdd(viewer) },
  };
}

/**
 * Adds a catalog skill to the workspace (items 11–13, W4-19): an Admin's
 * or a Manager's, as an import is (a paid plan, the plan's limit, a name
 * of its own), once per workspace. It is read at its pinned commit,
 * cleaned and scanned, and is on at once for whoever added it, private,
 * under My skills with its license, source and commit (owner, 2026-11-09:
 * no Admin review for the Library's skills). One the scan blocks isn't kept.
 */
export async function addMarketplaceSkill(
  viewer: SkillViewer,
  id: string,
  github?: GithubOptions,
): Promise<SkillResult<ImportedSkill>> {
  const skill = marketplaceSkill(id);
  if (!skill) return skillRefusal('not_found');
  // Who and which plan first, then whether it is here already: neither reads GitHub.
  const cannot = canImportSkill(viewer);
  if (cannot) return cannot.refusal.code === 'import_plan' ? skillRefusal('library_plan') : cannot;
  if (await hasLibrarySkill(viewer.organizationId, skill.id)) return skillRefusal('library_added');
  const read = await readMarketplaceSkill(skill, github);
  if (!read.ok) return read;
  // A copy the scan blocks could never be approved: none is kept.
  if (read.value.parsed.status === 'blocked') return skillRefusal('blocked');
  return importSkill(viewer, read.value.parsed, {
    url: read.value.sourceUrl,
    commitSha: read.value.commitSha,
    libraryRef: skill.id,
  });
}
