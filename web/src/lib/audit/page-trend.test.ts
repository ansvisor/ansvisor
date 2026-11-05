// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  PAGE_AUDITS_SLICE,
  readEarlierPageAudits,
  readPageComparison,
  readScoreRange,
  type PageAuditRow,
  type RangedAuditRow,
} from './page-trend';

/**
 * The page's earlier audits read on the web side for the score's range
 * (Chat's and MCP's get_site_audit, the Reports' Site Audit section): the
 * same audits as GET /api/audits/:id's pageTrend, the same page as the Pages
 * list groups it.
 */

type Call = { filters: [string, string, unknown][]; range: [number, number] | null };

/**
 * A client whose site_audits read answers `rows` (the brand's complete
 * audits before the audit, newest first) a range at a time, and keeps what
 * each read asked for.
 */
function fakeClient(rows: PageAuditRow[], error: { message: string } | null = null) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { filters: [], range: null };
    calls.push(call);
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => (call.filters.push(['eq', column, value]), chain),
      not: (column: string, op: string, value: unknown) => (
        call.filters.push(['not', `${column} ${op}`, value]),
        chain
      ),
      lt: (column: string, value: unknown) => (call.filters.push(['lt', column, value]), chain),
      order: () => chain,
      range: async (start: number, end: number) => {
        call.range = [start, end];
        expect(table).toBe('site_audits');
        return { data: error ? null : rows.slice(start, end + 1), error };
      },
    };
    return chain;
  };
  return { client: { from } as never, calls };
}

const row = (url: string, score: number, day: number, finalUrl: string | null = null) => ({
  url,
  final_url: finalUrl,
  total_score: score,
  created_at: `2026-10-${String(day).padStart(2, '0')}T09:00:00Z`,
});

const AUDIT = {
  brand_id: 'b1',
  status: 'completed',
  partial: false,
  ...row('https://shop.com/bags', 0.64, 30),
} satisfies RangedAuditRow;

describe('readEarlierPageAudits', () => {
  it("reads the brand's complete audits before the audit, and keeps the page's, nearest first", async () => {
    const { client, calls } = fakeClient([
      row('https://shop.com/shoes', 0.9, 29),
      row('https://www.shop.com/bags/', 0.62, 28),
      row('https://shop.com/old', 0.5, 27, 'https://shop.com/bags'),
      row('https://shop.com/bags?ref=x', 0.66, 26),
    ]);
    const earlier = await readEarlierPageAudits(client, 'b1', AUDIT);
    expect(earlier.map((r) => r.total_score)).toEqual([0.62, 0.5, 0.66]);
    expect(calls[0].filters).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['eq', 'status', 'completed'],
      ['eq', 'partial', false],
      ['not', 'total_score is', null],
      ['lt', 'created_at', AUDIT.created_at],
    ]);
  });

  it('stops once it has the audits the range reads besides this one', async () => {
    const { client, calls } = fakeClient(
      Array.from({ length: 10 }, (_, i) => row('https://shop.com/bags', 0.6, 20 - i)),
    );
    expect(await readEarlierPageAudits(client, 'b1', AUDIT)).toHaveLength(4);
    expect(calls).toHaveLength(1);
  });

  it("reads on past a slice of other pages' audits to find the page's", async () => {
    const others = Array.from({ length: PAGE_AUDITS_SLICE + 10 }, () =>
      row('https://shop.com/shoes', 0.9, 29),
    );
    const { client, calls } = fakeClient([...others, row('https://shop.com/bags', 0.61, 1)]);
    const earlier = await readEarlierPageAudits(client, 'b1', AUDIT);
    expect(earlier.map((r) => r.total_score)).toEqual([0.61]);
    expect(calls.map((c) => c.range)).toEqual([
      [0, PAGE_AUDITS_SLICE - 1],
      [PAGE_AUDITS_SLICE, 2 * PAGE_AUDITS_SLICE - 1],
    ]);
  });

  it('throws when the read fails', async () => {
    const { client } = fakeClient([], { message: 'boom' });
    await expect(readEarlierPageAudits(client, 'b1', AUDIT)).rejects.toThrow('boom');
  });
});

describe('readScoreRange', () => {
  it("works out the range from the page's last five complete audits, this one included", async () => {
    const { client } = fakeClient([
      row('https://shop.com/bags', 0.63, 28),
      row('https://shop.com/shoes', 0.2, 27),
      row('https://shop.com/bags', 0.66, 26),
      row('https://shop.com/bags', 0.62, 25),
      row('https://shop.com/bags', 0.65, 24),
      // The sixth back: out of the window.
      row('https://shop.com/bags', 0.3, 23),
    ]);
    expect(await readScoreRange(client, AUDIT)).toEqual({
      plusMinus: 2,
      low: 62,
      high: 66,
      audits: 5,
    });
  });

  it('is null with fewer than three audits', async () => {
    const { client } = fakeClient([row('https://shop.com/bags', 0.63, 28)]);
    expect(await readScoreRange(client, AUDIT)).toBeNull();
  });

  it("is null, with no read, for an audit that isn't compared", async () => {
    const { client, calls } = fakeClient([
      row('https://shop.com/bags', 0.63, 28),
      row('https://shop.com/bags', 0.63, 27),
    ]);
    expect(await readScoreRange(client, { ...AUDIT, partial: true })).toBeNull();
    expect(await readScoreRange(client, { ...AUDIT, status: 'running' })).toBeNull();
    expect(await readScoreRange(client, { ...AUDIT, total_score: null })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('readPageComparison', () => {
  it("gives the page's audit before this one with the range, from the same read", async () => {
    const { client, calls } = fakeClient([
      row('https://shop.com/shoes', 0.2, 29),
      row('https://www.shop.com/bags/', 0.61, 21),
      row('https://shop.com/bags', 0.66, 20),
    ]);
    expect(await readPageComparison(client, AUDIT)).toEqual({
      range: { plusMinus: 3, low: 61, high: 66, audits: 3 },
      // The report's "+3 since Oct 21" counts from it.
      previous: { score: 0.61, createdAt: '2026-10-21T09:00:00Z' },
    });
    expect(calls).toHaveLength(1);
  });

  it('has no previous audit for a page audited once', async () => {
    const { client } = fakeClient([row('https://shop.com/shoes', 0.2, 29)]);
    expect(await readPageComparison(client, AUDIT)).toEqual({ range: null, previous: null });
  });

  it("has neither, with no read, for an audit that isn't compared", async () => {
    const { client, calls } = fakeClient([row('https://shop.com/bags', 0.63, 28)]);
    expect(await readPageComparison(client, { ...AUDIT, partial: true })).toEqual({
      range: null,
      previous: null,
    });
    expect(calls).toHaveLength(0);
  });
});
