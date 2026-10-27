/**
 * Product Visibility's Shelf (ECOM-006): for each shopping question the
 * brand tracks, the products AI put on its "shelf", in order, on each
 * channel, and where the brand's own products stand. Read from the product
 * cards of AI answers (prompt_result_shopping_cards), a card the brand's own
 * when matched_brand_role is 'own', and its catalog product when 00360
 * matched one.
 */

/** A card as the shelf reads it. */
export interface ShelfCardRow {
  prompt_result_id: string;
  position: number;
  created_at: string;
  platform: string;
  product_title: string | null;
  price_amount: number | null;
  price_currency: string | null;
  image_url: string | null;
  merchant_domain: string | null;
  rating: number | null;
  review_count: number | null;
  matched_brand_role: string;
  merchant_kind: string | null;
  marketplace: string | null;
  catalog_product_id: string | null;
  prompt_id: string | null;
  prompt_text: string | null;
}

/** A product on a shelf. */
export interface ShelfCard {
  /** Its place on the shelf, from 1. */
  rank: number;
  title: string;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  image: string | null;
  merchant: string | null;
  own: boolean;
  /** The marketplace an own product was linked through ("via Amazon"), else null. */
  via: string | null;
  productId: string | null;
}

/** One shopping question on one channel: its latest shelf, and the brand's week on it. */
export interface ShelfRow {
  key: string;
  promptId: string;
  promptText: string;
  platform: string;
  /** When its latest shelf was read. */
  at: string;
  cards: ShelfCard[];
  /** The brand's best place on the latest shelf, or null when it isn't on it. */
  ownRank: number | null;
  /** The shelves read in the last 7 days, and how many had one of the brand's products. */
  weekShelves: number;
  weekOwnShelves: number;
}

/** The products a row shows at most. */
export const SHELF_CARDS = 6;

const WEEK_MS = 7 * 86_400_000;

/**
 * The shelves: one row per question and channel, its newest answer's
 * products in order. The rows the brand isn't on come first, then those it
 * ranks lowest on: what needs work first.
 */
export function buildShelf(cards: readonly ShelfCardRow[], now: number = Date.now()): ShelfRow[] {
  const groups = new Map<
    string,
    {
      promptId: string;
      promptText: string;
      platform: string;
      runs: Map<string, { at: string; cards: ShelfCardRow[] }>;
    }
  >();
  for (const card of cards) {
    if (!card.prompt_id) continue;
    const key = `${card.prompt_id}:${card.platform}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        promptId: card.prompt_id,
        promptText: card.prompt_text ?? '',
        platform: card.platform,
        runs: new Map(),
      };
      groups.set(key, group);
    }
    let run = group.runs.get(card.prompt_result_id);
    if (!run) {
      run = { at: card.created_at, cards: [] };
      group.runs.set(card.prompt_result_id, run);
    }
    if (card.created_at > run.at) run.at = card.created_at;
    run.cards.push(card);
  }

  const rows: ShelfRow[] = [];
  for (const [key, group] of groups) {
    const runs = [...group.runs.values()];
    const latest = runs.reduce((a, b) => (b.at > a.at ? b : a));
    const shelf = [...latest.cards]
      .sort((a, b) => a.position - b.position)
      .map(
        (card, i): ShelfCard => ({
          rank: i + 1,
          title: card.product_title?.trim() || '—',
          price: card.price_amount,
          currency: card.price_currency,
          rating: card.rating,
          reviews: card.review_count,
          image: card.image_url,
          merchant: card.merchant_domain,
          own: card.matched_brand_role === 'own',
          via:
            card.matched_brand_role === 'own' && card.merchant_kind === 'marketplace'
              ? card.marketplace
              : null,
          productId: card.catalog_product_id,
        }),
      );
    const week = runs.filter((run) => now - Date.parse(run.at) <= WEEK_MS);
    rows.push({
      key,
      promptId: group.promptId,
      promptText: group.promptText,
      platform: group.platform,
      at: latest.at,
      cards: shelf.slice(0, SHELF_CARDS),
      ownRank: shelf.find((card) => card.own)?.rank ?? null,
      weekShelves: week.length,
      weekOwnShelves: week.filter((run) =>
        run.cards.some((card) => card.matched_brand_role === 'own'),
      ).length,
    });
  }
  return rows.sort(
    (a, b) =>
      (a.ownRank === null ? 0 : 1) - (b.ownRank === null ? 0 : 1) ||
      (b.ownRank ?? 0) - (a.ownRank ?? 0) ||
      a.promptText.localeCompare(b.promptText) ||
      a.platform.localeCompare(b.platform),
  );
}

/** The brand's place on the shelves over the window. */
export interface ShelfStats {
  /** Product slots in the answers read, and how many held one of the brand's products. */
  slots: number;
  ownSlots: number;
  /** The brand's distinct products on the shelf: catalog products when matched, else titles. */
  products: number;
  /** Whether `products` counts catalog products (00360) rather than titles. */
  fromCatalog: boolean;
  /** Each channel's slots holding the brand's products, most first. */
  channels: { platform: string; ownSlots: number }[];
}

const titleKey = (title: string | null) =>
  String(title ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function shelfStats(cards: readonly ShelfCardRow[]): ShelfStats {
  const own = cards.filter((card) => card.matched_brand_role === 'own');
  const matched = new Set(
    own.flatMap((card) => (card.catalog_product_id ? [card.catalog_product_id] : [])),
  );
  const titles = new Set(own.map((card) => titleKey(card.product_title)).filter(Boolean));
  const channels = new Map<string, number>();
  for (const card of own) channels.set(card.platform, (channels.get(card.platform) ?? 0) + 1);
  return {
    slots: cards.length,
    ownSlots: own.length,
    products: matched.size || titles.size,
    fromCatalog: matched.size > 0,
    channels: [...channels]
      .map(([platform, ownSlots]) => ({ platform, ownSlots }))
      .sort((a, b) => b.ownSlots - a.ownSlots || a.platform.localeCompare(b.platform)),
  };
}

/** The Shelf's price filter: a shelf is in a band when its products' middle price is. */
export const PRICE_BANDS = ['all', 'under50', '50to100', '100to200', 'over200'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

const BAND_RANGE: Record<Exclude<PriceBand, 'all'>, [number, number]> = {
  under50: [0, 50],
  '50to100': [50, 100],
  '100to200': [100, 200],
  over200: [200, Infinity],
};

export function inPriceBand(row: ShelfRow, band: PriceBand): boolean {
  if (band === 'all') return true;
  const prices = row.cards
    .map((card) => card.price)
    .filter((price): price is number => typeof price === 'number')
    .sort((a, b) => a - b);
  if (!prices.length) return false;
  const middle = prices[Math.floor((prices.length - 1) / 2)];
  const [min, max] = BAND_RANGE[band];
  return middle >= min && middle < max;
}
