import { describe, expect, it } from 'vitest';

import {
  catalogProductSourceData,
  catalogSourceData,
  fromCatalog,
  fromYourData,
  gaSourceData,
  gscSourceData,
  promptSourceData,
  sourceDataRefused,
  validPromptSourceData,
  type CatalogProductSuggestionSourceData,
  type CatalogSuggestionSourceData,
  type GaSuggestionSourceData,
  type GscSuggestionSourceData,
} from './prompt-suggestion-source';

const gscData: GscSuggestionSourceData = {
  query: 'brand monitoring software',
  impressions: 1200,
  clicks: 84,
  avgPosition: 7.2,
  badge: 'capture_demand',
  competitionIndex: 31,
};

const gaData: GaSuggestionSourceData = {
  landingPage: '/guides/brand-monitoring',
  kind: 'ai_momentum',
  rank: 2,
  sessions: 480,
  keyEvents: 37,
  transactions: 9,
  revenue: 1250,
  aiSessions: 64,
  aiPlatforms: ['ChatGPT', 'Perplexity'],
  pageTitle: 'Brand Monitoring Guide',
};

describe('gscSourceData', () => {
  it('returns the payload when the source and shape agree', () => {
    expect(gscSourceData({ source: 'gsc', sourceData: gscData })).toBe(gscData);
  });

  it('returns null when sourceData is null', () => {
    expect(gscSourceData({ source: 'gsc', sourceData: null })).toBeNull();
  });

  it('returns null when the payload has the GA shape', () => {
    expect(gscSourceData({ source: 'gsc', sourceData: gaData })).toBeNull();
  });

  it('returns null when another source carries a GSC-shaped payload', () => {
    expect(gscSourceData({ source: 'llm', sourceData: gscData })).toBeNull();
  });
});

describe('gaSourceData', () => {
  it('returns the payload when the source and shape agree', () => {
    expect(gaSourceData({ source: 'ga', sourceData: gaData })).toBe(gaData);
  });

  it('returns null when sourceData is null', () => {
    expect(gaSourceData({ source: 'ga', sourceData: null })).toBeNull();
  });

  it('returns null when the payload has the GSC shape', () => {
    expect(gaSourceData({ source: 'ga', sourceData: gscData })).toBeNull();
  });

  it('returns null when another source carries a GA-shaped payload', () => {
    expect(gaSourceData({ source: 'heuristic', sourceData: gaData })).toBeNull();
  });
});

describe('fromYourData', () => {
  it('takes a suggestion built from Search Console or Analytics data', () => {
    expect(fromYourData({ source: 'gsc', sourceData: gscData })).toBe(true);
    expect(fromYourData({ source: 'ga', sourceData: gaData })).toBe(true);
  });

  it("leaves out the agents' suggestions and a source without its data", () => {
    expect(fromYourData({ source: 'llm', sourceData: null })).toBe(false);
    expect(fromYourData({ source: 'gsc', sourceData: null })).toBe(false);
    expect(fromYourData({ source: 'ga', sourceData: gscData })).toBe(false);
  });
});

// ─── The catalog (ECOM-003, AC plan P-8) ────────────────────────────────────

const CATEGORY_ID = '7a1c2b9e-2222-4c3d-8e9f-000000000002';
const PRODUCT_ID = '7a1c2b9e-1111-4c3d-8e9f-000000000001';
const SUGGESTED_AT = '2026-11-09T08:00:00.123456+00:00';

const categoryData: CatalogSuggestionSourceData = {
  category: 'Bags > Hiking backpacks',
  categoryId: CATEGORY_ID,
  products: 18,
  priceLow: 60,
  priceHigh: 180,
  priceUnder: 150,
  currency: 'USD',
};

const productData: CatalogProductSuggestionSourceData = {
  product: 'Atmos AG 65',
  productId: PRODUCT_ID,
  productType: 'Backpack',
  category: 'Bags > Hiking backpacks',
  categoryId: CATEGORY_ID,
  cardPrompts: 4,
  orders: 12,
};

describe('catalogSourceData and catalogProductSourceData', () => {
  it('tells a category from a product, though both name a category', () => {
    expect(catalogSourceData({ source: 'catalog', sourceData: categoryData })).toBe(categoryData);
    expect(catalogSourceData({ source: 'catalog', sourceData: productData })).toBeNull();
    expect(catalogProductSourceData({ source: 'catalog', sourceData: productData })).toBe(
      productData,
    );
    expect(catalogProductSourceData({ source: 'catalog', sourceData: categoryData })).toBeNull();
  });

  it('counts both as Shopping, and nothing from another source', () => {
    expect(fromCatalog({ source: 'catalog', sourceData: categoryData })).toBe(true);
    expect(fromCatalog({ source: 'catalog', sourceData: productData })).toBe(true);
    expect(fromCatalog({ source: 'llm', sourceData: productData })).toBe(false);
    expect(fromCatalog({ source: 'catalog', sourceData: null })).toBe(false);
  });
});

describe('promptSourceData', () => {
  it('keeps the product and its category for a prompt accepted from a product', () => {
    expect(
      promptSourceData({ source: 'catalog', sourceData: productData, generatedAt: SUGGESTED_AT }),
    ).toEqual({
      kind: 'catalog_product',
      product_ids: [PRODUCT_ID],
      category_id: CATEGORY_ID,
      category: 'Bags > Hiking backpacks',
      suggested_at: SUGGESTED_AT,
    });
  });

  it('keeps the category, by name too, for one accepted from a category', () => {
    expect(
      promptSourceData({ source: 'catalog', sourceData: categoryData, generatedAt: SUGGESTED_AT }),
    ).toEqual({
      kind: 'catalog_category',
      category_id: CATEGORY_ID,
      category: 'Bags > Hiking backpacks',
      suggested_at: SUGGESTED_AT,
    });
    // Made before the id was kept: the name alone.
    const older = { ...categoryData };
    delete older.categoryId;
    expect(
      promptSourceData({ source: 'catalog', sourceData: older, generatedAt: SUGGESTED_AT }),
    ).toMatchObject({ kind: 'catalog_category', category_id: null });
  });

  it('keeps nothing for any other suggestion', () => {
    expect(
      promptSourceData({ source: 'gsc', sourceData: gscData, generatedAt: SUGGESTED_AT }),
    ).toBe(null);
    expect(promptSourceData({ source: 'llm', sourceData: null, generatedAt: SUGGESTED_AT })).toBe(
      null,
    );
  });

  it('cuts a long category name so the column stays small', () => {
    const long = { ...categoryData, category: 'x'.repeat(750) };
    const kept = promptSourceData({
      source: 'catalog',
      sourceData: long,
      generatedAt: SUGGESTED_AT,
    });
    expect(kept?.category).toHaveLength(300);
    expect(validPromptSourceData(kept)).toEqual(kept);
  });
});

describe('validPromptSourceData', () => {
  const product = promptSourceData({
    source: 'catalog',
    sourceData: productData,
    generatedAt: SUGGESTED_AT,
  });

  it('takes the two kinds as promptSourceData makes them', () => {
    expect(validPromptSourceData(product)).toEqual(product);
  });

  it('takes nothing else: another kind, a stray key, an id that is no id, or no products', () => {
    expect(validPromptSourceData({ ...product, kind: 'gsc' })).toBeNull();
    expect(validPromptSourceData({ ...product, note: 'anything' })).toBeNull();
    expect(validPromptSourceData({ ...product, product_ids: ['not-an-id'] })).toBeNull();
    expect(validPromptSourceData({ ...product, product_ids: [] })).toBeNull();
    expect(validPromptSourceData({ ...product, suggested_at: 'yesterday' })).toBeNull();
    expect(validPromptSourceData(null)).toBeNull();
    expect(validPromptSourceData('catalog')).toBeNull();
  });
});

describe('sourceDataRefused', () => {
  it('reads a missing column or the check turning it down as refused, nothing else', () => {
    expect(
      sourceDataRefused({
        code: 'PGRST204',
        message: "Could not find the 'source_data' column of 'prompts' in the schema cache",
      }),
    ).toBe(true);
    expect(
      sourceDataRefused({
        code: '23514',
        message:
          'new row for relation "prompts" violates check constraint "prompts_source_data_check"',
      }),
    ).toBe(true);
    expect(sourceDataRefused({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(sourceDataRefused(null)).toBe(false);
  });
});
