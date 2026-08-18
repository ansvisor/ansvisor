import { describe, expect, it, vi } from 'vitest';

// The module pulls in the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

import {
  allTasksAreStale,
  drainBudgetExceeded,
  fetchAllPendingRows,
  runnablePlatforms,
  UNAVAILABLE_PLATFORMS,
} from './tracking-worker.js';

/**
 * Ghost detection for the Cloro drain loop (#687).
 *
 * A run used to burn its entire stall window whenever Cloro accepted a task
 * and never called back — routine for google-aio, which has nothing to return
 * when a query has no AI Overview. Waiting on those tasks is what stretched
 * the nightly cycle and, worse, parked every brand for the same fixed period
 * so their pulses all woke together and overloaded the database.
 *
 * The exit needs BOTH signals: delivery has gone quiet AND nothing plausibly
 * in flight remains. These tests pin the second half.
 */

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 7, 10, 6, 0, 0);
const ago = (minutes) => new Date(NOW - minutes * MINUTE).toISOString();

describe('allTasksAreStale', () => {
  it('is true when every pending task is older than the cutoff', () => {
    const rows = [{ submitted_at: ago(45) }, { submitted_at: ago(90) }];

    expect(allTasksAreStale(rows, 30 * MINUTE, NOW)).toBe(true);
  });

  it('is false while even one task is still young enough to arrive', () => {
    // The mixed case is the dangerous one: exiting here would abandon a task
    // that is merely mid-burst, losing results the run was about to receive.
    const rows = [{ submitted_at: ago(90) }, { submitted_at: ago(5) }];

    expect(allTasksAreStale(rows, 30 * MINUTE, NOW)).toBe(false);
  });

  it('is false for an empty list — a drained queue is not a ghost tail', () => {
    // The caller breaks out on `pending === 0` before consulting this, so
    // reporting "stale" here would conflate success with abandonment.
    expect(allTasksAreStale([], 30 * MINUTE, NOW)).toBe(false);
    expect(allTasksAreStale(null, 30 * MINUTE, NOW)).toBe(false);
  });

  it('treats a task exactly at the cutoff as still in flight', () => {
    const rows = [{ submitted_at: ago(30) }];

    expect(allTasksAreStale(rows, 30 * MINUTE, NOW)).toBe(false);
  });

  it('never calls a row without a submitted_at stale', () => {
    // A missing timestamp means unknown age, and guessing "old" would drop
    // tasks that may still be running.
    const rows = [{ submitted_at: ago(90) }, { submitted_at: null }];

    expect(allTasksAreStale(rows, 30 * MINUTE, NOW)).toBe(false);
  });
});

/**
 * Drain time budgets (#702).
 *
 * A single 60-minute cap measured from submission discarded three consecutive
 * nightly runs on the largest brand: Cloro's first callback landed 62-65
 * minutes after submission, so the worker gave up minutes before the delivery
 * it was waiting for, then reported zero results and had its ledger row
 * deleted — freezing the dashboard and the pulse on the previous day while
 * ~1800 results landed just afterwards.
 *
 * Splitting the budget in two is what fixes it: waiting for the first result
 * is a different situation from waiting out the tail, and only the second one
 * has anything to measure.
 */
describe('drainBudgetExceeded', () => {
  const FIRST_RESULT_WAIT = 90 * MINUTE;
  const TAIL = 60 * MINUTE;
  const budget = (over) =>
    drainBudgetExceeded({
      firstResultWaitMs: FIRST_RESULT_WAIT,
      drainTailMs: TAIL,
      ...over,
    });

  it('keeps waiting past the old 60-minute cap when nothing has arrived yet', () => {
    // The exact case that broke: first delivery at 65 minutes.
    expect(budget({ now: NOW + 65 * MINUTE, drainStartedAt: NOW, firstResultAt: null })).toBeNull();
  });

  it('gives up once the first-result budget is spent', () => {
    expect(budget({ now: NOW + 90 * MINUTE, drainStartedAt: NOW, firstResultAt: null })).toBe(
      'no_first_result',
    );
  });

  it('measures the tail from the first result, not from submission', () => {
    // 80 minutes into the drain, but delivery only started 30 minutes ago:
    // the tail still has time even though the total exceeds the tail budget.
    expect(
      budget({
        now: NOW + 80 * MINUTE,
        drainStartedAt: NOW,
        firstResultAt: NOW + 50 * MINUTE,
      }),
    ).toBeNull();
  });

  it('gives up once the tail budget is spent', () => {
    expect(
      budget({
        now: NOW + 120 * MINUTE,
        drainStartedAt: NOW,
        firstResultAt: NOW + 60 * MINUTE,
      }),
    ).toBe('tail_deadline');
  });

  it('treats an undefined first result the same as null', () => {
    expect(budget({ now: NOW + 95 * MINUTE, drainStartedAt: NOW, firstResultAt: undefined })).toBe(
      'no_first_result',
    );
  });
});

/**
 * Paged pending-task reads (#714).
 *
 * The drain read was un-paginated, and PostgREST silently caps those at 1000
 * rows. The largest brand submits ~2130 tasks, so every poll reported exactly
 * 1000 pending: on the first poll that read as "1130 tasks already finished"
 * — starting the stall clock against a run that had received nothing — and on
 * every poll after it as "nothing is moving", because the number never
 * changed. Fifteen minutes of that plus tasks crossing the ghost age exited
 * the run four seconds after the threshold, four minutes before its first
 * result arrived. Three nights of the brand's dashboard froze on it.
 *
 * It only ever bit the one brand over 1000 tasks, which is why it looked like
 * a brand-specific problem rather than a query bug.
 */
describe('fetchAllPendingRows', () => {
  const pageOf = (n, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ task_id: `t${from + i}`, submitted_at: null }));

  it('returns every row when the set spans several pages', async () => {
    // 2130 rows: what the largest brand actually submits.
    const all = pageOf(2130);
    const fetchPage = async (offset) => ({
      data: all.slice(offset, offset + 1000),
      error: null,
    });

    const { rows, error } = await fetchAllPendingRows(fetchPage);

    expect(error).toBeNull();
    expect(rows).toHaveLength(2130);
  });

  it('stops after one request when the set fits in a page', async () => {
    const calls = [];
    const fetchPage = async (offset) => {
      calls.push(offset);
      return { data: pageOf(840), error: null };
    };

    const { rows } = await fetchAllPendingRows(fetchPage);

    expect(rows).toHaveLength(840);
    expect(calls).toEqual([0]);
  });

  it('asks for one more page when a page comes back exactly full', async () => {
    const calls = [];
    const fetchPage = async (offset) => {
      calls.push(offset);
      return { data: offset === 0 ? pageOf(1000) : [], error: null };
    };

    const { rows } = await fetchAllPendingRows(fetchPage);

    expect(rows).toHaveLength(1000);
    expect(calls).toEqual([0, 1000]);
  });

  it('reports an error rather than returning a partial set', async () => {
    // A half-read pending set looks like progress that never happened, which
    // is precisely the failure this whole change exists to prevent.
    const fetchPage = async (offset) =>
      offset === 0
        ? { data: pageOf(1000), error: null }
        : { data: null, error: { message: 'boom' } };

    const { rows, error } = await fetchAllPendingRows(fetchPage);

    expect(rows).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });

  it('handles an empty pending set', async () => {
    const { rows, error } = await fetchAllPendingRows(async () => ({ data: [], error: null }));

    expect(rows).toEqual([]);
    expect(error).toBeNull();
  });
});

/**
 * What a run is allowed to submit (#731 follow-up).
 *
 * Every id that survives this filter becomes a paid Cloro task, so the two
 * reasons to drop one — the brand turned Shopping off, the platform is down —
 * both have to hold at run time, not at the moment the prompt was saved.
 */
describe('runnablePlatforms', () => {
  it('drops a platform that is currently unavailable', () => {
    expect(
      runnablePlatforms(['chatgpt-web', 'grok-web', 'perplexity-web'], { shoppingEnabled: true }),
    ).toEqual(['chatgpt-web', 'perplexity-web']);
  });

  it('drops shopping unless the brand has it enabled', () => {
    expect(
      runnablePlatforms(['chatgpt-web', 'chatgpt-shopping'], { shoppingEnabled: false }),
    ).toEqual(['chatgpt-web']);
    expect(
      runnablePlatforms(['chatgpt-web', 'chatgpt-shopping'], { shoppingEnabled: true }),
    ).toEqual(['chatgpt-web', 'chatgpt-shopping']);
  });

  it('applies both reasons at once', () => {
    expect(
      runnablePlatforms(['grok-web', 'chatgpt-shopping', 'gemini-web'], { shoppingEnabled: false }),
    ).toEqual(['gemini-web']);
  });

  it('returns an empty list for a prompt with no platforms', () => {
    expect(runnablePlatforms([], { shoppingEnabled: true })).toEqual([]);
    expect(runnablePlatforms(null, { shoppingEnabled: true })).toEqual([]);
    expect(runnablePlatforms(undefined, { shoppingEnabled: true })).toEqual([]);
  });

  // A prompt that lists only the unavailable platform must submit nothing at
  // all, rather than falling back to "no filter means run everything".
  it('leaves nothing to run when every platform is unavailable', () => {
    expect(runnablePlatforms([...UNAVAILABLE_PLATFORMS], { shoppingEnabled: true })).toEqual([]);
  });
});
