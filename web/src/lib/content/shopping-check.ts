import { z } from 'zod';
import { linkKey } from '@/lib/content/link-targets';

/**
 * Whether a page's shopping links still lead somewhere that sells
 * (shopping path, part 6): the category page it should link, and its
 * products as the catalog has them now. Read for the Rules tab's Shopping
 * rules and for Before you publish. A product the page links is checked
 * when it's one of the page's shopping path, or one the person removed from
 * it or the path left out: the page may still link it. The check after each
 * catalog sync (00352) keeps the same for the Content Library.
 */

/** A product's state now: sold out, refused by Merchant Center, gone from the catalog, or fine. */
export type ShoppingLinkState = 'ok' | 'sold_out' | 'refused' | 'gone';

export interface ShoppingProductCheck {
  /** Its page's link key (link-targets.ts linkKey). */
  key: string;
  title: string;
  state: ShoppingLinkState;
  /**
   * In the path now. False for one removed from it or left out, listed only
   * when it no longer sells: it counts for "No sold-out or refused product
   * linked" alone.
   */
  inPath: boolean;
}

export interface ShoppingCheck {
  /** The category pages' link keys (link-targets.ts linkKey). */
  categories: string[];
  /** The path's products first, then the removed and left-out ones that no longer sell. */
  products: ShoppingProductCheck[];
  /**
   * What a relative link on the page ("/products/x") is read against: the
   * page's address, else the brand's site; null when neither is known.
   */
  site: string | null;
}

/** What a page's links do with its shopping path. */
export interface ShoppingLinks {
  categoryLinked: boolean;
  /** The path's products that sell now and the page links, each once. */
  linked: ShoppingProductCheck[];
  /** The products the page links that no longer sell: sold out, refused or gone. */
  bad: ShoppingProductCheck[];
  /** The path's products that sell now, linked or not. */
  products: number;
  /** How many of them the page should link: `n`, or all of them when fewer sell; 0 for none. */
  want: number;
  /** The path's category pages. */
  categories: number;
}

/** A link's key, a relative one read against `site`; null when it leads to no page. */
function hrefKey(href: string, site: string | null): string | null {
  const text = href.trim();
  if (!text) return null;
  // A scheme ("https:", "mailto:"): read as written.
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) return linkKey(text);
  if (!site) return null;
  try {
    return linkKey(new URL(text, site).toString());
  } catch {
    return null;
  }
}

/**
 * The page's links read against its shopping path, `n` the products it
 * should link (the Shopping rule's number). Only products that sell count
 * towards it: a sold-out one is the one to swap, not a link that counts.
 */
export function shoppingLinks(
  hrefs: readonly string[],
  check: ShoppingCheck,
  n = 0,
): ShoppingLinks {
  const keys = new Set(
    hrefs.map((href) => hrefKey(href, check.site)).filter((k): k is string => !!k),
  );
  // One per page: the path's first, before a removed one with the same page.
  const seen = new Set<string>();
  const products = check.products.filter((p) => {
    if (seen.has(p.key)) return false;
    seen.add(p.key);
    return true;
  });
  const selling = products.filter((p) => p.inPath && p.state === 'ok');
  return {
    categoryLinked: check.categories.some((key) => keys.has(key)),
    linked: selling.filter((p) => keys.has(p.key)),
    bad: products.filter((p) => p.state !== 'ok' && keys.has(p.key)),
    products: selling.length,
    want: Math.min(Math.max(0, n), selling.length),
    categories: check.categories.length,
  };
}

/** Names a list shows before "+N more". */
export const LISTED_MAX = 3;

/** The first few of a list to name, and how many more there are. */
export function listed<T>(items: readonly T[], max = LISTED_MAX): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** A linked product that no longer sells, as the check after a catalog sync keeps it (00352). */
export interface ShoppingBadLink {
  id: string;
  title: string;
  state: Exclude<ShoppingLinkState, 'ok'>;
}

/**
 * A draft's shopping path in the Content Library (00352): none, not checked
 * since it was built (the next catalog sync checks it), or what the last
 * check found on the live page or in the draft.
 */
export type DraftShopping =
  | { state: 'none' }
  | { state: 'unchecked' }
  | {
      state: 'ok' | 'attention';
      readFrom: 'page' | 'draft';
      checkedAt: string;
      categories: number;
      categoriesLinked: number;
      products: number;
      productsLinked: number;
      bad: ShoppingBadLink[];
    };

/** The Library's Shopping path filter (?shopping=attention). */
export const SHOPPING_FILTERS = ['all', 'attention', 'ok', 'none'] as const;
export type ShoppingFilter = (typeof SHOPPING_FILTERS)[number];

const checkRowSchema = z.object({
  read_from: z.enum(['page', 'draft']),
  checked_at: z.string(),
  categories: z.number(),
  categories_linked: z.number(),
  products: z.number(),
  products_linked: z.number(),
  bad: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        state: z.enum(['sold_out', 'refused', 'gone']),
      }),
    )
    .catch([]),
});

/**
 * A Library row's shopping path: `builtAt` its path's (null for none), and
 * `check` its content_shopping_checks row as PostgREST embeds it.
 */
export function draftShopping(builtAt: string | null, check: unknown): DraftShopping {
  if (!builtAt) return { state: 'none' };
  const parsed = checkRowSchema.safeParse(Array.isArray(check) ? check[0] : check);
  if (!parsed.success) return { state: 'unchecked' };
  const row = parsed.data;
  return {
    state: row.bad.length ? 'attention' : 'ok',
    readFrom: row.read_from,
    checkedAt: row.checked_at,
    categories: row.categories,
    categoriesLinked: row.categories_linked,
    products: row.products,
    productsLinked: row.products_linked,
    bad: row.bad,
  };
}

/** The drafts the Shopping path filter lists: a path not checked yet only under All. */
export function draftsByShopping<T extends { shopping?: DraftShopping }>(
  drafts: T[],
  filter: ShoppingFilter,
): T[] {
  if (filter === 'all') return drafts;
  return drafts.filter((draft) => (draft.shopping?.state ?? 'none') === filter);
}
