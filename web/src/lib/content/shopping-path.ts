import { z } from 'zod';
import type { SiteType } from '@/lib/content/page-types';

/**
 * A draft's shopping path (shopping path, 00351), as the Brief tab shows it:
 * the category pages and catalog products the page links on an online shop,
 * the products left out and why, and the person's locks, removals and
 * additions. The API picks them (server/src/lib/shopping-path.js); the
 * person changes them here.
 */

/** The page types a shopping path fits, and how many products each links (the API's). */
export const PRODUCTS_FOR: Record<string, number> = {
  best_of: 8,
  buying_guide: 5,
  comparison: 4,
  alternatives: 4,
  guide: 4,
  blog_post: 3,
};

/** Whether a page of this type on this kind of site takes a shopping path. */
export function shoppingPathFits(siteType: SiteType, pageType: string | null): boolean {
  return siteType === 'ecommerce' && pageType != null && Object.hasOwn(PRODUCTS_FOR, pageType);
}

const id = z.string().min(1).max(100);
const url = z.string().max(2048);

export const shoppingPathSchema = z.object({
  version: z.literal(1),
  builtAt: z.string(),
  pageType: z.string().nullable(),
  categories: z.array(z.object({ name: z.string(), url, title: z.string().nullable() })).max(5),
  products: z
    .array(
      z.object({
        id,
        title: z.string(),
        url,
        price: z.number().nullable(),
        salePrice: z.number().nullable(),
        currency: z.string().nullable(),
        availability: z.string(),
        image: url.nullable(),
        issues: z.array(z.object({ code: z.string(), attribute: z.string().nullable() })).max(20),
        score: z.number(),
      }),
    )
    .max(40),
  leftOut: z
    .array(z.object({ id, title: z.string(), reason: z.enum(['sold_out', 'refused', 'no_link']) }))
    .max(10),
  locked: z.array(id).max(40),
  removed: z.array(id).max(200),
  added: z.array(id).max(40),
});

export type ShoppingPath = z.infer<typeof shoppingPathSchema>;
export type ShoppingProduct = ShoppingPath['products'][number];
export type LeftOutReason = ShoppingPath['leftOut'][number]['reason'];

/** Why a draft has no shopping path, as the API says it. */
export type NoPathReason = 'not_a_shop' | 'page_type' | 'no_catalog';

/**
 * Where a product goes on the page, by page type: a list's picks, a
 * comparison's options, or a link in the text. `index` counts from 0.
 */
export function placementOf(
  pageType: string | null,
  index: number,
): { key: 'pick' | 'compared' | 'linked'; n: number } {
  if (pageType === 'best_of' || pageType === 'buying_guide') return { key: 'pick', n: index + 1 };
  if (pageType === 'comparison' || pageType === 'alternatives') {
    return { key: 'compared', n: index + 1 };
  }
  return { key: 'linked', n: index + 1 };
}

/** The path with a product removed: out of the page, and never picked again. */
export function withRemoved(path: ShoppingPath, productId: string): ShoppingPath {
  return {
    ...path,
    products: path.products.filter((p) => p.id !== productId),
    locked: path.locked.filter((p) => p !== productId),
    added: path.added.filter((p) => p !== productId),
    removed: [...new Set([...path.removed, productId])],
  };
}

/** The path with a product locked, or unlocked: a locked one stays when the path is built again. */
export function withLocked(path: ShoppingPath, productId: string, locked: boolean): ShoppingPath {
  const rest = path.locked.filter((p) => p !== productId);
  return { ...path, locked: locked ? [...rest, productId] : rest };
}

/** The path with a product added by the person: kept, and no longer removed. */
export function withAdded(path: ShoppingPath, productId: string): ShoppingPath {
  return {
    ...path,
    added: [...new Set([...path.added, productId])],
    removed: path.removed.filter((p) => p !== productId),
  };
}
