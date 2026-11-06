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
 * whose own read failed isn't shown as "none". Its reads go out side by
 * side, and opened again it shows what it read at once.
 */

const actions = vi.hoisted(() => ({
  getInsightsData: vi.fn(),
  getBrandFilterOptions: vi.fn(async () => ({ regions: [], models: [] })),
  getInsightsOpportunities: vi.fn(async () => ({
    suggestions: [],
    trackedTopicIds: [],
    contentUsage: null,
  })),
  exportPromptResults: vi.fn(),
  getTopics: vi.fn(async () => []),
}));
vi.mock('@/lib/visibility-reads', () => ({
  getInsightsData: actions.getInsightsData,
  getBrandFilterOptions: actions.getBrandFilterOptions,
  getInsightsOpportunities: actions.getInsightsOpportunities,
  getTopics: actions.getTopics,
}));
vi.mock('@/lib/actions/tracking', () => ({ exportPromptResults: actions.exportPromptResults }));
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
const { BrandVisibilityShellContext } = await import('@/components/brand-visibility/shell-context');
const { createReadCache } = await import('@/components/brand-visibility/read-cache');
type Shell = import('@/components/brand-visibility/shell-context').BrandVisibilityShell;

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

/** Visibility's shared layout, as far as the tab sees it: here, what it keeps. */
function shellWith(over: Partial<Shell> = {}): Shell {
  return {
    actionsSlot: undefined,
    refreshes: 0,
    isRunning: false,
    reportRunWindow: () => {},
    reportData: () => {},
    cache: createReadCache(),
    shown: () => {},
    ...over,
  };
}

async function render(shell?: Shell) {
  const page = (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <InsightsPage />
    </NextIntlClientProvider>
  );
  await act(async () => {
    root.render(
      shell ? (
        <BrandVisibilityShellContext.Provider value={shell}>
          {page}
        </BrandVisibilityShellContext.Provider>
      ) : (
        page
      ),
    );
  });
}

/** The tab closed and opened again, under the same layout. */
async function reopen(shell: Shell) {
  act(() => root.unmount());
  root = createRoot(container);
  await render(shell);
}

const retryButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry');

beforeEach(() => {
  actions.getInsightsData.mockReset();
  actions.getTopics.mockClear();
  actions.getBrandFilterOptions.mockClear();
  actions.getInsightsOpportunities.mockClear();
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

  it('sends its reads side by side: the figures, the filters’ choices and topics, the Opportunities card', async () => {
    // None of them answers: every read is out before any is back.
    actions.getInsightsData.mockReturnValue(new Promise(() => {}));
    actions.getBrandFilterOptions.mockReturnValueOnce(new Promise(() => {}));
    actions.getTopics.mockReturnValueOnce(new Promise(() => {}));
    actions.getInsightsOpportunities.mockReturnValueOnce(new Promise(() => {}));
    await render();
    expect(actions.getInsightsData).toHaveBeenCalledTimes(1);
    expect(actions.getBrandFilterOptions).toHaveBeenCalledWith('b1');
    expect(actions.getTopics).toHaveBeenCalledWith('b1');
    expect(actions.getInsightsOpportunities).toHaveBeenCalledWith('b1');
    // The figures' read asks for neither the choices nor the card: they don't depend on the window.
    expect(actions.getInsightsData.mock.calls[0][1]).toMatchObject({ anchor24h: true });
  });

  it('shows the Opportunities card from its own read', async () => {
    actions.getInsightsData.mockResolvedValue(insights());
    await render();
    expect(container.textContent).toContain('OPPORTUNITIES');
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

describe('opened again under the same layout', () => {
  it('shows the figures it read at once, reads them again quietly, and tells the layout', async () => {
    const shown = vi.fn();
    const shell = shellWith({ shown });
    actions.getInsightsData.mockResolvedValueOnce(insights());
    await render(shell);
    expect(container.textContent).toContain('KPI CARDS');
    expect(shown).toHaveBeenCalled();

    // Back on the tab: the figures before the read is back, no skeleton, no overlay.
    let answer: (data: InsightsData) => void = () => {};
    actions.getInsightsData.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await reopen(shell);
    expect(container.querySelector('[data-testid="overview-skeleton"]')).toBeNull();
    expect(container.textContent).toContain('KPI CARDS');
    expect(container.querySelector('.opacity-60')).toBeNull();
    expect(actions.getInsightsData).toHaveBeenCalledTimes(2);

    await act(async () => answer(insights({ failedSections: ['trend'] })));
    expect(container.textContent).toContain("Couldn't load the visibility trend");
  });

  it('keeps the figures when the quiet read fails', async () => {
    const shell = shellWith();
    actions.getInsightsData.mockResolvedValueOnce(insights());
    await render(shell);
    actions.getInsightsData.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await reopen(shell);
    expect(container.textContent).toContain('KPI CARDS');
    expect(container.textContent).not.toContain("Couldn't load the overview");
    warn.mockRestore();
  });

  it('doesn’t show another brand’s figures', async () => {
    const shell = shellWith();
    actions.getInsightsData.mockResolvedValueOnce(insights());
    await render(shell);
    act(() => root.unmount());
    root = createRoot(container);
    useBrandStore.setState({
      brands: [{ id: 'b2', name: 'Crema Club', slug: 'crema', domains: [] } as never],
      activeBrandId: 'b2',
    });
    actions.getInsightsData.mockReturnValueOnce(new Promise(() => {}));
    await render(shell);
    expect(container.querySelector('[data-testid="overview-skeleton"]')).not.toBeNull();
    expect(actions.getInsightsData).toHaveBeenLastCalledWith('b2', expect.anything());
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
