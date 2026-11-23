import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A run without CLORO_WEBHOOK_URL polls each task inline. A polled answer is
 * stored as the webhook stores it (handleScraperResult): the same
 * prompt_results row, and its shopping cards in prompt_result_shopping_cards.
 */

const STARTED = '2026-10-29T10:00:00.000Z';
const db = vi.hoisted(() => ({ stampedRuns: [], pendingPolls: [], inserted: [], rows: [] }));

vi.mock('../config/supabase.js', () => {
  const answer = (table, ops) => {
    const did = (op) => ops.includes(op);
    switch (table) {
      case 'brands':
        return {
          data: { id: 'b1', name: 'Acme', organization_id: 'o1', shopping_mode_enabled: false },
        };
      case 'brand_domains':
        return { data: [{ domain: 'acme.example' }] };
      case 'prompt_sets':
        return { data: [{ id: 's1' }] };
      case 'prompts':
        return {
          data: [{ id: 'p1', text: 'best x', platforms: ['chatgpt-web'] }],
          error: null,
        };
      case 'tracking_runs':
        if (did('insert')) return { data: { id: 'r1', started_at: STARTED }, error: null };
        if (did('not')) return { data: db.stampedRuns, error: null };
        return { error: null };
      case 'cloro_pending_tasks':
        if (did('insert')) return { error: null };
        return { data: db.pendingPolls.shift() ?? [], error: null };
      case 'prompt_results':
        if (did('insert')) db.inserted.push(ops);
        return { data: { id: 'result-1', created_at: STARTED }, error: null };
      default:
        return { data: null, error: null };
    }
  };
  return {
    default: {
      from: (table) => {
        const ops = [];
        const chain = new Proxy(
          {},
          {
            get: (_target, prop) => {
              if (prop === 'then')
                return (resolve, reject) =>
                  Promise.resolve(answer(table, ops)).then(resolve, reject);
              if (prop === 'single' || prop === 'maybeSingle')
                return async () => answer(table, ops);
              return (...args) => {
                ops.push(prop);
                if (prop === 'insert' && table === 'prompt_results') db.rows.push(args[0]);
                return chain;
              };
            },
          },
        );
        return chain;
      },
    },
  };
});

let taskIds = 0;
const card = { title: 'Acme Kettle', price: '$40', merchant: 'acme.example' };
const product = { name: 'Acme Mug', url: 'https://acme.example/mug' };
const answer = vi.hoisted(() => ({}));
vi.mock('../lib/cloro-scraper.js', () => ({
  UNAVAILABLE_PLATFORMS: ['grok-web', 'copilot-web', 'perplexity-web'],
  submitPromptTask: vi.fn(async ({ scraperId, legacy = false }) => ({
    taskId: `t${++taskIds}`,
    scraperId,
    legacy,
  })),
  isLegacyChatgptTask: vi.fn(() => false),
  pollScraperResult: vi.fn(async () => answer),
}));
vi.mock('../lib/cloro-countries.js', () => ({
  loadSupportedCountries: async () => new Map(),
  supportedLocations: (locations) => locations,
}));
const settleTrackingRun = vi.hoisted(() => vi.fn());
vi.mock('../lib/run-settlement.js', () => ({ settleTrackingRun }));
const refreshRunDays = vi.hoisted(() => vi.fn());
vi.mock('../lib/insights-rollups.js', () => ({ refreshRunDays }));
vi.mock('../lib/ai-tracker.js', () => ({
  runPrompt: vi.fn(),
  analyzeSentimentAI: vi.fn(async () => ({ sentiment: 'positive', confidence: 1 })),
}));
const persistShoppingCards = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('../lib/cloro-result-handler.js', async (importOriginal) => ({
  ...(await importOriginal()),
  persistShoppingCards,
}));
vi.mock('../lib/opportunity-generator.js', () => ({ generateContentOpportunities: vi.fn() }));
vi.mock('../lib/prompt-clusters.js', () => ({ refreshPromptClusters: vi.fn() }));
vi.mock('../lib/site-pages.js', () => ({ refreshSitePages: vi.fn() }));
vi.mock('../lib/target-url-stats.js', () => ({ updateTargetUrlStats: vi.fn() }));
vi.mock('../lib/citation-rows.js', () => ({ persistCitationRows: vi.fn() }));

const { processTrackingJob } = await import('./tracking-worker.js');

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('CLORO_WEBHOOK_URL', '');
  taskIds = 0;
  db.stampedRuns = [{ id: 'yesterday' }];
  db.inserted = [];
  db.rows = [];
  persistShoppingCards.mockClear();
  settleTrackingRun.mockReset().mockResolvedValue({ stamped: true, lateStamp: null });
  Object.assign(answer, {
    text: 'Acme makes the best x.',
    citations: [{ url: 'https://acme.example/x', title: 'x' }],
    model: 'gpt',
    shopping_cards: [card],
    inline_products: [product],
    search_queries: [{ query: 'best x', source_platform: 'chatgpt' }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('processTrackingJob, polling (no webhook)', () => {
  it("stores a polled answer's shopping cards, as the webhook does", async () => {
    await processTrackingJob({ brandId: 'b1', source: 'manual', job: { progress() {} } });

    expect(db.inserted).toHaveLength(1);
    expect(persistShoppingCards).toHaveBeenCalledTimes(1);
    expect(persistShoppingCards).toHaveBeenCalledWith(
      expect.objectContaining({
        promptResultId: 'result-1',
        brandId: 'b1',
        platform: 'chatgpt-web',
        rawCards: [card],
        rawInlineProducts: [product],
        brandInfo: expect.objectContaining({ brandId: 'b1', brandName: 'Acme' }),
      }),
    );
  });

  it('writes the row the webhook writes: cards, inline products and fan-out included', async () => {
    await processTrackingJob({ brandId: 'b1', source: 'manual', job: { progress() {} } });

    expect(db.rows).toEqual([
      expect.objectContaining({
        prompt_id: 'p1',
        brand_id: 'b1',
        platform: 'chatgpt-web',
        response: 'Acme makes the best x.',
        shopping_cards: [card],
        inline_products: [product],
        search_queries: [{ query: 'best x', source_platform: 'chatgpt' }],
      }),
    ]);
  });
});
