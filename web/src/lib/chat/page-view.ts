/**
 * What a page shows beyond its chips (the owner's plan of 2026-11-16, item
 * 8: "Chat opened on any page reads all of that page's data"): the open
 * tab, the sort and search the person chose, the rows on screen by the code
 * or id the page shows, with their title, and how many the list has. The
 * page builds it with its context (useChatPageContext), the side panel adds
 * the page's own URL state (its query, by a list of keys per page), and the
 * composer sends it beside the chips. The engine checks it all again and
 * reads it as untrusted data (page-view-scope.ts): it never scopes a read
 * or grants anything. Plain module: the browser and the server read it.
 */

import { pageRoute } from './page-route';

/** The page's sort: its own key for it (the `?sort=` value), and which way. */
export interface ChatPageSort {
  key: string;
  dir: 'asc' | 'desc';
}

/**
 * A row on screen: the code the page shows (AC-12, S-07), else its id,
 * domain or address, or on a page whose rows are named by a key (a KPI's,
 * a kind of action's) that key.
 */
export interface ChatPageViewRow {
  ref: string;
  /** What the row shows of it: its title, text or domain. */
  label: string;
}

/**
 * An item the page holds open that its URL doesn't name (a drawer, the
 * agent a page is about): its ref where it has one, and what it shows of it.
 */
export interface ChatPageOpenItem {
  ref?: string;
  label: string;
}

export interface ChatPageView {
  /** The open tab, by the page's own name for it. */
  tab?: string;
  sort?: ChatPageSort;
  /** The page's search box, as typed. */
  search?: string;
  /** The rows on screen, in the page's order (PAGE_VIEW_ROWS at most). */
  rows?: ChatPageViewRow[];
  /** How many rows the list has, where the page knows it. */
  total?: number;
  /** An item the page holds open outside its URL (the URL's own: `query`). */
  open?: ChatPageOpenItem;
  /** The page's URL state: only the keys it keeps (PAGE_QUERY_KEYS), added by the side panel. */
  query?: Record<string, string>;
}

/** The most rows a view carries; past them, the list's own read in its order. */
export const PAGE_VIEW_ROWS = 100;
/** The most a row's label keeps: the same as a chip's (engine PAGE_LABEL_CHARS). */
export const PAGE_VIEW_LABEL_CHARS = 200;
/** The most URL keys, and characters in each value, a view keeps. */
export const PAGE_QUERY_MAX_KEYS = 20;
export const PAGE_QUERY_VALUE_CHARS = 300;

/** A label cut to PAGE_VIEW_LABEL_CHARS, on one line; never half of an emoji. */
export function viewLabel(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= PAGE_VIEW_LABEL_CHARS) return line;
  let end = PAGE_VIEW_LABEL_CHARS - 1;
  const last = line.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${line.slice(0, end).trimEnd()}…`;
}

/**
 * The rows on screen as a view carries them: in the page's order, the
 * first PAGE_VIEW_ROWS, each label cut; a row without a ref or a label is
 * left out.
 */
export function viewRows<T>(
  items: readonly T[] | null | undefined,
  row: (item: T) => { ref: string | null | undefined; label: string | null | undefined },
): ChatPageViewRow[] {
  const rows: ChatPageViewRow[] = [];
  for (const item of items ?? []) {
    if (rows.length >= PAGE_VIEW_ROWS) break;
    const { ref, label } = row(item);
    const text = label ? viewLabel(label) : '';
    if (ref && text) rows.push({ ref: ref.trim(), label: text });
  }
  return rows;
}

const CITATION_FILTERS = ['preset', 'from', 'to', 'platform', 'region', 'topic', 'prompt'];
const PROMPTS_KEYS = [
  'range',
  'from',
  'to',
  'region',
  'status',
  'sort',
  'dir',
  'layout',
  // The prompt whose Positions panel is open, and the panel's range.
  'positions',
  'positionsRange',
  'positionsFrom',
  'positionsTo',
];

/**
 * The URL keys each page keeps as its state (writeUrlParams, or what it reads
 * as its tab, filters, sort, search or open drawer), by its path. Any other
 * key (a token, a code, a `next=` address, a link's campaign tags) never
 * leaves the browser with a message. AI Referral Traffic keeps its state in
 * the browser and Ads its tab in the hash: no query.
 */
export const PAGE_QUERY_KEYS: Readonly<Record<string, readonly string[]>> = {
  '/dashboard/action-center/actions': [
    'category',
    'priority',
    'status',
    'assignee',
    'sort',
    'q',
    'from',
    // The open drawer.
    'action',
  ],
  '/dashboard/content': [
    'status',
    'impact',
    'type',
    'source',
    'suggested',
    'from',
    'to',
    'sort',
    'prompt',
    // The open drawer.
    'opportunity',
  ],
  // And /dashboard/prompts, which opens on it (page-route.ts).
  '/dashboard/prompts/tracked': PROMPTS_KEYS,
  '/dashboard/prompts/suggestions': PROMPTS_KEYS,
  '/dashboard/prompts/topics': PROMPTS_KEYS,
  '/dashboard/prompts/fan-outs': PROMPTS_KEYS,
  '/dashboard/prompts/insights': PROMPTS_KEYS,
  '/dashboard/mentions': [
    'tab',
    'range',
    'from',
    'to',
    'platform',
    'region',
    'topic',
    'q',
    'sentiment',
    'with',
    'sort',
    'group',
  ],
  '/dashboard/citations': [...CITATION_FILTERS, 'scope'],
  // One cited page: its address (`u`) and the filters it opened with.
  '/dashboard/citations/url': ['u', ...CITATION_FILTERS],
  '/dashboard/insights': ['range', 'from', 'to', 'region', 'model', 'topic'],
  // The pages that send their context since step 9 (the owner's plan of 2026-11-16).
  '/dashboard/action-center/signals': [
    'range',
    'category',
    'impact',
    'status',
    'source',
    'platform',
    'q',
    // The open drawer.
    'signal',
  ],
  '/dashboard/action-center/history': [
    'view',
    'range',
    'status',
    'type',
    'priority',
    'source',
    'sort',
    'by',
    'q',
  ],
  // The open competitor (?competitor=) and the period.
  '/dashboard/competitors': ['preset', 'from', 'to', 'competitor'],
  '/dashboard/shopping': ['tab'],
  '/dashboard/audit': ['tab'],
  '/dashboard/content/library': ['tab', 'created', 'madeIn', 'sent', 'shopping', 'action'],
  '/dashboard/content/plan': ['days'],
  // An item's own page (its id in the path, ID_PAGES), by its pattern. A product's page opens on
  // the shelf its "Why not you?" names: a question (prompt) and its channel (platform).
  '/dashboard/shopping/products/[productId]': ['prompt', 'platform'],
};

/**
 * A path as the panel sends it, as Chat matches pages: without a trailing
 * slash, /dashboard/prompts as the Tracked Prompts page it opens on (page-route.ts).
 */
export const viewRoute = (route: string | null | undefined) => pageRoute(route);

/** An item's id in a path, as the app writes one (a guid: the demo brand's are made by hand). */
const PATH_ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const idPage = (parent: string, page: string): [RegExp, string] => [
  new RegExp(`^${parent}/${PATH_ID}$`, 'i'),
  page,
];

/**
 * Pages whose path holds an id, an item's own page: the page they are, by
 * its pattern. Since step 9's detail pages: a topic's, a prompt's, a saved
 * report's, a Site Audit report's, a product's, a content opportunity's and
 * an AI answer's.
 */
const ID_PAGES: readonly [RegExp, string][] = [
  idPage('/dashboard/agents', '/dashboard/agents/[id]'),
  idPage('/dashboard/prompts/topics', '/dashboard/prompts/topics/[id]'),
  idPage('/dashboard/prompts', '/dashboard/prompts/[id]'),
  idPage('/dashboard/reports', '/dashboard/reports/[id]'),
  idPage('/dashboard/audit', '/dashboard/audit/[id]'),
  idPage('/dashboard/shopping/products', '/dashboard/shopping/products/[productId]'),
  idPage('/dashboard/content', '/dashboard/content/[id]'),
  idPage('/dashboard/insights', '/dashboard/insights/[id]'),
];

/**
 * The page a path is, for the tables keyed by page: the path itself, or for
 * a page whose path holds an id ("/dashboard/agents/1b2…") its pattern
 * ("/dashboard/agents/[id]"); null for none.
 */
export function viewPage(route: string | null | undefined): string | null {
  const path = viewRoute(route);
  if (!path) return null;
  return ID_PAGES.find(([pattern]) => pattern.test(path))?.[1] ?? path;
}

/** The id an item's own page holds in its path ("/dashboard/reports/1b2…"); null on any other page. */
export function viewPathId(route: string | null | undefined): string | null {
  const path = viewRoute(route);
  if (!path) return null;
  for (const [pattern] of ID_PAGES) {
    const id = pattern.exec(path)?.[1];
    if (id) return id;
  }
  return null;
}

/** The URL keys a page keeps, by its path; null for a page with none listed. */
export function pageQueryKeysOf(route: string | null | undefined): readonly string[] | null {
  const path = viewPage(route);
  return (path && Object.hasOwn(PAGE_QUERY_KEYS, path) && PAGE_QUERY_KEYS[path]) || null;
}

/**
 * A page's URL state as a view carries it: only the keys the page keeps,
 * PAGE_QUERY_MAX_KEYS at most, each value on one line and cut to
 * PAGE_QUERY_VALUE_CHARS; undefined when none is left.
 */
export function pageQueryOf(
  route: string | null | undefined,
  query: string | URLSearchParams | Readonly<Record<string, unknown>> | null | undefined,
): Record<string, string> | undefined {
  const keys = pageQueryKeysOf(route);
  if (!keys || !query) return undefined;
  const entries: [string, unknown][] =
    typeof query === 'string' || query instanceof URLSearchParams
      ? [...new URLSearchParams(query).entries()]
      : Object.entries(query);
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (Object.keys(out).length >= PAGE_QUERY_MAX_KEYS) break;
    if (!keys.includes(key) || key in out || typeof raw !== 'string') continue;
    const value = raw.replace(/\s+/g, ' ').trim().slice(0, PAGE_QUERY_VALUE_CHARS);
    if (value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * What the side panel sends of the page beside it: the page's view, with
 * the page's URL state in place of any query the page set itself;
 * undefined when there is nothing.
 */
export function panelPageView(
  view: ChatPageView | null | undefined,
  route: string,
  search: string,
): ChatPageView | undefined {
  const out: ChatPageView = { ...view };
  delete out.query;
  const query = pageQueryOf(route, search);
  if (query) out.query = query;
  return Object.keys(out).length > 0 ? out : undefined;
}
