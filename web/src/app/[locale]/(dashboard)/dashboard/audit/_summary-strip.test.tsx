import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditAutoStatus, AuditOverview, AuditQuota } from '@/lib/actions/audits';
import { AuditSummaryStrip, daysUntil } from './_summary-strip';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 27, 15, 0);

const overview = (over: Partial<AuditOverview> = {}): AuditOverview => ({
  primaryHost: 'ansvisor.com',
  pages: 48,
  otherPages: 0,
  siteScore: 0.68,
  siteScoreChange: 4,
  authority: 0.38,
  eeat: 0.36,
  lowestCategory: { key: 'eeat', score: 0.36 },
  gaps: [],
  ...over,
});

const auto = (over: Partial<AuditAutoStatus> = {}): AuditAutoStatus => ({
  enabled: true,
  setting: null,
  emailAfterRun: false,
  perRun: 25,
  reserved: 25,
  used: 100,
  running: 0,
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  runs: [],
  nextRun: { day: 28, at: new Date(2026, 9, 28, 0, 0).toISOString() },
  ...over,
});

const quota = (a: AuditAutoStatus | undefined): AuditQuota => ({
  used: 250,
  running: 0,
  limit: 500,
  remaining: 225,
  auto: a,
});

let container: HTMLDivElement;
let root: Root;

function render(data: AuditOverview | null, q: AuditQuota | null) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AuditSummaryStrip overview={data} quota={q} now={NOW} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const items = () =>
  [...container.querySelectorAll('div > span.whitespace-nowrap')].map((s) => s.textContent);

describe('daysUntil', () => {
  it('counts calendar days, whatever the hour', () => {
    expect(daysUntil(new Date(2026, 9, 27, 23, 0).toISOString(), NOW)).toBe(0);
    expect(daysUntil(new Date(2026, 9, 28, 0, 30).toISOString(), NOW)).toBe(1);
    expect(daysUntil(new Date(2026, 10, 3).toISOString(), NOW)).toBe(7);
  });
});

describe('AuditSummaryStrip', () => {
  it('reads as the mockup: score and change, pages, lowest category, next run, domain', () => {
    render(overview(), quota(auto()));
    expect(items()).toEqual([
      '68 site score+4',
      '48 pages audited',
      'Lowest: E-E-A-T 36',
      'Next auto-audit tomorrow · 25 pages',
    ]);
    expect(container.textContent).toContain('ansvisor.com');
  });

  it('says today, or the date further out, and when auto-audit is off', () => {
    render(overview(), quota(auto({ nextRun: { day: 21, at: NOW.toISOString() } })));
    expect(items()[3]).toBe('Next auto-audit today · 25 pages');
    render(
      overview(),
      quota(auto({ nextRun: { day: 1, at: new Date(2026, 10, 1, 0, 0).toISOString() } })),
    );
    expect(items()[3]).toBe('Next auto-audit on Nov 1 · 25 pages');
    render(overview(), quota(auto({ enabled: false })));
    expect(items()[3]).toBe('Auto-audit off');
  });

  it('leaves out what it has no data for', () => {
    render(
      overview({
        pages: 0,
        siteScore: null,
        siteScoreChange: null,
        lowestCategory: null,
        primaryHost: null,
      }),
      quota(undefined),
    );
    expect(items()).toEqual(['No pages audited yet']);
    render(null, quota(auto()));
    expect(container.textContent).toBe('');
  });
});
