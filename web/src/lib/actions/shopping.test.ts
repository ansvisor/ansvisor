import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #922 — the Shopping page used to aggregate unpaged selects, which PostgREST
 * caps at 1,000 rows. These tests pin that the card reads page through every
 * row and that the Overview comes from the `shopping_overview` RPC.
 */

interface QueryState {
  table: string;
  eq: Record<string, unknown>;
  range?: [number, number];
  head?: boolean;
}

const PAGE_CAP = 1000;

let cards: Array<Record<string, unknown>> = [];
let overviewRow: Record<string, unknown> = {};
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let cardCalls: QueryState[] = [];

function resolveQuery(state: QueryState) {
  if (state.table === 'competitors') {
    return {
      data: [
        { id: 'c-1', name: 'Rival One', domain: 'rival-one.example' },
        { id: 'c-2', name: 'Rival Two', domain: 'rival-two.example' },
      ],
      error: null,
    };
  }
  if (state.table === 'prompt_result_shopping_cards') {
    const rows = cards.filter(
      (c) =>
        state.eq.matched_brand_role === undefined ||
        c.matched_brand_role === state.eq.matched_brand_role,
    );
    if (state.head) return { data: null, count: rows.length, error: null };
    // Like PostgREST: an unpaged select still stops at the cap.
    const [from, to] = state.range ?? [0, PAGE_CAP - 1];
    return { data: rows.slice(from, Math.min(to + 1, from + PAGE_CAP)), error: null };
  }
  return { data: [], error: null };
}

function fakeQueryBuilder(table: string) {
  const state: QueryState = { table, eq: {} };
  const builder = {
    select: (_columns: string, opts?: { head?: boolean }) => {
      state.head = opts?.head;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      state.eq[column] = value;
      return builder;
    },
    gte: () => builder,
    lte: () => builder,
    in: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      state.range = [from, to];
      return builder;
    },
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      if (table === 'prompt_result_shopping_cards') cardCalls.push({ ...state });
      return Promise.resolve(resolveQuery(state)).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => fakeQueryBuilder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: overviewRow, error: null };
    },
  }),
}));

import {
  getCompetitorProducts,
  getCompetitorSummary,
  getOwnProducts,
  getShoppingKpis,
  getShoppingOverview,
} from './shopping';

function card(i: number, role: 'own' | 'competitor' | 'other', matched?: string) {
  return {
    id: `card-${i}`,
    created_at: '2026-10-01T12:00:00.000Z',
    platform: 'google-aimode',
    region: 'US',
    product_title: `Product ${i % 7}`,
    product_brand: 'Acme',
    price_amount: 10,
    price_currency: 'USD',
    image_url: null,
    merchant_url: null,
    merchant_domain: 'shop.example',
    raw: null,
    matched_brand_id: matched ?? null,
    matched_brand_role: role,
    prompt_results: { prompt: { id: 'p-1', text: 'Best running shoes?' } },
  };
}

beforeEach(() => {
  cards = [];
  rpcCalls = [];
  cardCalls = [];
  overviewRow = {
    total_results: 4000,
    results_with_cards: 1000,
    total_cards: 5845,
    own_cards: 1169,
    top_merchant: { domain: 'shop.example', card_count: 900 },
    by_platform: [
      { platform: 'chatgpt', total_results: 3000, results_with_cards: 600 },
      { platform: 'google-aimode', total_results: 1000, results_with_cards: 400 },
      { platform: 'perplexity', total_results: 0, results_with_cards: 0 },
    ],
    trend: [],
  };
});

describe('getOwnProducts', () => {
  it('counts every own card past the 1,000-row cap', async () => {
    cards = Array.from({ length: 2500 }, (_, i) => card(i, 'own'));
    const products = await getOwnProducts('brand-1', { datePreset: '30d' });

    expect(products.reduce((sum, p) => sum + p.impressions, 0)).toBe(2500);
    expect(cardCalls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});

describe('getCompetitorProducts', () => {
  it('pages through competitor cards', async () => {
    cards = Array.from({ length: 1200 }, (_, i) => card(i, 'competitor', 'c-1'));
    const products = await getCompetitorProducts('brand-1', { datePreset: '30d' });

    expect(products.reduce((sum, p) => sum + p.impressions, 0)).toBe(1200);
    expect(products[0].competitor_name).toBe('Rival One');
  });
});

describe('getCompetitorSummary', () => {
  it('counts each competitor across pages', async () => {
    cards = [
      ...Array.from({ length: 1500 }, (_, i) => card(i, 'competitor', 'c-1')),
      ...Array.from({ length: 300 }, (_, i) => card(i, 'competitor', 'c-2')),
      ...Array.from({ length: 200 }, (_, i) => card(i, 'other')),
    ];
    const summary = await getCompetitorSummary('brand-1', { datePreset: '30d' });

    expect(summary.map((s) => [s.competitor_id, s.card_count])).toEqual([
      ['c-1', 1500],
      ['c-2', 300],
    ]);
    expect(summary[0].sov).toBeCloseTo(1500 / 2000);
  });
});

describe('getShoppingOverview', () => {
  it('builds KPIs and charts from one RPC call', async () => {
    const { kpis, charts } = await getShoppingOverview('brand-1', {
      datePreset: 'all',
      platforms: ['chatgpt'],
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('shopping_overview');
    expect(rpcCalls[0].args).toMatchObject({
      p_brand_id: 'brand-1',
      p_platforms: ['chatgpt'],
    });
    expect(rpcCalls[0].args.p_trend_from).toEqual(expect.any(String));

    expect(kpis).toEqual({
      shoppingCardRate: 0.25,
      shoppingCardRateSampleSize: 4000,
      productsSurfaced: 1169,
      shoppingSov: 1169 / 5845,
      topMerchant: { domain: 'shop.example', cardCount: 900 },
    });
    expect(charts.platformCardRate.map((p) => p.platform)).toEqual(['google-aimode', 'chatgpt']);
    expect(charts.ownPresenceTrend).toHaveLength(30);
  });

  it('places trend days on their UTC date and fills empty days with zeros', async () => {
    const today = new Date().toISOString().slice(0, 10);
    overviewRow.trend = [{ day: today, own_cards: 3, total_cards: 12 }];
    const { charts } = await getShoppingOverview('brand-1', { datePreset: '30d' });

    expect(charts.ownPresenceTrend.at(-1)).toEqual({ date: today, ownCards: 3, totalCards: 12 });
    expect(charts.ownPresenceTrend[0]).toMatchObject({ ownCards: 0, totalCards: 0 });
  });
});

describe('getShoppingKpis', () => {
  it('skips the trend', async () => {
    await getShoppingKpis('brand-1', { datePreset: '30d' });
    expect(rpcCalls[0].args.p_trend_from).toBeUndefined();
  });
});
