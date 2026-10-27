/**
 * Product Visibility's Categories (ECOM-008): for each category of the
 * brand's catalog, the shopping questions it answers, the brand's share of
 * the product slots on their shelves, how many of its products made a shelf,
 * the rival with the most slots there, and what its products sold from AI.
 *
 * A question is the category's when the category's own name is in it
 * ("Hiking backpacks" in "lightweight 30L hiking backpack for women", plural
 * or not), or when one of the category's products was on its shelf.
 */

export interface CategoryInput {
  id: string;
  /** As the catalog names it, maybe a path: "Bags > Hiking backpacks". */
  name: string;
  productIds: readonly string[];
}

/** A card of a shopping answer, as the categories read it. */
export interface CategoryCardRow {
  promptId: string;
  promptText: string;
  role: string;
  /** The competitor it's matched to, for a competitor's card. */
  competitorId: string | null;
  productBrand: string | null;
  merchant: string | null;
  /** The catalog product it shows, for the brand's own card (00360). */
  productId: string | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  /** The category's last level, as the table names it. */
  leaf: string;
  prompts: number;
  /** Those questions' ids, for an action to be measured on (ECOM-013). */
  promptIds: string[];
  /** The brand's share of the slots on the category's shelves; null with none. */
  shelfShare: number | null;
  productsOnShelf: number;
  products: number;
  topRival: { name: string; domain: string | null } | null;
  revenue: { value: number; currency: string | null } | null;
  needsAttention: boolean;
}

/** A category needs attention below this share of its shelves… */
export const ATTENTION_SHARE = 0.1;
/** …once it has at least this many questions. */
export const ATTENTION_PROMPTS = 3;

const FILLER = new Set(['and', 'for', 'the', 'of', 'with', 'a', 'an', '&']);

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** A text's words, lowercased, accents folded and singular. */
export function categoryWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !FILLER.has(word))
    .map(singular);
}

/** A category path's last level: "Bags > Hiking backpacks" → "Hiking backpacks". */
export function categoryLeaf(name: string): string {
  return (
    name
      .split(/\s*[>/›]\s*/)
      .filter(Boolean)
      .at(-1) ?? name
  ).trim();
}

export function categoryRows(
  categories: readonly CategoryInput[],
  cards: readonly CategoryCardRow[],
  {
    competitors,
    revenueOf,
  }: {
    competitors: ReadonlyMap<string, { name: string; domain: string | null }>;
    revenueOf: ReadonlyMap<string, { value: number; currency: string | null }>;
  },
): CategoryRow[] {
  // Each question's words, and the products of the brand's on its shelves.
  const prompts = new Map<string, { words: Set<string>; products: Set<string> }>();
  for (const card of cards) {
    let prompt = prompts.get(card.promptId);
    if (!prompt) {
      prompt = { words: new Set(categoryWords(card.promptText)), products: new Set() };
      prompts.set(card.promptId, prompt);
    }
    if (card.productId) prompt.products.add(card.productId);
  }

  return categories
    .map((category): CategoryRow => {
      const leaf = categoryLeaf(category.name);
      const words = categoryWords(leaf);
      const own = new Set(category.productIds);
      const mine = new Set(
        [...prompts]
          .filter(
            ([, prompt]) =>
              (words.length > 0 && words.every((word) => prompt.words.has(word))) ||
              [...prompt.products].some((id) => own.has(id)),
          )
          .map(([id]) => id),
      );
      const onShelves = cards.filter((card) => mine.has(card.promptId));
      const ownSlots = onShelves.filter((card) => card.role === 'own').length;
      const rivals = new Map<string, { name: string; domain: string | null; slots: number }>();
      for (const card of onShelves) {
        if (card.role === 'own') continue;
        const competitor = card.competitorId ? competitors.get(card.competitorId) : undefined;
        const name = competitor?.name ?? card.productBrand?.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const rival = rivals.get(key) ?? {
          name,
          domain: competitor?.domain ?? card.merchant,
          slots: 0,
        };
        rival.slots += 1;
        rivals.set(key, rival);
      }
      const top = [...rivals.values()].sort(
        (a, b) => b.slots - a.slots || a.name.localeCompare(b.name),
      )[0];
      const shown = new Set(
        onShelves.flatMap((card) =>
          card.productId && own.has(card.productId) ? [card.productId] : [],
        ),
      );
      // Its products' AI revenue, in their main currency.
      const sales = category.productIds.flatMap((id) => {
        const sale = revenueOf.get(id);
        return sale ? [sale] : [];
      });
      const currencies = new Map<string, number>();
      for (const sale of sales) {
        currencies.set(sale.currency ?? '', (currencies.get(sale.currency ?? '') ?? 0) + 1);
      }
      const main = [...currencies].sort((a, b) => b[1] - a[1])[0]?.[0];
      const shelfShare = onShelves.length ? ownSlots / onShelves.length : null;
      return {
        id: category.id,
        name: category.name,
        leaf,
        prompts: mine.size,
        promptIds: [...mine],
        shelfShare,
        productsOnShelf: shown.size,
        products: category.productIds.length,
        topRival: top ? { name: top.name, domain: top.domain } : null,
        revenue:
          main === undefined
            ? null
            : {
                value: sales
                  .filter((sale) => (sale.currency ?? '') === main)
                  .reduce((sum, sale) => sum + sale.value, 0),
                currency: main || null,
              },
        needsAttention:
          mine.size >= ATTENTION_PROMPTS && shelfShare !== null && shelfShare < ATTENTION_SHARE,
      };
    })
    .filter((row) => row.products > 0)
    .sort(
      (a, b) => b.prompts - a.prompts || b.products - a.products || a.leaf.localeCompare(b.leaf),
    );
}
