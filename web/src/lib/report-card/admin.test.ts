import { describe, expect, it, vi } from 'vitest';
import {
  DAYS_SHOWN,
  adminLimits,
  loadReportCardStats,
  summarizeReportCards,
  type CardRow,
  type RequestRow,
} from './admin';

const NOW = new Date('2026-11-03T15:00:00Z');

const card = (patch: Partial<CardRow>): CardRow => ({
  site: 'acme.example',
  status: 'ready',
  cost_usd: '0.3100',
  created_at: '2026-11-03T09:00:00Z',
  started_at: '2026-11-03T09:01:00Z',
  finished_at: '2026-11-03T09:09:00Z',
  error: null,
  ...patch,
});

const request = (patch: Partial<RequestRow>): RequestRow => ({
  created_at: '2026-11-03T09:00:00Z',
  outcome: 'queued',
  email_status: 'sent',
  consent_marketing: false,
  ...patch,
});

describe('summarizeReportCards', () => {
  const stats = summarizeReportCards({
    now: NOW,
    budgetUsd: 200,
    dailyCap: 200,
    cards: [
      card({}),
      card({
        site: 'other.example',
        status: 'failed',
        cost_usd: 0.05,
        error: 'No engine answered',
      }),
      card({ status: 'queued', started_at: null, finished_at: null, cost_usd: 0 }),
      card({
        created_at: '2026-11-02T09:00:00Z',
        started_at: '2026-11-02T09:00:00Z',
        finished_at: '2026-11-02T09:08:00Z',
        cost_usd: 0.29,
      }),
      card({
        created_at: '2026-10-30T09:00:00Z',
        started_at: '2026-10-30T09:00:00Z',
        finished_at: '2026-10-30T09:08:00Z',
        cost_usd: 0.4,
      }),
    ],
    requests: [
      request({}),
      request({ outcome: 'resent', consent_marketing: true }),
      request({ outcome: 'daily_cap', email_status: null }),
      request({ email_status: 'refused' }),
      request({ created_at: '2026-11-02T10:00:00Z' }),
    ],
  });

  it('counts today: requests, cards started of the cap, sent again and for tomorrow', () => {
    expect(stats.today).toEqual({
      date: '2026-11-03',
      requests: 4,
      resent: 1,
      capped: 1,
      started: 2,
      ready: 1,
      failed: 1,
      costUsd: 0.36,
      emailsSent: 2,
      emailsFailed: 1,
    });
    expect(stats.dailyCap).toBe(200);
  });

  it('adds up the month’s cost against the budget, not last month’s', () => {
    expect(stats.month.costUsd).toBeCloseTo(0.31 + 0.05 + 0.29, 6);
    expect(stats.month).toMatchObject({ budgetUsd: 200, cards: 4 });
  });

  it('lists the last 14 days, newest first, with the failed rate and the latest failures', () => {
    expect(stats.days).toHaveLength(DAYS_SHOWN);
    expect(stats.days[1]).toMatchObject({ date: '2026-11-02', requests: 1, started: 1, ready: 1 });
    expect(stats.errorRate).toBe(25);
    expect(stats.queued).toBe(1);
    expect(stats.marketingOptIns).toBe(1);
    expect(stats.failures).toEqual([
      { site: 'other.example', at: '2026-11-03T09:09:00Z', error: 'No engine answered' },
    ]);
  });

  it('has no failed rate before any card finished', () => {
    const none = summarizeReportCards({
      now: NOW,
      budgetUsd: 200,
      dailyCap: 200,
      cards: [],
      requests: [],
    });
    expect(none.errorRate).toBeNull();
    expect(none.today.requests).toBe(0);
  });
});

describe('adminLimits', () => {
  it('reads the server’s caps, 200 and $200 unless set', () => {
    expect(adminLimits({})).toEqual({ dailyCap: 200, budgetUsd: 200 });
    expect(
      adminLimits({ REPORT_CARD_DAILY_CAP: '50', REPORT_CARD_MONTHLY_BUDGET_USD: 'lots' }),
    ).toEqual({ dailyCap: 50, budgetUsd: 200 });
  });
});

describe('loadReportCardStats', () => {
  /** A query that answers its rows a page at a time, as PostgREST does. */
  const fakeDb = (rowsOf: (table: string, waiting: boolean) => unknown[]) => {
    const selects: string[] = [];
    const ranges: [string, number, number][] = [];
    const db = {
      from: vi.fn((table: string) => {
        let waiting = false;
        const query = {
          select: (columns: string) => {
            selects.push(columns);
            return query;
          },
          gte: () => query,
          lt: () => query,
          eq: () => {
            waiting = true;
            return query;
          },
          order: () => query,
          range: async (from: number, to: number) => {
            ranges.push([table, from, to]);
            const rows = rowsOf(table, waiting);
            return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
          },
        };
        return query;
      }),
    };
    return { db, selects, ranges };
  };

  it('reads counts and sites only, never a name or an e-mail', async () => {
    const { db, selects } = fakeDb(() => []);
    await loadReportCardStats(db as never, NOW, {});
    expect(db.from.mock.calls.map(([table]) => table)).toEqual([
      'report_cards',
      'report_card_requests',
      'report_cards',
    ]);
    for (const columns of selects)
      expect(columns).not.toMatch(/email,|first_name|last_name|linkedin/);
  });

  it('reads every row past PostgREST’s 1,000, a page at a time', async () => {
    const cards = Array.from({ length: 2_500 }, (_, i) => ({
      id: `c${String(i).padStart(5, '0')}`,
      site: 'acme.example',
      status: 'ready',
      cost_usd: 0.1,
      created_at: NOW.toISOString(),
      started_at: NOW.toISOString(),
      finished_at: NOW.toISOString(),
      error: null,
    }));
    const { db, ranges } = fakeDb((table, waiting) =>
      table === 'report_cards' && !waiting ? cards : [],
    );
    const stats = await loadReportCardStats(db as never, NOW, {});
    expect(stats.month.cards).toBe(2_500);
    expect(stats.month.costUsd).toBeCloseTo(250);
    expect(ranges).toEqual(
      expect.arrayContaining([
        ['report_cards', 1000, 1999],
        ['report_cards', 2000, 2999],
      ]),
    );
  });
});
