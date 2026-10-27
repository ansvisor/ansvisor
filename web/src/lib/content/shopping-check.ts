import { linkKey } from '@/lib/content/link-targets';

/**
 * Whether a page's shopping links still lead somewhere that sells
 * (shopping path, part 6): the category page it should link, and its
 * products as the catalog has them now. Read for the Rules tab's Shopping
 * rules and for Before you publish. A product the page links is checked
 * when it's one of the page's shopping path.
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
