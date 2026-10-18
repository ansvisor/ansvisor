import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { PageOpportunities, PageOpportunity, TrafficDateWindow } from '@/lib/actions/traffic';

/**
 * AT-002: "Pages AI engines aren't sending traffic to" reads the range the
 * page shows, says which range in its badge, and stays put with a note when
 * nothing in that range qualifies.
 */

const getPageOpportunities = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({
  getPageOpportunities: (...args: unknown[]) => getPageOpportunities(...args),
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

const WEEK: TrafficDateWindow = { dateFrom: '2026-10-11T09:00:00.000Z' };
const MONTH: TrafficDateWindow = { dateFrom: '2026-09-18T09:00:00.000Z' };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getPageOpportunities.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(dateWindow: TrafficDateWindow, rangeLabel: string) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PageOpportunitiesCard brandId="b1" dateWindow={dateWindow} rangeLabel={rangeLabel} />
      </NextIntlClientProvider>,
    );
  });
}

const resolveWith = (result: PageOpportunities) => getPageOpportunities.mockResolvedValue(result);

describe('PageOpportunitiesCard', () => {
  it("asks for the page's range and names it in the badge", async () => {
    resolveWith({ pages: 30, rows: [finding()] });
    await render(WEEK, 'last 7 days');

    expect(getPageOpportunities).toHaveBeenCalledWith('b1', WEEK);
    expect(container.textContent).toContain('Google Analytics · last 7 days');
    expect(container.textContent).not.toContain('28 days');
    expect(container.textContent).toContain('in this range');
  });

  it('reads the new range when the page changes it', async () => {
    resolveWith({ pages: 30, rows: [finding()] });
    await render(WEEK, 'last 7 days');
    resolveWith({ pages: 30, rows: [finding({ landingPage: '/demo' })] });
    await render(MONTH, 'last 30 days');

    expect(getPageOpportunities).toHaveBeenLastCalledWith('b1', MONTH);
    expect(container.textContent).toContain('Google Analytics · last 30 days');
    expect(container.textContent).toContain('/demo');
    expect(container.textContent).not.toContain('/pricing');
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
    expect(card!.textContent).toContain('Google Analytics · last 7 days');
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

    const text = container.textContent ?? '';
    expect(text).toContain('Ranked by the conversions Analytics records on these pages.');
    expect(text).toContain('Conversions');
    expect(text).toContain('Rank by conversions');
    expect(text).toContain('Not cited');
    expect(text).toContain('1 prompt targets this page');
    expect(text).toContain('3 citations in answers');
  });

  it('says nothing qualifies when Analytics has data for the range', async () => {
    resolveWith({ pages: 30, rows: [] });
    await render(WEEK, 'last 24 hours');

    expect(container.textContent).toContain('Google Analytics · last 24 hours');
    expect(container.textContent).toContain(
      'No high-value pages without AI traffic in this range.',
    );
    expect(container.querySelector('table')).toBeNull();
  });

  it('renders nothing when Analytics has no data for the range', async () => {
    resolveWith({ pages: 0, rows: [] });
    await render(WEEK, 'last 7 days');
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the read fails, and leaves the page alone', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getPageOpportunities.mockRejectedValue(new Error('Server error: 500'));
    await render(WEEK, 'last 7 days');
    expect(container.innerHTML).toBe('');
    error.mockRestore();
  });
});
