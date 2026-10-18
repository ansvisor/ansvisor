import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PageOpportunities, PageOpportunity, TrafficDateWindow } from '@/lib/actions/traffic';
import type { SourceState } from '@/lib/actions/integrations';

/**
 * "Pages AI engines aren't sending traffic to" reads the range the page
 * shows and names it (AT-002), says it needs Google Analytics, and shows
 * Analytics' own state until there is data from it (AT-016).
 */

const getPageOpportunities = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({
  getPageOpportunities: (...args: unknown[]) => getPageOpportunities(...args),
}));
vi.mock('@/hooks/use-integration-connect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { PageOpportunitiesCard } = await import('./_opportunities-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const finding = (over: Partial<PageOpportunity> = {}): PageOpportunity => ({
  landingPage: '/pricing',
  valueSignal: 'key_events',
  valuePercentile: 95,
  valueRank: 1,
  sessions: 1200,
  engagedSessions: 800,
  keyEvents: 40,
  transactions: 0,
  revenue: 0,
  engagementSeconds: 0,
  citationState: 'targeted_not_cited',
  citations: 0,
  citingPrompts: 0,
  targetingPrompts: 1,
  ...over,
});

const ga = (over: Partial<SourceState> = {}): SourceState => ({
  configured: true,
  connected: true,
  mapped: true,
  firstDataAt: '2026-09-01T06:00:00.000Z',
  lastDataAt: '2026-10-18T06:00:00.000Z',
  property: '123456789',
  ...over,
});

const WEEK: TrafficDateWindow = { dateFrom: '2026-10-11T09:00:00.000Z' };
const MONTH: TrafficDateWindow = { dateFrom: '2026-09-18T09:00:00.000Z' };

let container: HTMLDivElement;
let root: Root;
const onShowAllTime = vi.fn();

beforeEach(() => {
  getPageOpportunities.mockReset();
  onShowAllTime.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(
  dateWindow: TrafficDateWindow,
  rangeLabel: string,
  {
    source = ga(),
    sourceUnknown = false,
    showAll = true,
  }: { source?: SourceState | null; sourceUnknown?: boolean; showAll?: boolean } = {},
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PageOpportunitiesCard
          brandId="b1"
          dateWindow={dateWindow}
          rangeLabel={rangeLabel}
          source={source}
          sourceUnknown={sourceUnknown}
          domain="acme.example"
          canConnect
          onConnected={() => {}}
          onShowAllTime={showAll ? onShowAllTime : undefined}
        />
      </NextIntlClientProvider>,
    );
  });
}

const resolveWith = (result: PageOpportunities) => getPageOpportunities.mockResolvedValue(result);
const text = () => container.textContent ?? '';

describe('PageOpportunitiesCard', () => {
  it("asks for the page's range, names it, and says it needs Google Analytics", async () => {
    resolveWith({ pages: 30, rows: [finding()] });
    await render(WEEK, 'last 7 days');

    expect(getPageOpportunities).toHaveBeenCalledWith('b1', WEEK);
    expect(text()).toContain('Needs Google Analytics');
    expect(text()).toContain('last 7 days');
    expect(text()).not.toContain('28 days');
    expect(text()).toContain('in this range');
  });

  it('reads the new range when the page changes it', async () => {
    resolveWith({ pages: 30, rows: [finding()] });
    await render(WEEK, 'last 7 days');
    resolveWith({ pages: 30, rows: [finding({ landingPage: '/demo' })] });
    await render(MONTH, 'last 30 days');

    expect(getPageOpportunities).toHaveBeenLastCalledWith('b1', MONTH);
    expect(text()).toContain('last 30 days');
    expect(text()).toContain('/demo');
    expect(text()).not.toContain('/pricing');
  });

  it('keeps the previous range on screen, faded, while the new one loads', async () => {
    resolveWith({ pages: 30, rows: [finding()] });
    await render(WEEK, 'last 7 days');
    getPageOpportunities.mockReturnValue(new Promise(() => {}));
    await render(MONTH, 'last 30 days');

    const card = container.querySelector('[aria-busy="true"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('/pricing');
    // The faded rows still name the range they were ranked for.
    expect(card!.textContent).toContain('last 7 days');
    expect(card!.textContent).not.toContain('last 30 days');
  });

  it('shows the ranking signal and why each page gets nothing from AI', async () => {
    resolveWith({
      pages: 30,
      rows: [
        finding(),
        finding({ landingPage: '/guide', citationState: 'cited', citations: 3, valueRank: 2 }),
      ],
    });
    await render(WEEK, 'last 7 days');

    expect(text()).toContain('Ranked by the conversions Analytics records on these pages.');
    expect(text()).toContain('Conversions');
    expect(text()).toContain('Rank by conversions');
    expect(text()).toContain('Not cited');
    expect(text()).toContain('1 prompt targets this page');
    expect(text()).toContain('3 citations in answers');
  });

  it('says nothing qualifies when Analytics has data for the range', async () => {
    resolveWith({ pages: 30, rows: [] });
    await render(WEEK, 'last 24 hours');

    expect(text()).toContain('No high-value pages without AI traffic in this range.');
    expect(container.querySelector('table')).toBeNull();
  });

  it('says Analytics has no data for the range, with a way to widen it', async () => {
    resolveWith({ pages: 0, rows: [] });
    await render(WEEK, 'last 7 days');

    expect(text()).toContain('No data for this range in Google Analytics');
    const showAll = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Show all time',
    );
    await act(async () => showAll!.click());
    expect(onShowAllTime).toHaveBeenCalled();
  });

  it('offers no wider range when it already shows all time', async () => {
    resolveWith({ pages: 0, rows: [] });
    await render({}, 'all time', { showAll: false });
    expect(text()).toContain('No data for this range in Google Analytics');
    expect(text()).not.toContain('Show all time');
  });

  it("shows Analytics' state, and reads nothing, until Analytics has data", async () => {
    await render(WEEK, 'last 7 days', { source: ga({ connected: false, mapped: false }) });
    expect(text()).toContain('Needs Google Analytics');
    expect(text()).toContain('Connect Google Analytics to see this');

    await render(WEEK, 'last 7 days', { source: ga({ lastDataAt: null }) });
    expect(text()).toContain('Importing your Google Analytics data');

    await render(WEEK, 'last 7 days', { source: ga({ mapped: false }) });
    expect(text()).toContain('Choose a property for this brand');

    expect(getPageOpportunities).not.toHaveBeenCalled();
    // The range belongs to the data, so it shows only with data.
    expect(text()).not.toContain('last 7 days');
  });

  it('waits for the state before showing anything', async () => {
    await render(WEEK, 'last 7 days', { source: null });
    expect(container.innerHTML).toBe('');
    expect(getPageOpportunities).not.toHaveBeenCalled();
  });

  it('reads the range anyway when the state could not be read', async () => {
    resolveWith({ pages: 30, rows: [finding()] });
    await render(WEEK, 'last 7 days', { source: null, sourceUnknown: true });
    expect(getPageOpportunities).toHaveBeenCalledWith('b1', WEEK);
    expect(text()).toContain('/pricing');
  });

  it('hides itself when the read fails, rather than claim there is no data', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getPageOpportunities.mockRejectedValue(new Error('Server error: 500'));
    await render(WEEK, 'last 7 days');
    expect(container.innerHTML).toBe('');
    error.mockRestore();
  });
});
