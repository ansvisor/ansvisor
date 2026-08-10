import { describe, expect, it, vi } from 'vitest';

// The module pulls in the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { allTasksAreStale } from './tracking-worker.js';

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
