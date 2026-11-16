/**
 * Each page's list in the order the page opens on (the owner's plan of
 * 2026-11-16, item 7: "the first ones on the page" are the rows on screen).
 * Where a page's default order is not its read's, the reader is told the
 * inputs that read the page's rows in the page's order. The panel doesn't
 * send the page's chosen sort yet (plan item 8), so this is the page's
 * default. "What should I do first" keeps the read's own order (priority,
 * score). Plain module: the engine adds the line beside <page_context>.
 */

export interface PageOrder {
  /** The read of the page's list. */
  tool: string;
  /** The inputs that read it as the page lists it. */
  input: Readonly<Record<string, string>>;
  /**
   * Inputs for what the page shows while it has no filter of that key
   * (Actions: every status); with one, the page's filter fills it (page-scope.ts).
   */
  unfiltered?: Readonly<Record<string, string>>;
  /** What the page lists, and in which order, in words. */
  words: string;
  /** What the read's own default is, when it is another order. */
  readDefault?: string;
}

const PROMPTS: PageOrder = {
  tool: 'get_prompt_performance',
  input: { sort_by: 'visibility' },
  words: 'its prompts by Visibility (the AI Visibility Score), highest first',
};

/** By the page's path, as the side panel sends it. */
export const PAGE_ORDERS: Readonly<Record<string, PageOrder>> = {
  '/dashboard/action-center/actions': {
    tool: 'list_action_center_tasks',
    input: { sort: 'updated' },
    unfiltered: { status: 'all' },
    words: 'its actions, most recently updated first',
    readDefault: 'open actions, highest Priority Score first',
  },
  '/dashboard/content': {
    tool: 'list_content_opportunities',
    input: { sort: 'newest' },
    words: 'its content opportunities newest first',
    readDefault: 'highest score first',
  },
  '/dashboard/prompts': PROMPTS,
  '/dashboard/prompts/tracked': PROMPTS,
};

/** The page's order, by its path (a trailing slash aside); null for a page with none listed. */
export function pageOrderOf(route: string | null | undefined): PageOrder | null {
  const path = route?.trim().replace(/\/+$/, '');
  return (path && PAGE_ORDERS[path]) || null;
}

/**
 * What the models are told of the page's order, given the keys of the
 * filters it has set (`status` for a `filter:status` chip); null on a page
 * with none listed.
 */
export function pageOrderLine(
  route: string | null | undefined,
  filters: readonly string[] = [],
): string | null {
  const order = pageOrderOf(route);
  if (!order) return null;
  const whole = Object.entries(order.unfiltered ?? {}).filter(([key]) => !filters.includes(key));
  const input = [...whole, ...Object.entries(order.input)]
    .map(([key, value]) => `${key} "${value}"`)
    .join(' and ');
  const own = order.readDefault
    ? ` For "what matters most" or "what should I do first", its own order (${order.readDefault}) stays right.`
    : '';
  return `The page lists ${order.words}. When the person means the rows on the page ("the first ones", "the top 5 on the page", "the third one"), read ${order.tool} with ${input}, so they are the rows on screen, in its order.${own} Say which order a list is in when you give it.`;
}
