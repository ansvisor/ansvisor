/**
 * ECOM-018: what a done Products action did, 7 days on. An action sent from
 * Product Visibility (a product to get on the AI shelf, a category to win)
 * names the shopping questions it's measured on; once someone completes it,
 * the shelves of those questions in the 7 days after are set beside the 7
 * days before: how many the brand's product (or, for a category, any of its
 * products) was on. Read from the cards already kept, when the page opens:
 * no job, nothing stored.
 */

export const RECHECK_DAYS = 7;
/** Targets re-checked in one read at most. */
export const RECHECK_TARGETS = 500;
const DAY_MS = 86_400_000;

/** A card as the re-check reads it: its shelf (question × channel), when, and whose. */
export interface RecheckCard {
  promptId: string;
  platform: string;
  at: string;
  own: boolean;
  productId: string | null;
}

/** A done action from Products, as the re-check reads it. */
export interface RecheckAction {
  id: string;
  actionNo: number;
  target: { type: 'product' | 'category'; id: string };
  completedAt: string;
  /** The shopping questions it's measured on. */
  promptIds: string[];
}

/** Shelves read in a window, and how many the brand was on. */
export interface ShelfPresence {
  shelves: number;
  on: number;
}

export interface ActionResult {
  actionId: string;
  actionNo: number;
  completedAt: string;
  /** When the 7 days after end: the result shows from then. */
  readyAt: string;
  before: ShelfPresence;
  /** Null until the 7 days after have passed. */
  after: ShelfPresence | null;
}

/** The action's shelves read in [from, to), and how many had the brand's product on them. */
export function shelfPresence(
  cards: readonly RecheckCard[],
  action: Pick<RecheckAction, 'target' | 'promptIds'>,
  from: number,
  to: number,
): ShelfPresence {
  const prompts = new Set(action.promptIds);
  const shelves = new Map<string, boolean>();
  for (const card of cards) {
    const at = Date.parse(card.at);
    if (!(at >= from && at < to) || !prompts.has(card.promptId)) continue;
    const key = `${card.promptId}:${card.platform}`;
    const ours = action.target.type === 'product' ? card.productId === action.target.id : card.own;
    shelves.set(key, (shelves.get(key) ?? false) || ours);
  }
  return { shelves: shelves.size, on: [...shelves.values()].filter(Boolean).length };
}

/** The action's result: the week before it was done beside the week after, once that has passed. */
export function actionResult(
  action: RecheckAction,
  cards: readonly RecheckCard[],
  now: number = Date.now(),
): ActionResult {
  const done = Date.parse(action.completedAt);
  const ready = done + RECHECK_DAYS * DAY_MS;
  return {
    actionId: action.id,
    actionNo: action.actionNo,
    completedAt: action.completedAt,
    readyAt: new Date(ready).toISOString(),
    before: shelfPresence(cards, action, done - RECHECK_DAYS * DAY_MS, done),
    after: now >= ready ? shelfPresence(cards, action, done, ready) : null,
  };
}

/**
 * Which way it went: the share of shelves it was on, after beside before.
 * Null while the week after runs, or when no answer was read in it.
 */
export function resultTrend(result: ActionResult): 'better' | 'worse' | 'same' | null {
  const { before, after } = result;
  if (!after?.shelves) return null;
  const share = (p: ShelfPresence) => (p.shelves ? p.on / p.shelves : 0);
  const change = share(after) - share(before);
  return change > 0 ? 'better' : change < 0 ? 'worse' : 'same';
}

/** A target's key in the results: "product:<id>" or "category:<id>". */
export const resultKey = (target: RecheckAction['target']) => `${target.type}:${target.id}`;
