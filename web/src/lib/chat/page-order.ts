import { pageRoute } from './page-route';
import type { ChatPageSort, ChatPageView } from './page-view';

/**
 * Each page's list in the order it shows (the owner's plan of 2026-11-16,
 * item 7: "the first ones on the page" are the rows on screen). Where a
 * page's order is not its read's, the reader is told the inputs that read
 * the page's rows in the page's order: the page's default, or the sort the
 * person chose there once the panel sends it (item 8, page-view.ts). A
 * sort the read doesn't take stays words, and the rows on screen are read
 * by their refs. A search on the page is the read's search where it has
 * one: the app applies it to the page's own list (page-scope.ts), and this
 * line says so only where the app does (the engine's `takes`). The search's text and an unknown sort's name are the browser's, so
 * they stay in the untrusted page_view block: this line only points there.
 * "What should I do first" keeps the read's own order (priority, score).
 * Plain module: the engine adds the line beside <page_context>.
 */

/** A sort of the page as its read takes it: its inputs, or none when the read has no such order. */
export interface PageSortRead {
  input?: Readonly<Record<string, string>>;
  /** The order, in words ("highest Priority Score first"). */
  words: string;
}

export interface PageOrder {
  /** The read of the page's list. */
  tool: string;
  /** What the page lists ("its actions"). */
  noun: string;
  /** The inputs that read it as the page lists it by default. */
  input: Readonly<Record<string, string>>;
  /**
   * Inputs for what the page shows while it has no filter of that key
   * (Actions: every status); with one, the page's filter fills it (page-scope.ts).
   */
  unfiltered?: Readonly<Record<string, string>>;
  /** The default order, in words. */
  words: string;
  /** What the read's own default is, when it is another order. */
  readDefault?: string;
  /** The page's sorts, by its own key and direction; null for one it doesn't have. */
  sort?: (sort: ChatPageSort) => PageSortRead | null;
  /** The read and input that take the page's search, then what reads the rows it finds. */
  search?: { tool: string; field: string; then?: string };
  /** Said only once the page sends a sort or a search: its read's default is the page's. */
  quiet?: boolean;
}

const way = (sort: ChatPageSort, desc: string, asc: string) => (sort.dir === 'asc' ? asc : desc);

/** The Actions list's sorts (action-center/sort.ts): Updated and Priority Score both ways, Due date. */
function actionSort(sort: ChatPageSort): PageSortRead | null {
  switch (`${sort.key}:${sort.dir}`) {
    case 'updated:desc':
      return { input: { sort: 'updated' }, words: 'most recently updated first' };
    case 'priority:desc':
      return { input: { sort: 'priority' }, words: 'highest Priority Score first' };
    case 'updated:asc':
      return { words: 'least recently updated first' };
    case 'priority:asc':
      return { words: 'lowest Priority Score first' };
    case 'due_date:asc':
      return { words: 'by due date, soonest first' };
    default:
      return null;
  }
}

/** Content's Sort (content/opportunity-list.ts): newest, score, oldest. */
function opportunitySort(sort: ChatPageSort): PageSortRead | null {
  switch (sort.key) {
    case 'newest':
      return { input: { sort: 'newest' }, words: 'newest first' };
    case 'score':
      return { input: { sort: 'score' }, words: 'highest score first' };
    case 'oldest':
      return { input: { sort: 'oldest' }, words: 'oldest first' };
    default:
      return null;
  }
}

/** The Prompts table's columns (prompts/prompt-sort.ts): the read sorts by three of them. */
const PROMPT_COLUMNS: Readonly<Record<string, { sortBy?: string; words: string }>> = {
  visibility: { sortBy: 'visibility', words: 'by Visibility (the AI Visibility Score)' },
  mentions: { sortBy: 'mentions', words: 'by mentions' },
  citations: { sortBy: 'citations', words: 'by citations' },
  position: { words: 'by average position' },
  volume: { words: 'by AI search volume' },
  runs: { words: 'by runs' },
  added: { words: 'by when each was added' },
  lastRun: { words: 'by last run' },
};

function promptSort(sort: ChatPageSort): PageSortRead | null {
  const column = Object.hasOwn(PROMPT_COLUMNS, sort.key) ? PROMPT_COLUMNS[sort.key] : null;
  if (!column) return null;
  const words = `${column.words}, ${way(sort, 'highest first', 'lowest first')}`;
  return column.sortBy ? { input: { sort_by: column.sortBy, order: sort.dir }, words } : { words };
}

/** The Mentions table's Sort (mentions-list.ts MENTION_SORTS), which list_mentions takes. */
const MENTION_SORT_WORDS: Readonly<Record<string, string>> = {
  newest: 'newest first',
  oldest: 'oldest first',
  co_mentions: 'most competitors named alongside first',
  negative: 'negative first',
};

function mentionSort(sort: ChatPageSort): PageSortRead | null {
  const words = Object.hasOwn(MENTION_SORT_WORDS, sort.key) ? MENTION_SORT_WORDS[sort.key] : null;
  return words ? { input: { sort: sort.key }, words } : null;
}

/** History's Sort (action-center/history.ts HISTORY_SORTS), which get_action_history takes. */
const HISTORY_SORT_WORDS: Readonly<Record<string, string>> = {
  newest: 'newest first (by when each closed, else was raised)',
  oldest: 'oldest first',
  priority: 'highest priority first',
};

function historySort(sort: ChatPageSort): PageSortRead | null {
  const words = Object.hasOwn(HISTORY_SORT_WORDS, sort.key) ? HISTORY_SORT_WORDS[sort.key] : null;
  return words ? { input: { sort: sort.key }, words } : null;
}

/**
 * The Topics table's columns (prompts/_topics-tab.tsx): get_topics_overview
 * lists by AI Visibility Score, highest first, and takes no other order.
 */
const TOPIC_COLUMNS: Readonly<Record<string, string>> = {
  visibility: 'by AI Visibility Score',
  prompts: 'by prompts',
  sov: 'by share of voice',
  mentions: 'by mentions',
  citations: 'by citations',
  lastRun: 'by last run',
};

function topicSort(sort: ChatPageSort): PageSortRead | null {
  const column = Object.hasOwn(TOPIC_COLUMNS, sort.key) ? TOPIC_COLUMNS[sort.key] : null;
  if (!column) return null;
  const words = `${column}, ${way(sort, 'highest first', 'lowest first')}`;
  return sort.key === 'visibility' && sort.dir === 'desc' ? { input: {}, words } : { words };
}

const PROMPTS: PageOrder = {
  tool: 'get_prompt_performance',
  noun: 'its prompts',
  input: { sort_by: 'visibility' },
  words: 'by Visibility (the AI Visibility Score), highest first',
  sort: promptSort,
  search: {
    tool: 'list_prompts',
    field: 'search',
    then: 'then get_prompt_performance with their ids as prompt_ids',
  },
};

/** By the page's path, as the side panel sends it. */
export const PAGE_ORDERS: Readonly<Record<string, PageOrder>> = {
  '/dashboard/action-center/actions': {
    tool: 'list_action_center_tasks',
    noun: 'its actions',
    input: { sort: 'updated' },
    unfiltered: { status: 'all' },
    words: 'most recently updated first',
    readDefault: 'open actions, highest Priority Score first',
    sort: actionSort,
  },
  '/dashboard/content': {
    tool: 'list_content_opportunities',
    noun: 'its content opportunities',
    input: { sort: 'newest' },
    words: 'newest first',
    readDefault: 'highest score first',
    sort: opportunitySort,
    search: { tool: 'list_content_opportunities', field: 'search' },
  },
  // And /dashboard/prompts, which opens on it (page-route.ts).
  '/dashboard/prompts/tracked': PROMPTS,
  '/dashboard/mentions': {
    tool: 'list_mentions',
    noun: 'the answers naming the brand',
    input: {},
    words: 'newest first',
    sort: mentionSort,
    search: { tool: 'list_mentions', field: 'search' },
    quiet: true,
  },
  // The pages that send their context since step 9. Each read already lists as its page
  // does by default, so each says its order only once the person sorts or searches it.
  '/dashboard/action-center/signals': {
    tool: 'list_signals',
    noun: 'its signals',
    input: {},
    words: 'newest first',
    quiet: true,
  },
  '/dashboard/action-center/history': {
    tool: 'get_action_history',
    noun: 'its closed actions',
    input: {},
    words: HISTORY_SORT_WORDS.newest,
    sort: historySort,
    search: { tool: 'get_action_history', field: 'search' },
    quiet: true,
  },
  '/dashboard/agents': {
    tool: 'list_my_agents',
    noun: 'its agents',
    input: {},
    words: 'most recently changed first',
    search: { tool: 'list_my_agents', field: 'search' },
    quiet: true,
  },
  '/dashboard/prompts/topics': {
    tool: 'get_topics_overview',
    noun: 'its topics',
    input: {},
    words: 'by AI Visibility Score, highest first',
    sort: topicSort,
    quiet: true,
  },
};

/** The page's order, by its path as Chat matches pages (page-route.ts); null for a page with none listed. */
export function pageOrderOf(route: string | null | undefined): PageOrder | null {
  const path = pageRoute(route);
  return (path && Object.hasOwn(PAGE_ORDERS, path) && PAGE_ORDERS[path]) || null;
}

/**
 * The page's filters and search, by their keys ("status", "search"), that
 * the app applies to a read of this name when the model gives none of them:
 * page-scope.ts pageFilterInputs, as scope.ts applies it to every read.
 */
export type PageTakes = (tool: string) => readonly string[];

/** "read list_action_center_tasks with status "all" and sort "updated"", or the read alone. */
const readWith = (tool: string, input: readonly [string, string][]) =>
  input.length > 0
    ? `read ${tool} with ${input.map(([key, value]) => `${key} "${value}"`).join(' and ')}`
    : `read ${tool}`;

/**
 * What the models are told of the page's order, given the keys of the
 * filters it has set (`status` for a `filter:status` chip), the sort and
 * search the person chose (the page's view), and what of them the app
 * applies to a read (`takes`, the engine's: the maintainer's review of
 * 2026-11-17). The line says the app applies the page's search, or leaves
 * out a filter's "all", only where `takes` says it does: without it, the
 * search is never said to be applied and the filters are the chips' keys.
 * Null on a page with none listed, or on a quiet one with neither.
 */
export function pageOrderLine(
  route: string | null | undefined,
  filters: readonly string[] = [],
  view?: Pick<ChatPageView, 'sort' | 'search'> | null,
  takes?: PageTakes,
): string | null {
  const order = pageOrderOf(route);
  if (!order) return null;
  const sort = view?.sort ?? null;
  const searched = !!view?.search;
  if (order.quiet && !sort && !searched) return null;
  // A filter the app fills on the list's read needs no "all"; one it doesn't (a question
  // that asks for all of them), the read's "all" reads what the page would without it.
  const filled = takes ? takes(order.tool) : filters;
  const whole = Object.entries(order.unfiltered ?? {}).filter(([key]) => !filled.includes(key));
  const chosen = sort ? (order.sort?.(sort) ?? null) : null;
  const rowsOnPage = `When the person means the rows on the page ("the first ones", "the top 5 on the page", "the third one")`;
  const lines: string[] = [];
  if (!sort) {
    lines.push(
      `The page lists ${order.noun}, ${order.words}. ${rowsOnPage}, ${readWith(order.tool, [...whole, ...Object.entries(order.input)])}, so they are the rows on screen, in its order.`,
    );
  } else if (chosen?.input) {
    lines.push(
      `The page lists ${order.noun}, ${chosen.words}, as the person sorted it. ${rowsOnPage}, ${readWith(order.tool, [...whole, ...Object.entries(chosen.input)])}, so they are the rows on screen, in its order.`,
    );
  } else {
    const how = chosen
      ? `The page lists ${order.noun}, ${chosen.words}, as the person sorted it`
      : `The page lists ${order.noun} in the order page_view's sort names, as the person sorted it`;
    lines.push(
      `${how}, an order ${order.tool} doesn't take. ${rowsOnPage}, read the rows page_view lists by their refs, in its order.`,
    );
  }
  if (searched) {
    const search = order.search;
    if (search && takes?.(search.tool).includes(search.field)) {
      lines.push(
        `The page is searched (page_view's search): the app applies that search to ${search.tool}'s ${search.field}, within the list as the page filters it, unless you give your own, so for its rows read ${search.tool}${search.then ? `, ${search.then}` : ''}.`,
      );
    } else {
      lines.push(
        search
          ? `The page is searched (page_view's search), which the app doesn't apply to this question's reads: the rows on screen are the ones page_view lists.`
          : `The page is searched (page_view's search), which ${order.tool} doesn't take: its rows are the ones page_view lists.`,
      );
    }
  }
  if (order.readDefault) {
    lines.push(
      `For "what matters most" or "what should I do first", its own order (${order.readDefault}) stays right.`,
    );
  }
  lines.push('Say which order a list is in when you give it.');
  return lines.join(' ');
}
