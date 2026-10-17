import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { InsightsSummary, TrackedPromptsKpi } from '@/lib/actions/tracking';
import { KpiRows } from './_kpi-cards';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

// Only what the cards read; the rest of the summary doesn't matter here.
const summary = (over: Partial<InsightsSummary> = {}) =>
  ({
    totalResults: 120,
    mentioningResults: 80,
    positionedResults: 60,
    totalMentions: 340,
    mentionsChange: 12,
    totalCitations: 90,
    citationsChange: -4,
    netSentiment: null,
    netSentimentChange: null,
    positiveSentimentPct: null,
    negativeSentimentPct: null,
    avgPosition: null,
    avgPositionChange: null,
    citationRate: null,
    citationRateChange: null,
    ...over,
  }) as unknown as InsightsSummary;

let container: HTMLDivElement;
let root: Root;

function render(trackedPrompts: TrackedPromptsKpi, over: Partial<InsightsSummary> = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <KpiRows
          summary={summary(over)}
          trend={null}
          trackedPrompts={trackedPrompts}
          coverage={null}
          sov={null}
          competitors={null}
          comparison={null}
          series={null}
          onBreakdown={vi.fn()}
          onNavigate={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
  });
}

const plan = (quotaUsed: number, quotaLimit: number): TrackedPromptsKpi => ({
  activeInPeriod: 7,
  quotaUsed,
  quotaLimit,
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the Tracked prompts card', () => {
  it('says how many more prompts or locations the plan can take', () => {
    render(plan(47, 50));
    expect(container.textContent).toContain('3 prompts/locations left to add');
    expect(container.textContent).not.toContain('all brands');
  });

  it('formats a large count', () => {
    render(plan(250, 1500));
    expect(container.textContent).toContain('1,250 prompts/locations left to add');
  });

  it('says the limit is reached when the plan is full', () => {
    render(plan(50, 50));
    expect(container.textContent).toContain('Plan limit reached');
  });

  it('says how far over the limit an account is after a downgrade', () => {
    render(plan(52, 50));
    expect(container.textContent).toContain('2 over your plan limit');
  });
});

describe('the Mentions and Citations cards', () => {
  it('say their change is against the previous period', () => {
    render(plan(47, 50));
    expect(container.textContent?.match(/vs previous period/g)).toHaveLength(2);
    expect(container.textContent).not.toMatch(/same \d+ prompts?/);
  });

  it('say nothing of a change they do not have', () => {
    render(plan(47, 50), { mentionsChange: null, citationsChange: null });
    expect(container.textContent).not.toContain('vs previous period');
  });
});
