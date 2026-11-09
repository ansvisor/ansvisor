import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { reportCardStore } = await import('./store.js');

/**
 * A report_cards table behind PostgREST: at most 1000 rows a response,
 * whatever `limit` or `range` asks for.
 */
function fakeDb(rows) {
  const MAX_ROWS = 1000;
  return {
    from: () => {
      let from = 0;
      let to = Infinity;
      let limit = Infinity;
      const query = {
        select: () => query,
        gte: () => query,
        order: () => query,
        limit: (n) => {
          limit = n;
          return query;
        },
        range: (a, b) => {
          from = a;
          to = b;
          return query;
        },
        then: (resolve) => {
          const end = Math.min(to + 1, from + limit, from + MAX_ROWS);
          resolve({ data: rows.slice(from, end), error: null });
        },
      };
      return query;
    },
  };
}

describe('reportCardStore.spendSince', () => {
  it('sums every card of the month, past PostgREST’s 1000-row cap', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      id: `card-${String(i).padStart(5, '0')}`,
      cost_usd: i < 2000 ? '0.1' : null,
      status: i < 2000 ? 'ready' : 'queued',
    }));
    const { spent, pending } = await reportCardStore(fakeDb(rows)).spendSince(
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(spent).toBeCloseTo(200);
    expect(pending).toBe(500);
  });

  it('throws when a page fails', async () => {
    const db = {
      from: () => {
        const query = {
          select: () => query,
          gte: () => query,
          order: () => query,
          range: () => query,
          then: (resolve) => resolve({ data: null, error: { message: 'boom' } }),
        };
        return query;
      },
    };
    await expect(reportCardStore(db).spendSince(new Date())).rejects.toThrow(
      'report card spend: boom',
    );
  });
});

describe('reportCardStore, the request’s report language', () => {
  /** A table that records what was asked of it and answers `rows`. */
  function recordingDb(rows = []) {
    const calls = [];
    const query = new Proxy(
      {},
      {
        get: (_, name) =>
          name === 'then'
            ? (resolve) => resolve({ data: rows, error: null })
            : (...args) => {
                calls.push([name, ...args]);
                return query;
              },
      },
    );
    return { calls, db: { from: (table) => (calls.push(['from', table]), query) } };
  }

  it('keeps the language the form chose on the request', async () => {
    const { calls, db } = recordingDb({ id: 'req-1' });
    const row = { email: 'ayse@acme.example', report_language: 'fr', outcome: 'queued' };
    await reportCardStore(db).insertRequest(row);
    expect(calls).toContainEqual(['from', 'report_card_requests']);
    expect(calls).toContainEqual(['insert', row]);
  });

  it('reads it with the e-mails waiting, so each goes out in its own language', async () => {
    const { calls, db } = recordingDb([{ id: 'req-1', report_language: 'de' }]);
    expect(await reportCardStore(db).undeliveredRequests(20)).toEqual([
      { id: 'req-1', report_language: 'de' },
    ]);
    const select = calls.find(([name]) => name === 'select')[1];
    expect(select).toMatch(/\breport_language\b/);
    expect(select).toMatch(/\bcountry\b/);
  });
});
