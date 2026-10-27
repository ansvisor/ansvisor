import { describe, it, expect, vi, beforeEach } from 'vitest';

// The handler reaches the supabase admin client at import time, and the AI
// tracker reaches the model SDKs; stub both so the module loads under test.
const upsert = vi.fn();
const from = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: { from: (...a) => from(...a) },
}));
const analyzeSentimentAI = vi.fn();
vi.mock('./ai-tracker.js', () => ({ analyzeSentimentAI: (...a) => analyzeSentimentAI(...a) }));
const isBrandActiveCached = vi.fn();
vi.mock('./active-subscriptions.js', () => ({
  isBrandActiveCached: (...a) => isBrandActiveCached(...a),
}));
vi.mock('./target-url-stats.js', () => ({ updateTargetUrlStats: vi.fn() }));
vi.mock('./citation-rows.js', async (importOriginal) => ({
  ...(await importOriginal()),
  persistCitationRows: vi.fn(),
}));

import { handleScraperResult, persistShoppingCards } from './cloro-result-handler.js';

beforeEach(() => {
  from.mockReset().mockImplementation(() => ({ upsert }));
  analyzeSentimentAI.mockReset().mockResolvedValue({ sentiment: 'positive' });
  isBrandActiveCached.mockReset().mockResolvedValue(true);
});

/**
 * Cloro's answer for a brand whose organization's plan has ended
 * (2026-10-27): dropped, with no sentiment call and nothing stored.
 */
describe('handleScraperResult once the plan has ended', () => {
  const answer = {
    aiResponse: { text: 'Acme is a good pick.', citations: [], model: 'gpt' },
    scraperId: 'chatgpt-web',
    promptId: 'prompt-1',
    brandId: 'brand-1',
    region: 'US',
    brandInfo: { brandName: 'Acme', domains: ['acme.com'] },
    competitors: [],
  };

  it('drops the answer, calling no model and writing nothing', async () => {
    isBrandActiveCached.mockResolvedValue(false);

    expect(await handleScraperResult(answer)).toEqual({
      inserted: false,
      skipped: 'subscription_inactive',
    });
    expect(isBrandActiveCached).toHaveBeenCalledWith('brand-1');
    expect(analyzeSentimentAI).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('stores the answer, with its sentiment, while the plan is on', async () => {
    const insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: 'r1', created_at: 'now' }, error: null }),
      }),
    }));
    from.mockImplementation(() => ({ insert, upsert }));

    expect(await handleScraperResult(answer)).toEqual({ inserted: true });
    expect(analyzeSentimentAI).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('prompt_results');
    expect(insert.mock.calls[0][0]).toMatchObject({ prompt_id: 'prompt-1', sentiment: 'positive' });
  });
});

const base = {
  promptResultId: 'result-1',
  brandId: 'brand-1',
  platform: 'chatgpt-shopping',
  region: 'US',
  brandInfo: { brandId: 'brand-1', brandName: 'Acme', domains: ['acme.com'] },
  competitors: [],
};

describe('persistShoppingCards – ChatGPT inline products (#1183)', () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
  });

  it('stores inline products after the carousel cards', async () => {
    const inserted = await persistShoppingCards({
      ...base,
      rawCards: [
        {
          tags: [],
          products: [
            { title: 'Carousel A', position: 1, price: '$10.00' },
            { title: 'Carousel B', position: 2, price: '$12.00' },
          ],
        },
      ],
      rawInlineProducts: [
        { product: { title: 'Acme Trail Runner', price: '$75.00' }, entity: 'Acme Trail Runner' },
      ],
    });

    expect(inserted).toBe(3);
    const rows = upsert.mock.calls[0][0];
    expect(rows.map((row) => [row.product_title, row.position])).toEqual([
      ['Carousel A', 1],
      ['Carousel B', 2],
      ['Acme Trail Runner', 3],
    ]);
    expect(rows[2].raw.surface).toBe('inline');
    expect(rows[2].matched_brand_role).toBe('own');
  });

  it('stores inline products when the answer has no carousel', async () => {
    const inserted = await persistShoppingCards({
      ...base,
      rawCards: [],
      rawInlineProducts: [{ product: { title: 'Trail Runner', price: '$75.00' } }],
    });

    expect(inserted).toBe(1);
    expect(upsert.mock.calls[0][0][0].position).toBe(1);
  });

  it('persists the merchant classification and keeps cards without a URL unclassified', async () => {
    const inserted = await persistShoppingCards({
      ...base,
      rawCards: [
        {
          products: [
            {
              title: 'Acme Trail Runner on Amazon',
              url: 'https://www.amazon.com/dp/B0C123ABCD?tag=tracking',
              price: '$75.00',
            },
            {
              title: 'Acme Trail Runner Store',
              url: 'https://shop.acme.com/products/trail-runner',
              price: '$75.00',
            },
            {
              title: 'Acme Trail Runner Reseller',
              url: 'https://shop.example/products/trail-runner',
              price: '$70.00',
            },
            { title: 'Acme Trail Runner without merchant URL', price: '$75.00' },
          ],
        },
      ],
    });

    expect(inserted).toBe(4);
    const rows = upsert.mock.calls[0][0];
    expect(rows.map((row) => [row.merchant_kind, row.marketplace, row.listing_id])).toEqual([
      ['marketplace', 'amazon', 'B0C123ABCD'],
      ['own', null, null],
      ['reseller', null, null],
      [null, null, null],
    ]);
  });

  it('writes nothing when there are neither cards nor inline products', async () => {
    const inserted = await persistShoppingCards({ ...base, rawCards: [] });
    expect(inserted).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});
