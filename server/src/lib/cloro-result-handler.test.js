import { describe, it, expect, vi, beforeEach } from 'vitest';

// The handler reaches the supabase admin client at import time, and the AI
// tracker reaches the model SDKs; stub both so the module loads under test.
const upsert = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: { from: () => ({ upsert }) },
}));
vi.mock('./ai-tracker.js', () => ({ analyzeSentimentAI: vi.fn() }));

import { persistShoppingCards } from './cloro-result-handler.js';

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

  it('writes nothing when there are neither cards nor inline products', async () => {
    const inserted = await persistShoppingCards({ ...base, rawCards: [] });
    expect(inserted).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});
