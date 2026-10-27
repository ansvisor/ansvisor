import { z } from 'zod';
import { linkKey } from '@/lib/content/link-targets';

/**
 * Whether a page's shopping links still lead somewhere that sells
 * (shopping path, part 6): the category page it should link, and its
 * products as the catalog has them now. Read for the Rules tab's Shopping
 * rules and for Before you publish. A product the page links is checked
 * when it's one of the page's shopping path. The check after each catalog
 * sync (00352) keeps the same for the Content Library.
 */

/** A product's state now: sold out, refused by Merchant Center, gone from the catalog, or fine. */
export type ShoppingLinkState = 'ok' | 'sold_out' | 'refused' | 'gone';

export interface ShoppingCheck {
  /** The category pages' link keys (link-targets.ts linkKey). */
  categories: string[];
  products: { key: string; title: string; state: ShoppingLinkState }[];
}

/** What a page's links do with its shopping path. */
export interface ShoppingLinks {
  categoryLinked: boolean;
  /** The path's products the page links, each once. */
  linked: ShoppingCheck['products'];
  /** The ones of them that no longer sell: sold out, refused or gone. */
  bad: ShoppingCheck['products'];
  /** The path's products, linked or not. */
  products: number;
  /** The path's category pages. */
  categories: number;
}

/** The page's links read against its shopping path. */
export function shoppingLinks(hrefs: readonly string[], check: ShoppingCheck): ShoppingLinks {
  const keys = new Set(hrefs.map((href) => linkKey(href)).filter((k): k is string => !!k));
  const linked = check.products.filter((p) => keys.has(p.key));
  return {
    categoryLinked: check.categories.some((key) => keys.has(key)),
    linked,
    bad: linked.filter((p) => p.state !== 'ok'),
    products: check.products.length,
    categories: check.categories.length,
  };
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
