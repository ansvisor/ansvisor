import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { InsightsData } from '@/lib/actions/tracking';

/**
 * Brand Visibility's Overview tab while its data loads, and when a read
 * fails (the owner's ask): the skeleton until the read is back, never "No
 * tracking data yet" before it; a failed read says so with Retry; a section
 * whose own read failed isn't shown as "none".
 */

const actions = vi.hoisted(() => ({
  getInsightsData: vi.fn(),
  getBrandFilterOptions: vi.fn(async () => ({ regions: [], models: [] })),
  exportPromptResults: vi.fn(),
  getTopics: vi.fn(async () => []),
}));
vi.mock('@/lib/actions/tracking', () => ({
  getInsightsData: actions.getInsightsData,
  getBrandFilterOptions: actions.getBrandFilterOptions,
  exportPromptResults: actions.exportPromptResults,
}));
vi.mock('@/lib/actions/topic', () => ({ getTopics: actions.getTopics }));
vi.mock('@/hooks/use-first-run', () => ({ useFirstRun: () => null }));
vi.mock('@/components/chat/panel/chat-panel-context', () => ({ useChatPageContext: () => {} }));
vi.mock('@/components/providers/plan-provider', () => ({
  usePlanContext: () => ({ isCloud: true }),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
// The sections themselves have their own tests: here, which of them shows.
vi.mock('./_kpi-cards', () => ({ KpiRows: () => <div>KPI CARDS</div> }));
vi.mock('./_summary-line', () => ({ SummaryLine: () => <p>SUMMARY</p> }));
vi.mock('./_trend-card', () => ({ TrendCard: () => <div>TREND</div> }));
vi.mock('./_leaderboard', () => ({ Leaderboard: () => <div>LEADERBOARD</div> }));
vi.mock('./_platform-table', () => ({ PlatformTable: () => <div>PLATFORMS</div> }));
vi.mock('./_why-changed', () => ({ WhyChanged: () => <div>WHY</div> }));
vi.mock('./_topic-heatmap', () => ({ TopicHeatmap: () => <div>TOPICS</div> }));
vi.mock('./_opportunities', () => ({ Opportunities: () => <div>OPPORTUNITIES</div> }));
vi.mock('./_metric-breakdown-sheet', () => ({ MetricBreakdownSheet: () => null }));
vi.mock('./_formula-dialog', () => ({
  FormulaDialog: () => <button type="button">Formulas</button>,
}));

// The brand store keeps its state in localStorage, which this jsdom lacks.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

const { default: InsightsPage } = await import('./page');
const { useBrandStore } = await import('@/stores/use-brand-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function insights(overrides: Partial<InsightsData> = {}): InsightsData {
  return {
    summary: {
      avgVisibilityScore: 52,
      totalMentions: 214,
      totalCitations: 96,
      positiveSentimentPct: 71,
      totalResults: 120,
      lastCheckedAt: '2026-11-04T08:00:00.000Z',
      platformBreakdown: [],
      visibilityChange: null,
      mentionsChange: null,
      citationsChange: null,
      prevMentions: null,
      prevCitations: null,
      sentimentChange: null,
      citationRate: null,
      citationRateChange: null,
      negativeSentimentPct: null,
    } as unknown as InsightsData['summary'],
    competitors: {
      brands: [{ name: 'Brewline' }, { name: 'Crema Club' }],
      providerRows: [],
    } as unknown as InsightsData['competitors'],
    sov: { overallSov: 0, overallSovChange: null, byPlatform: [], trend: [] },
    trackedPrompts: { activeInPeriod: 12, quotaUsed: 12, quotaLimit: 50 },
    filterOptions: { regions: [], models: [] } as unknown as InsightsData['filterOptions'],
    opportunities: null as unknown as InsightsData['opportunities'],
    hasAnyData: true,
    trend: null,
    comparison: null,
    coverage: null,
    kpiSeries: null,
    platformChanges: null,
    platforms: null,
    whyChanged: null,
    trendMarkers: null,
    topicCompetitors: null,
    failedSections: [],
    trackingWindow: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <InsightsPage />
      </NextIntlClientProvider>,
    );
  });
}

const retryButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry');

beforeEach(() => {
  actions.getInsightsData.mockReset();
  actions.getTopics.mockClear();
  window.history.replaceState(null, '', '/dashboard/insights');
  useBrandStore.setState({
    brands: [{ id: 'b1', name: 'Brewline Coffee', slug: 'brewline', domains: [] } as never],
    activeBrandId: 'b1',
    loaded: true,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

describe('the Overview tab while it loads', () => {
  it('shows its skeleton until the read is back, never an empty state', async () => {
    let answer: (data: InsightsData) => void = () => {};
    actions.getInsightsData.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    await render();
    expect(container.querySelector('[data-testid="overview-skeleton"]')).not.toBeNull();
    expect(container.textContent).not.toContain('No tracking data yet');
    expect(container.textContent).not.toContain('No results');

    await act(async () => answer(insights()));
    expect(container.querySelector('[data-testid="overview-skeleton"]')).toBeNull();
    expect(container.textContent).toContain('KPI CARDS');
  });

  it('sends its own read first, before the filters’ topics', async () => {
    actions.getInsightsData.mockResolvedValue(insights());
    await render();
    expect(actions.getInsightsData).toHaveBeenCalledTimes(1);
    expect(actions.getTopics).toHaveBeenCalledWith('b1');
    expect(actions.getInsightsData.mock.invocationCallOrder[0]).toBeLessThan(
      actions.getTopics.mock.invocationCallOrder[0],
    );
  });

  it('says there is no data only once the read came back with none', async () => {
    actions.getInsightsData.mockResolvedValue(
      insights({
        hasAnyData: false,
        summary: { ...insights().summary, totalResults: 0 },
      }),
    );
    await render();
    expect(container.textContent).toContain('No tracking data yet');
  });
});

describe('a failed read', () => {
  it('says so with Retry, not "No tracking data yet", and Retry reads again', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    actions.getInsightsData.mockRejectedValueOnce(new Error('statement timeout'));
    await render();
    expect(container.textContent).toContain("Couldn't load the overview");
    expect(container.textContent).not.toContain('No tracking data yet');
    expect(container.textContent).not.toContain('KPI CARDS');

    actions.getInsightsData.mockResolvedValueOnce(insights());
    await act(async () => retryButton()!.click());
    expect(actions.getInsightsData).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('KPI CARDS');
    expect(retryButton()).toBeUndefined();
    spy.mockRestore();
  });

  it('of the competitors isn’t shown as "No competitors tracked yet"', async () => {
    actions.getInsightsData.mockResolvedValue(
      insights({
        competitors: { brands: [], providerRows: [] } as unknown as InsightsData['competitors'],
        failedSections: ['competitors', 'platforms'],
      }),
    );
    await render();
    expect(container.textContent).toContain("Couldn't load the competitor comparison");
    expect(container.textContent).not.toContain('No competitors tracked yet');
    // The rest of the tab is there, and says some of it couldn't load.
    expect(container.textContent).toContain('KPI CARDS');
    expect(container.textContent).toContain("Some sections couldn't load");
  });

  it('of the trend isn’t shown as "no trend data"', async () => {
    actions.getInsightsData.mockResolvedValue(insights({ failedSections: ['trend'] }));
    await render();
    expect(container.textContent).toContain("Couldn't load the visibility trend");
    expect(container.textContent).not.toContain('TREND');
    expect(container.textContent).toContain('LEADERBOARD');
  });
});

describe('on the demo brand', () => {
  it('shows the demo’s figures, read like any brand’s', async () => {
    useBrandStore.setState({
      brands: [
        {
          id: 'demo',
          name: 'Brewline Coffee',
          slug: 'brewline',
          domains: [],
          isDemo: true,
        } as never,
      ],
      activeBrandId: 'demo',
    });
    actions.getInsightsData.mockResolvedValue(insights());
    await render();
    expect(actions.getInsightsData).toHaveBeenCalledWith('demo', expect.anything());
    expect(container.textContent).toContain('KPI CARDS');
    expect(container.textContent).not.toContain('No tracking data yet');
  });
});
