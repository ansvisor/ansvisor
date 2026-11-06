import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/visibility/read: one of the Visibility tabs' reads by name, run
 * with the member's session; a route so a tab's reads run side by side.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
let user: { id: string } | null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}));

const reads = vi.hoisted(() => ({
  getInsightsData: vi.fn(),
  getMentionsOverview: vi.fn(),
  listMentions: vi.fn(),
  getCitationsOverview: vi.fn(),
  getTopics: vi.fn(),
}));
vi.mock('@/lib/actions/tracking', () => ({
  getBrandFilterOptions: vi.fn(),
  getBrandPrompts: vi.fn(),
  getInsightsData: reads.getInsightsData,
  getInsightsOpportunities: vi.fn(),
  getTrackingWindow: vi.fn(),
}));
vi.mock('@/lib/actions/mentions', () => ({
  getMentionsOverview: reads.getMentionsOverview,
  getMentionsPerception: vi.fn(),
  listMentions: reads.listMentions,
}));
vi.mock('@/lib/actions/citations', () => ({
  brandHasCitations: vi.fn(),
  getCitationGaps: vi.fn(),
  getCitationsOverview: reads.getCitationsOverview,
}));
vi.mock('@/lib/actions/topic', () => ({ getTopics: reads.getTopics }));
vi.mock('@/lib/actions/competitor', () => ({ getCompetitors: vi.fn() }));
const shopping = vi.hoisted(() => ({
  getCompetitorProducts: vi.fn(),
  getCompetitorSummary: vi.fn(),
  getOwnProducts: vi.fn(),
  getResellerPriceAlerts: vi.fn(),
  getShoppingActionResults: vi.fn(),
  getShoppingAiOrders: vi.fn(),
  getShoppingAmazonShareDropAlert: vi.fn(),
  getShoppingCategories: vi.fn(),
  getShoppingFilterOptions: vi.fn(),
  getShoppingMerchantSplit: vi.fn(),
  getShoppingOverview: vi.fn(),
  getShoppingProducts: vi.fn(),
  getShoppingSearchAppearance: vi.fn(),
  getShoppingShelf: vi.fn(),
}));
vi.mock('@/lib/actions/shopping', () => shopping);
vi.mock('@/lib/actions/shopping-market', () => ({ getBrandMarketCountries: vi.fn() }));
vi.mock('@/lib/actions/shopping-openai-index', () => ({ getOpenAiIndexRead: vi.fn() }));
vi.mock('@/lib/actions/catalog', () => ({ listCatalogSources: vi.fn() }));
vi.mock('@/lib/actions/integrations', () => ({ getMerchantCenterOffered: vi.fn() }));
vi.mock('@/lib/actions/traffic', () => ({ getTrafficSources: vi.fn() }));

const { POST } = await import('./route');

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/visibility/read', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

const WEEK = { from: '2026-10-30T00:00:00.000Z', platform: 'claude' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  user = { id: 'u1' };
});

describe('POST /api/visibility/read', () => {
  it("runs the named read with the action's arguments", async () => {
    reads.getMentionsOverview.mockResolvedValue({ current: { answers: 12 } });
    const res = await post({ read: 'mentionsOverview', args: [BRAND, WEEK] });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ data: { current: { answers: 12 } } });
    expect(reads.getMentionsOverview).toHaveBeenCalledWith(BRAND, WEEK);
  });

  it('takes the Mentions table’s four arguments', async () => {
    reads.listMentions.mockResolvedValue({ total: 0, prompts: 0, rows: [] });
    const table = { sentiment: '', competitor: '', group: '', sort: 'newest' };
    await post({ read: 'mentionsList', args: [BRAND, WEEK, table, 2] });
    expect(reads.listMentions).toHaveBeenCalledWith(BRAND, WEEK, table, 2);
  });

  it('passes an argument the browser left out as undefined, not null', async () => {
    reads.getTopics.mockResolvedValue([]);
    await post({ read: 'topics', args: [BRAND, null] });
    expect(reads.getTopics).toHaveBeenCalledWith(BRAND, undefined);
  });

  it('answers a read that came back empty with null', async () => {
    reads.getMentionsOverview.mockResolvedValue(null);
    expect(await (await post({ read: 'mentionsOverview', args: [BRAND, WEEK] })).json()).toEqual({
      data: null,
    });
  });

  it('refuses an unknown read, a missing brand, too many arguments, and anyone signed out', async () => {
    expect((await post({ read: 'triggerTrackingCheck', args: [BRAND] })).status).toBe(400);
    expect((await post({ read: 'topics', args: ['not-a-brand'] })).status).toBe(400);
    expect((await post({ read: 'topics', args: [] })).status).toBe(400);
    expect((await post({ read: 'topics', args: [BRAND, 1, 2, 3, 4] })).status).toBe(400);
    user = null;
    expect((await post({ read: 'insights', args: [BRAND, {}] })).status).toBe(401);
    expect(reads.getInsightsData).not.toHaveBeenCalled();
  });

  it("answers 500 without the read's own error", async () => {
    reads.getCitationsOverview.mockRejectedValue(new Error('canceling statement due to timeout'));
    const res = await post({ read: 'citationsOverview', args: [BRAND, { datePreset: '24h' }] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load' });
  });

  it("runs Product Visibility's reads, with their filters", async () => {
    const filters = { datePreset: '30d', chatgptMarket: 'us' };
    shopping.getShoppingShelf.mockResolvedValue({ rows: [], stats: {}, catalogProducts: null });
    const res = await post({ read: 'shoppingShelf', args: [BRAND, filters] });
    expect(res.status).toBe(200);
    expect(shopping.getShoppingShelf).toHaveBeenCalledWith(BRAND, filters);
  });

  it('logs each read with how long it took, and a slow one as a warning', async () => {
    reads.getTopics.mockResolvedValue([]);
    await post({ read: 'topics', args: [BRAND] });
    expect(console.info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[visibility\/read\] topics \d+ms$/),
    );

    vi.useFakeTimers({ toFake: ['performance'] });
    try {
      shopping.getShoppingProducts.mockImplementation(async () => {
        vi.advanceTimersByTime(2500);
        return null;
      });
      await post({ read: 'shoppingProducts', args: [BRAND, { datePreset: '30d' }] });
      expect(console.warn).toHaveBeenCalledWith('[visibility/read] shoppingProducts 2500ms (slow)');
    } finally {
      vi.useRealTimers();
    }

    reads.getCitationsOverview.mockRejectedValue(new Error('down'));
    await post({ read: 'citationsOverview', args: [BRAND, {}] });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[visibility\/read\] citationsOverview failed after \d+ms:$/),
      expect.any(Error),
    );
  });

  it('reads where AI sends shoppers in one read, a part that fails coming back empty', async () => {
    shopping.getShoppingMerchantSplit.mockRejectedValue(new Error('down'));
    shopping.getResellerPriceAlerts.mockResolvedValue([{ productTitle: 'Beans' }]);
    const res = await post({ read: 'shoppingDestinations', args: [BRAND, { datePreset: '7d' }] });
    expect(await res.json()).toEqual({
      data: { split: null, priceAlerts: [{ productTitle: 'Beans' }] },
    });
  });
});
