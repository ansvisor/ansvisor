import { describe, expect, it } from 'vitest';
import { buildShelf, inPriceBand, shelfStats, SHELF_CARDS, type ShelfCardRow } from './shelf';

/** Product Visibility's Shelf (ECOM-006). */

const NOW = Date.parse('2026-10-27T12:00:00Z');

const card = (over: Partial<ShelfCardRow>): ShelfCardRow => ({
  prompt_result_id: 'r1',
  position: 0,
  created_at: '2026-10-27T08:00:00Z',
  platform: 'chatgpt-shopping',
  product_title: 'Summit Peak GTX',
  price_amount: 139,
  price_currency: 'USD',
  image_url: null,
  merchant_domain: 'summitgear.example',
  rating: 4.8,
  review_count: 2140,
  matched_brand_role: 'competitor',
  merchant_kind: 'reseller',
  marketplace: null,
  catalog_product_id: null,
  prompt_id: 'p1',
  prompt_text: 'best waterproof trail running shoes under $150',
  ...over,
});

describe('buildShelf', () => {
  it("shows each question's latest shelf per channel, in order, and the brand's week on it", () => {
    const rows = buildShelf(
      [
        // The latest shelf on ChatGPT: the brand second, through Amazon.
        card({
          position: 1,
          product_title: 'Trail Runner X',
          matched_brand_role: 'own',
          merchant_kind: 'marketplace',
          marketplace: 'amazon',
          catalog_product_id: 'cp1',
          price_amount: 129,
        }),
        card({ position: 0 }),
        // An older shelf this week, without the brand.
        card({ prompt_result_id: 'r0', created_at: '2026-10-24T08:00:00Z' }),
        // Older than a week: not counted in the week.
        card({
          prompt_result_id: 'r-old',
          created_at: '2026-10-10T08:00:00Z',
          matched_brand_role: 'own',
        }),
        // The same question on Copilot: the brand first.
        card({
          prompt_result_id: 'r2',
          platform: 'copilot-web',
          matched_brand_role: 'own',
          product_title: 'StormShell',
        }),
      ],
      NOW,
    );
    expect(
      rows.map((row) => [row.platform, row.ownRank, row.weekShelves, row.weekOwnShelves]),
    ).toEqual([
      ['chatgpt-shopping', 2, 2, 1],
      ['copilot-web', 1, 1, 1],
    ]);
    expect(rows[0].cards.map((c) => [c.rank, c.title, c.own, c.via, c.productId])).toEqual([
      [1, 'Summit Peak GTX', false, null, null],
      [2, 'Trail Runner X', true, 'amazon', 'cp1'],
    ]);
  });

  it("puts the shelves the brand isn't on first, then the lowest places", () => {
    const rows = buildShelf(
      [
        card({ prompt_id: 'a', prompt_text: 'a', matched_brand_role: 'own' }),
        card({ prompt_id: 'b', prompt_text: 'b', prompt_result_id: 'rb' }),
        card({ prompt_id: 'c', prompt_text: 'c', prompt_result_id: 'rc' }),
        card({
          prompt_id: 'c',
          prompt_text: 'c',
          prompt_result_id: 'rc',
          position: 1,
          matched_brand_role: 'own',
        }),
      ],
      NOW,
    );
    expect(rows.map((row) => [row.promptId, row.ownRank])).toEqual([
      ['b', null],
      ['c', 2],
      ['a', 1],
    ]);
  });

  it('shows a few products a shelf, and leaves out cards without a question', () => {
    const rows = buildShelf(
      [
        ...Array.from({ length: 10 }, (_, i) => card({ position: i })),
        card({ prompt_id: null, prompt_result_id: 'x' }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toHaveLength(SHELF_CARDS);
  });
});

describe('shelfStats', () => {
  it("counts the brand's slots, its catalog products and the channels showing them", () => {
    const stats = shelfStats([
      card({ matched_brand_role: 'own', catalog_product_id: 'cp1', platform: 'copilot-web' }),
      card({ matched_brand_role: 'own', catalog_product_id: 'cp1' }),
      card({ matched_brand_role: 'own', catalog_product_id: 'cp2', platform: 'copilot-web' }),
      card({}),
    ]);
    expect(stats).toEqual({
      slots: 4,
      ownSlots: 3,
      products: 2,
      fromCatalog: true,
      channels: [
        { platform: 'copilot-web', ownSlots: 2 },
        { platform: 'chatgpt-shopping', ownSlots: 1 },
      ],
    });
  });

  it('counts titles when no card is matched to the catalog', () => {
    const stats = shelfStats([
      card({ matched_brand_role: 'own', product_title: 'Trail Runner X' }),
      card({ matched_brand_role: 'own', product_title: ' trail  runner x ' }),
      card({ matched_brand_role: 'own', product_title: 'StormShell' }),
    ]);
    expect([stats.products, stats.fromCatalog]).toEqual([2, false]);
  });
});

describe('inPriceBand', () => {
  it("reads a shelf's middle price", () => {
    const [row] = buildShelf(
      [
        card({ position: 0, price_amount: 119 }),
        card({ position: 1, price_amount: 139 }),
        card({ position: 2, price_amount: 145 }),
        card({ position: 3, price_amount: null }),
      ],
      NOW,
    );
    expect(inPriceBand(row, 'all')).toBe(true);
    expect(inPriceBand(row, '100to200')).toBe(true);
    expect(inPriceBand(row, 'under50')).toBe(false);
    const [noPrices] = buildShelf([card({ price_amount: null })], NOW);
    expect(inPriceBand(noPrices, 'over200')).toBe(false);
  });
});
