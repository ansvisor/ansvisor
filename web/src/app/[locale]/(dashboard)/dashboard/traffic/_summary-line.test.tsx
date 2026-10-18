import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { TrafficDateWindow, TrafficSummary } from '@/lib/actions/traffic';

/**
 * The summary line (AT-007, spec §3.1): fixed sentences from the page's
 * aggregates, only with facts from connected sources, and nothing until
 * every number it states has loaded.
 */

const getTrafficPages = vi.fn();
vi.mock('@/lib/actions/traffic', () => ({
  getTrafficPages: (...args: unknown[]) => getTrafficPages(...args),
}));

const { SummaryLine } = await import('./_summary-line');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const WEEK: TrafficDateWindow = { dateFrom: '2026-10-11T09:00:00.000Z' };
const ga = (sessions: number, keyEvents: number, keyEventSessions = keyEvents) => ({
  sessions,
  engagedSessions: sessions,
  keyEvents,
  keyEventSessions,
});

const summary = (over: Partial<TrafficSummary> = {}): TrafficSummary => ({
  totalVisits: 64,
  totalVisitsPrev: 57,
  totalPageviews: 80,
  analyticsDays: [],
  hasPreviousPeriod: true,
  hasAnyData: true,
  topPages: [],
  platformBreakdown: [
    { platform: 'chatgpt.com', visits: 38, visitsPrev: 30, analytics: ga(40, 5, 4) },
    { platform: 'perplexity.ai', visits: 20, visitsPrev: 20, analytics: ga(31, 6, 5) },
  ],
  ...over,
});

const cited = (count: number) => ({
  counts: { noAiTraffic: 0, citedNotClicked: count, trafficNoPrompt: 0, all: 0 },
  rows: [],
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getTrafficPages.mockReset().mockResolvedValue(cited(2));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render({
  sum = summary(),
  // 'loading' stands for undefined, which a default would swallow.
  gaSessions = 8000 as number | null | 'loading',
  summaryLoading = false,
} = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SummaryLine
          brandId="b1"
          dateWindow={WEEK}
          rangeLabel="last 7 days"
          summary={sum}
          summaryLoading={summaryLoading}
          gaSessions={gaSessions === 'loading' ? undefined : gaSessions}
        />
      </NextIntlClientProvider>,
    );
  });
}

const text = () => container.textContent ?? '';

describe('SummaryLine', () => {
  it('says the range in one or two sentences, with Analytics connected', async () => {
    await render();
    expect(getTrafficPages).toHaveBeenCalledWith('b1', WEEK, { tab: 'citedNotClicked', limit: 0 });
    expect(text()).toBe(
      'Last 7 days: 64 AI-referred visits, 0.8% of all traffic, up 12% on the previous period. ' +
        'ChatGPT sent the most (38); Perplexity visitors convert best (16.1% of their visits had a key event). ' +
        '2 pages are cited in AI answers but get no clicks.',
    );
  });

  it('states nothing from Analytics without it (§3.8b rule 5)', async () => {
    getTrafficPages.mockResolvedValue(cited(0));
    await render({ gaSessions: null });
    expect(text()).toBe(
      'Last 7 days: 64 AI-referred visits, up 12% on the previous period. ChatGPT sent the most (38).',
    );
  });

  it('joins the top and best platform when they are the same', async () => {
    await render({
      sum: summary({
        platformBreakdown: [
          { platform: 'chatgpt.com', visits: 38, visitsPrev: 30, analytics: ga(40, 9, 8) },
          { platform: 'perplexity.ai', visits: 20, visitsPrev: 20, analytics: ga(31, 6, 5) },
        ],
      }),
    });
    expect(text()).toContain(
      'ChatGPT sent the most (38), and its visitors convert best (20% of their visits had a key event).',
    );
  });

  it('says when there were no visits, and leaves out a change below 30 visits', async () => {
    getTrafficPages.mockResolvedValue(cited(1));
    await render({
      sum: summary({ totalVisits: 0, totalVisitsPrev: 0, platformBreakdown: [] }),
    });
    expect(text()).toBe(
      'Last 7 days: no AI-referred visits yet. 1 page is cited in AI answers but gets no clicks.',
    );

    await render({ sum: summary({ totalVisits: 12, totalVisitsPrev: 9 }), gaSessions: null });
    expect(text()).not.toContain('previous period');
  });

  it('waits for Analytics and the summary rather than changing under the reader', async () => {
    await render({ gaSessions: 'loading' });
    expect(text()).toBe('');
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();

    await render({ summaryLoading: true });
    expect(text()).toBe('');
  });
});
