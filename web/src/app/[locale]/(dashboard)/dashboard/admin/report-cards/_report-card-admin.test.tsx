import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import { summarizeReportCards } from '@/lib/report-card/admin';
import { ReportCardAdmin } from './_report-card-admin';

/** The staff's view of the free report cards: the day, the month's budget, failures. */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const NOW = new Date('2026-11-03T15:00:00Z');

function draw(stats: ReturnType<typeof summarizeReportCards>) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ReportCardAdmin stats={stats} />
      </NextIntlClientProvider>,
    ),
  );
  return container.textContent ?? '';
}

describe('ReportCardAdmin', () => {
  it('shows today against the cap, the month against the budget, and the failures', () => {
    const text = draw(
      summarizeReportCards({
        now: NOW,
        budgetUsd: 200,
        dailyCap: 200,
        cards: [
          {
            site: 'acme.example',
            status: 'failed',
            cost_usd: 0.12,
            created_at: '2026-11-03T09:00:00Z',
            started_at: '2026-11-03T09:00:00Z',
            finished_at: '2026-11-03T09:05:00Z',
            error: 'No engine answered',
          },
        ],
        requests: [
          {
            created_at: '2026-11-03T09:00:00Z',
            outcome: 'queued',
            email_status: 'sent',
            consent_marketing: true,
          },
        ],
      }),
    );
    expect(text).toContain('Free report cards');
    expect(text).toContain('1 of 200 cards');
    expect(text).toContain('1 request · 0 sent again · 0 for tomorrow');
    expect(text).toContain('$0.12 of $200.00');
    expect(text).toContain('100%');
    expect(text).toContain('2026-11-03');
    expect(text).toContain('acme.example');
    expect(text).toContain('No engine answered');
  });

  it('says so when nothing finished and nothing failed', () => {
    const text = draw(
      summarizeReportCards({ now: NOW, budgetUsd: 200, dailyCap: 200, cards: [], requests: [] }),
    );
    expect(text).toContain('None finished yet');
    expect(text).toContain('No card has failed.');
  });
});
