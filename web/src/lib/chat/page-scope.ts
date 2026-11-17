import type { ZodType } from 'zod';
import { searchWords } from '@/lib/mcp/lookup';
import { pageRoute, samePage } from './page-route';
import { viewPage, viewPathId } from './page-view';
import type { ChatTool } from './registry/define-tool';

/**
 * The page's filters as a read's inputs (the owner's rule, 2026-11-16: Chat
 * opened on a page reads what that page shows). The side panel sends the
 * page's filters as chips (page-context.ts contextChips, `filter:{key}`);
 * each one Chat can read the same way the page does fills its input on a
 * read that takes it, when the model gave none. The person's own words win:
 * an input the model gave stays, "" asks for all of them, and a question
 * that asks for all platforms (topics, regions…) drops that chip. A chip
 * whose value no read takes the same way stays text only, never guessed.
 *
 * Platform, region and topic are the brand's data as every visibility read
 * cuts it: they apply to every read of the page's brand that takes them.
 * A list's own filters (status, category, impact, type, sources, prompt)
 * mean one thing on each page (Actions' "In progress" is not Content's), so
 * they apply only to the reads of the page's own list. A read of another
 * brand, or one that names its rows (codes, ids, domains, urls), takes
 * none.
 *
 * The page's search (its view, the owner's plan of 2026-11-16, item 8) is
 * one more list filter: it fills `search` on the reads of the page's own
 * list that take one (Prompts' list_prompts, Content's
 * list_content_opportunities, Mentions' reads; since step 9 History's
 * get_action_history, Agents' list_my_agents and Products'
 * list_catalog_products), as the lookups' own words
 * (#2460: at most 8 words of the first 200 characters, escaped by the read),
 * unless the model gave its own search or named rows, or the question asks
 * for all of them. Where a read's search is a lookup in every status
 * (list_prompts, list_content_opportunities: it has AS_LISTED), the page's
 * search also sets AS_LISTED, so it reads the list as the page lists it:
 * with the page's filters, archived set aside, in the read's sort (the
 * maintainer's review of 2026-11-17). The model's own search on such a read
 * is a lookup by name, in every status: like named rows, it takes none of
 * the page's filters, so none is said to be applied.
 *
 * An item's own page whose id is one of these filters (since step 9's
 * detail pages, PATH_FILTERS): a topic's page is its brand's data for that
 * topic, so the id in its path is the page's topic filter, as a topic chip.
 * Plain module: scope.ts applies it to every read.
 */

/** A page's filter, as its chip carries it (`filter:platform` → `platform`). */
export interface PageFilter {
  key: string;
  label: string;
  value: string;
}

/** What the page a question came from shows: its path, its brand and its filters. */
export interface PageScope {
  /**
   * The page's path as Chat matches it ("/dashboard/citations"; page-route.ts:
   * "/dashboard/prompts" is "/dashboard/prompts/tracked"); null when the panel didn't send one.
   */
  route: string | null;
  /** The brand chip's brand (the run's own, messageScopeOf); null when it was left out. */
  brandId: string | null;
  filters: PageFilter[];
  /** The page's search box, from its view; absent when it has none. */
  search?: string;
  /** The page's open tab, from its view; absent when it has none. */
  tab?: string;
}

interface ScopeChip {
  key: string;
  label: string;
  value?: string;
}

/**
 * An item's own page whose id is one of the page's filters (page-view.ts
 * viewPathId), by its pattern: a topic's page shows its brand's data for
 * that topic, so its id fills topic_id on every read of its brand that takes
 * one, unless the model gave its own, and "all topics" drops it. The other
 * items' pages name their item to the reader instead (page-view-scope.ts):
 * their reads' id is required (get_report, list_site_audit_issues,
 * get_product_ai_says), or makes a read a lookup of that item alone
 * (get_prompt_performance's prompt_ids), which a ranking asked there must
 * not become.
 */
const PATH_FILTERS: Readonly<Record<string, string>> = {
  '/dashboard/prompts/topics/[id]': 'topic',
};

/** The page's scope from a message's context; null when it came from no page. */
export function pageScopeOf(
  context:
    | {
        route?: string;
        chips: readonly ScopeChip[];
        view?: { search?: string; tab?: string };
      }
    | null
    | undefined,
): PageScope | null {
  if (!context) return null;
  // As Chat matches pages: /dashboard/prompts is Tracked Prompts (page-route.ts).
  const route = pageRoute(context.route);
  const brandId = context.chips.find((chip) => chip.key === 'brand')?.value || null;
  const filters = context.chips.flatMap((chip) =>
    chip.key.startsWith('filter:') && chip.value
      ? [{ key: chip.key.slice('filter:'.length), label: chip.label, value: chip.value }]
      : [],
  );
  // An item's own page: its id as the page's filter, where the page sent none of that key.
  const page = viewPage(route);
  const pathFilter = page && Object.hasOwn(PATH_FILTERS, page) ? PATH_FILTERS[page] : null;
  const pathId = pathFilter ? viewPathId(route) : null;
  if (pathFilter && pathId && !filters.some((filter) => filter.key === pathFilter)) {
    filters.push({ key: pathFilter, label: pathId, value: pathId });
  }
  const search = context.view?.search?.trim();
  const tab = context.view?.tab?.trim();
  return { route, brandId, filters, ...(search ? { search } : {}), ...(tab ? { tab } : {}) };
}

/**
 * Which input a page's platform chip fills: Visibility's and Citations' (and
 * a cited page's) hold the AI models answers are stored under (a family's
 * slugs joined, the reads' `model`), Mentions' a platform id (`platform`).
 * Products' is an AI shopping channel ("chatgpt-shopping"), which only its
 * own list's reads take. AI Traffic's is the site a visit came from and
 * Signals' an engine its signals are about, which no read takes: text only.
 */
const PLATFORM_FIELDS: Readonly<Record<string, { field: 'model' | 'platform'; ownList?: true }>> = {
  '/dashboard/insights': { field: 'model' },
  '/dashboard/citations': { field: 'model' },
  '/dashboard/citations/url': { field: 'model' },
  '/dashboard/mentions': { field: 'platform' },
  '/dashboard/shopping': { field: 'platform', ownList: true },
};

/**
 * The input a page's open tab fills on its own list's reads, where the tab
 * is the list's filter: Agents' Mine, Workspace, Paused and Archived are
 * list_my_agents' `view`.
 */
const TAB_FIELDS: Readonly<Record<string, string>> = {
  '/dashboard/agents': 'view',
};

/** Citations' Sources (the table's scope) as list_citations names them. */
const SOURCE_FILTERS: Readonly<Record<string, string>> = {
  all: 'all',
  own: 'owned',
  competitors: 'competitor',
  third_party: 'external',
};

interface FilterRule {
  /** The input it fills. */
  field: string;
  /** Only on the reads of the page's own list (the tool's route is the page's). */
  ownList?: boolean;
  /** The chip's value as the input takes it; null when it isn't one. */
  value?: (value: string) => string | null;
}

/**
 * How a page's filter becomes an input; null for one Chat reads only as
 * text. A list filter fills only a read of the page's own list that takes
 * it (History's priority and source, Signals' source, Plan's card), so
 * Actions' priority stays text: its read has no such input.
 */
function ruleOf(key: string, route: string | null): FilterRule | null {
  switch (key) {
    case 'platform': {
      const platform =
        route && Object.hasOwn(PLATFORM_FIELDS, route) ? PLATFORM_FIELDS[route] : null;
      return platform
        ? { field: platform.field, ...(platform.ownList ? { ownList: true } : {}) }
        : null;
    }
    case 'region':
      return { field: 'region' };
    case 'topic':
      return { field: 'topic_id' };
    case 'prompt':
      return { field: 'prompt_id', ownList: true };
    case 'sources':
      return { field: 'source_filter', ownList: true, value: (v) => SOURCE_FILTERS[v] ?? null };
    case 'status':
    case 'category':
    case 'impact':
    case 'type':
    case 'priority':
    case 'source':
    case 'card':
      return { field: key, ownList: true };
    default:
      return null;
  }
}

/** Every input a page's filter may fill: a model's "" in one asks for all. */
const PAGE_FIELDS = ['model', 'platform', 'region'] as const;

/**
 * Inputs that name a read's rows: each named row comes back, whatever the
 * page shows. A lookup read's own search names them too (searchLooksUp).
 */
const LOOKUP_FIELDS = ['codes', 'ids', 'domains', 'urls'] as const;

const EDGE = String.raw`(?<![\p{L}\d])`;
/** "all platforms", "every region", "each topic", "tüm platformlar", "her bölgede". */
function allOf(english: string, turkish: string): RegExp {
  return new RegExp(
    `${EDGE}(?:all|every|each)\\s+(?:(?:the|my|our)\\s+)?(?:${english})(?![\\p{L}])|${EDGE}(?:tüm|bütün|her)\\s+(?:${turkish})`,
    'iu',
  );
}

/** A question that asks for all of a filter's values: that chip of the page is dropped. */
const ASKS_ALL: Readonly<Record<string, RegExp>> = {
  platform: allOf(
    'platforms?|engines?|ai engines?|ai platforms?|ais|models?|llms?',
    'platform|motor|model|yapay zeka',
  ),
  region: allOf('regions?|countries|country|locations?|markets?', 'bölge|ülke|konum|pazar'),
  topic: allOf('topics?', 'konu'),
  prompt: allOf('prompts?|queries|questions', 'prompt|soru|sorgu'),
  sources: allOf('sources?|domains?|sites?', 'kaynak|alan ad|site'),
  status: allOf('status(?:es)?', 'durum'),
  category: allOf('categor(?:y|ies)', 'kategori'),
  impact: allOf('impacts?|impact levels?', 'etki'),
  type: allOf('types?', 'tür|tip'),
  priority: allOf('priorit(?:y|ies)|priority levels?', 'öncelik'),
  source: allOf('sources?', 'kaynak'),
  card: allOf('cards?|plan rows?|rows?', 'kart|satır'),
  // The page's tab as its list's filter (Agents' Paused): "all agents", "tüm agentlar".
  tab: allOf('agents?|tabs?', 'agent|ajan|sekme'),
  // The page's search: "all prompts", "every opportunity", "tüm promptlar", "without the search".
  search: new RegExp(
    `${
      allOf(
        'prompts?|queries|questions|opportunit(?:y|ies)|drafts?|reports?|mentions?|answers?|items?|rows?|results?|actions?|agents?|products?',
        'prompt|soru|sorgu|fırsat|taslak|rapor|bahsetme|yanıt|cevap|öğe|satır|sonuç|aksiyon|agent|ajan|ürün',
      ).source
    }|\\b(?:without|ignoring|ignore)\\s+(?:the\\s+|my\\s+|this\\s+)?search\\b|aramasız|arama(?:yı)?\\s+(?:olmadan|yok\\s+say)`,
    'iu',
  ),
};

/** Whether the question asks for all of a filter's values ("all platforms"). */
export function asksAllOf(key: string, question: string | null | undefined): boolean {
  return !!question && (ASKS_ALL[key]?.test(question) ?? false);
}

/** The schema of a read's input field; undefined when it takes none. */
const fieldOf = (tool: Pick<ChatTool, 'inputSchema'>, field: string): ZodType | undefined =>
  (tool.inputSchema.shape as Record<string, ZodType | undefined>)[field];

/**
 * The input of a read whose `search` is a lookup in every status that
 * searches its list as the page lists it instead: its filters and sort apply.
 */
export const AS_LISTED = 'as_listed';

/** The model's own search on a read whose search is a lookup by name, in every status. */
const searchLooksUp = (tool: Pick<ChatTool, 'inputSchema'>, raw: Record<string, unknown>) =>
  !!fieldOf(tool, AS_LISTED) &&
  typeof raw.search === 'string' &&
  raw.search.trim() !== '' &&
  raw[AS_LISTED] !== true;

/**
 * A read's input with the page's filters where they apply, and the keys of
 * those that did ("platform", "sources"), in the page's order. The model's
 * own inputs stay; a "" it gave for a platform, model or region is taken out
 * (all of them). Each value is checked against its input's schema first.
 */
export function pageFilterInputs(
  tool: Pick<ChatTool, 'inputSchema'> & Partial<Pick<ChatTool, 'route'>>,
  raw: Record<string, unknown>,
  page: PageScope | null,
  question: string | null | undefined,
): { input: Record<string, unknown>; applied: string[] } {
  const input: Record<string, unknown> = { ...raw };
  const applied: string[] = [];
  // The read's route is the page's, an alias as its page (page-route.ts).
  const ownList = !!page && samePage(tool.route, page.route);
  // A read of no brand (Agents' list_my_agents: the person's agents) takes its own page's
  // list filters only, never a brand's data cut (platform, region, topic).
  const brandless = !fieldOf(tool, 'brand_id');
  if (
    page &&
    page.brandId &&
    (input.brand_id === page.brandId || (brandless && ownList)) &&
    !LOOKUP_FIELDS.some((field) => Array.isArray(raw[field]) && raw[field].length > 0) &&
    !searchLooksUp(tool, raw)
  ) {
    for (const filter of page.filters) {
      const rule = ruleOf(filter.key, page.route);
      if (!rule || (rule.ownList && !ownList) || (brandless && !rule.ownList)) continue;
      const schema = fieldOf(tool, rule.field);
      // The model's own input, or an earlier chip's, stays.
      if (!schema || rule.field in input || asksAllOf(filter.key, question)) continue;
      const value = rule.value ? rule.value(filter.value) : filter.value;
      if (!value || !schema.safeParse(value).success) continue;
      input[rule.field] = value;
      applied.push(filter.key);
    }
    // The page's tab, where it is its own list's filter (TAB_FIELDS), as the read names it.
    const tabField =
      page.tab && page.route && Object.hasOwn(TAB_FIELDS, page.route)
        ? TAB_FIELDS[page.route]
        : null;
    const tabSchema = tabField ? fieldOf(tool, tabField) : undefined;
    if (
      tabField &&
      tabSchema &&
      ownList &&
      !(tabField in raw) &&
      !asksAllOf('tab', question) &&
      tabSchema.safeParse(page.tab).success
    ) {
      input[tabField] = page.tab;
      applied.push('tab');
    }
    // The page's search, on its own list's reads that take one, in the lookups' words.
    const search = searchWords(page.search).join(' ');
    const schema = fieldOf(tool, 'search');
    if (
      search &&
      ownList &&
      schema &&
      !('search' in raw) &&
      !asksAllOf('search', question) &&
      schema.safeParse(search).success
    ) {
      input.search = search;
      // Within the list as the page lists it, its filters and sort with it: not a lookup.
      if (fieldOf(tool, AS_LISTED)) input[AS_LISTED] = true;
      applied.push('search');
    }
  }
  for (const name of PAGE_FIELDS) {
    if (input[name] === '') delete input[name];
  }
  return { input, applied };
}
