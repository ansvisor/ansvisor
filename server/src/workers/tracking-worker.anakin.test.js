import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A run with PLATFORM_PROVIDER=anakin: its platform tasks go to Anakin, all
 * at once, with Anakin's webhook URL, and wait as pending tasks for
 * /anakin/callback to drain them, the way a Cloro run waits for
 * /cloro/callback. Cloro is never asked.
 */

const STARTED = '2026-10-29T10:00:00.000Z';
const db = vi.hoisted(() => ({ stampedRuns: [], pendingPolls: [], pendingRows: [] }));

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
          data: [
            {
              id: 'p1',
              text: 'best x',
              platforms: ['chatgpt-web', 'copilot-web'],
              regions: ['US'],
            },
          ],
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
        return { data: [{ id: 'result-1' }], error: null };
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
                if (prop === 'insert' && table === 'cloro_pending_tasks')
                  db.pendingRows.push(...args[0]);
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
const cloroSubmit = vi.hoisted(() => vi.fn());
vi.mock('../lib/cloro-scraper.js', () => ({
  UNAVAILABLE_PLATFORMS: ['grok-web', 'perplexity-web'],
  submitPromptTask: cloroSubmit,
  submitScraperTask: vi.fn(),
  isLegacyChatgptTask: vi.fn(() => false),
  pollScraperResult: vi.fn(),
  parseScraperResponse: vi.fn(),
}));
const anakinSubmit = vi.hoisted(() => vi.fn());
vi.mock('../lib/anakin-scraper.js', () => ({
  UNAVAILABLE_PLATFORMS: [],
  submitPromptTask: anakinSubmit,
  submitScraperTask: vi.fn(),
  isLegacyChatgptTask: vi.fn(() => false),
  pollScraperResult: vi.fn(),
  parseScraperResponse: vi.fn(),
}));
const loadSupportedCountries = vi.hoisted(() => vi.fn(async () => new Map()));
vi.mock('../lib/cloro-countries.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadSupportedCountries,
}));
const settleTrackingRun = vi.hoisted(() => vi.fn());
vi.mock('../lib/run-settlement.js', () => ({ settleTrackingRun }));
const refreshRunDays = vi.hoisted(() => vi.fn());
vi.mock('../lib/insights-rollups.js', () => ({ refreshRunDays }));
vi.mock('../lib/ai-tracker.js', () => ({ runPrompt: vi.fn(), analyzeSentimentAI: vi.fn() }));
vi.mock('../lib/opportunity-generator.js', () => ({ generateContentOpportunities: vi.fn() }));
vi.mock('../lib/prompt-clusters.js', () => ({ refreshPromptClusters: vi.fn() }));
vi.mock('../lib/site-pages.js', () => ({ refreshSitePages: vi.fn() }));
vi.mock('../lib/target-url-stats.js', () => ({ updateTargetUrlStats: vi.fn() }));
vi.mock('../lib/citation-rows.js', () => ({ persistCitationRows: vi.fn() }));

const { processTrackingJob } = await import('./tracking-worker.js');

const pending = (...ids) => ids.map((id) => ({ task_id: id, submitted_at: STARTED }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('PLATFORM_PROVIDER', 'anakin');
  vi.stubEnv('ANAKIN_WEBHOOK_URL', 'https://api.example/anakin/callback');
  vi.stubEnv('ANAKIN_WEBHOOK_SECRET', 'whsec_test');
  vi.stubEnv('CLORO_WEBHOOK_URL', 'https://api.example/cloro/callback');
  taskIds = 0;
  db.stampedRuns = [{ id: 'yesterday' }];
  db.pendingRows = [];
  cloroSubmit.mockReset().mockImplementation(async ({ scraperId }) => ({
    taskId: `cloro-${++taskIds}`,
    scraperId,
    legacy: false,
  }));
  loadSupportedCountries.mockClear();
  anakinSubmit.mockReset().mockImplementation(async ({ scraperId }) => ({
    taskId: `job-${++taskIds}`,
    scraperId,
    legacy: false,
  }));
  settleTrackingRun.mockReset().mockResolvedValue({ stamped: true, lateStamp: null });
  refreshRunDays.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('processTrackingJob on Anakin', () => {
  it("submits every platform task to Anakin with its webhook, and drains them as they're answered", async () => {
    // Both tasks pending at first, one answered by the second poll, both by the third.
    db.pendingPolls = [pending('job-1', 'job-2'), pending('job-2'), []];
    const run = processTrackingJob({ brandId: 'b1', source: 'manual', job: { progress() {} } });
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(15_000);
    await run;

    expect(cloroSubmit).not.toHaveBeenCalled();
    expect(anakinSubmit.mock.calls.map(([task]) => [task.scraperId, task.webhookUrl])).toEqual([
      ['chatgpt-web', 'https://api.example/anakin/callback'],
      ['copilot-web', 'https://api.example/anakin/callback'],
    ]);
    // Each row says whose task it is (00562), so only /anakin/callback takes it.
    expect(db.pendingRows.map((row) => [row.task_id, row.scraper_id, row.provider])).toEqual([
      ['job-1', 'chatgpt-web', 'anakin'],
      ['job-2', 'copilot-web', 'anakin'],
    ]);
    expect(settleTrackingRun).toHaveBeenCalledTimes(1);
  });

  it("never reads Cloro's country lists, so no country is skipped for Anakin", async () => {
    // Cloro's lists would say ChatGPT doesn't answer from the US.
    loadSupportedCountries.mockResolvedValue(new Map([['chatgpt', new Set(['DE'])]]));
    db.pendingPolls = [[]];
    const run = processTrackingJob({ brandId: 'b1', source: 'manual', job: { progress() {} } });
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(15_000);
    await run;

    expect(loadSupportedCountries).not.toHaveBeenCalled();
    expect(anakinSubmit.mock.calls.map(([task]) => [task.scraperId, task.region])).toEqual([
      ['chatgpt-web', 'US'],
      ['copilot-web', 'US'],
    ]);
  });

  it('keeps Bing AI Mode on Cloro with PLATFORM_PROVIDER_OVERRIDES, each on its own webhook', async () => {
    vi.stubEnv('PLATFORM_PROVIDER_OVERRIDES', 'copilot-web=cloro');
    db.pendingPolls = [pending('job-1', 'cloro-2'), []];
    const run = processTrackingJob({ brandId: 'b1', source: 'manual', job: { progress() {} } });
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(15_000);
    await run;

    expect(anakinSubmit.mock.calls.map(([task]) => [task.scraperId, task.webhookUrl])).toEqual([
      ['chatgpt-web', 'https://api.example/anakin/callback'],
    ]);
    expect(cloroSubmit.mock.calls.map(([task]) => [task.scraperId, task.webhookUrl])).toEqual([
      ['copilot-web', 'https://api.example/cloro/callback'],
    ]);
    // Each row names its provider, so each webhook takes only its own (00562).
    expect(db.pendingRows.map((row) => [row.task_id, row.provider])).toEqual([
      ['job-1', 'anakin'],
      ['cloro-2', 'cloro'],
    ]);
  });

  it("polls every task when one of the run's providers has no webhook", async () => {
    vi.stubEnv('PLATFORM_PROVIDER_OVERRIDES', 'copilot-web=cloro');
    vi.stubEnv('CLORO_WEBHOOK_URL', '');
    const run = processTrackingJob({ brandId: 'b1', source: 'manual', job: { progress() {} } });
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(15_000);
    await run.catch(() => {});

    expect(anakinSubmit.mock.calls.map(([task]) => task.webhookUrl)).toEqual([null]);
    expect(cloroSubmit.mock.calls.map(([task]) => task.webhookUrl)).toEqual([null]);
    expect(db.pendingRows).toEqual([]);
  });
});
