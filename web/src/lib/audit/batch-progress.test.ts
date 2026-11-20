// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { batchProgress, nextBatch, type Batch } from './batch-progress';

const SINCE = '2026-11-19T10:00:00.000Z';
const MIN = 60_000;

describe('nextBatch', () => {
  it('starts a batch from the first read that has audits running', () => {
    expect(nextBatch(null, { count: 235, since: SINCE }, 1000)).toEqual({
      since: SINCE,
      total: 235,
      running: 235,
      seenAt: 1000,
      finished: false,
    });
  });

  it('follows the batch as audits finish, keeping its start and total', () => {
    const batch = nextBatch(null, { count: 10, since: SINCE }, 0) as Batch;
    const later = nextBatch(batch, { count: 7, since: SINCE }, 30_000);
    expect(later).toMatchObject({
      since: SINCE,
      total: 10,
      running: 7,
      seenAt: 0,
      finished: false,
    });
  });

  it('grows the total when more audits start while it runs', () => {
    const batch = nextBatch(null, { count: 10, since: SINCE }, 0) as Batch;
    const midway = nextBatch(batch, { count: 6, since: SINCE }, 1000) as Batch; // 4 done
    expect(nextBatch(midway, { count: 16, since: SINCE }, 2000)).toMatchObject({
      total: 20,
      running: 16,
    });
  });

  it('is finished once nothing runs, and a later run starts a new batch', () => {
    const batch = nextBatch(null, { count: 3, since: SINCE }, 0) as Batch;
    const done = nextBatch(batch, { count: 0, since: null }, 5000) as Batch;
    expect(done).toMatchObject({ running: 0, finished: true, total: 3 });
    // Idle reads leave it as it is.
    expect(nextBatch(done, { count: 0, since: null }, 9000)).toBe(done);
    const next = nextBatch(done, { count: 2, since: '2026-11-19T11:00:00.000Z' }, 10_000);
    expect(next).toMatchObject({ since: '2026-11-19T11:00:00.000Z', total: 2, finished: false });
  });

  it('follows nothing when nothing runs', () => {
    expect(nextBatch(null, { count: 0, since: null }, 0)).toBeNull();
  });
});

describe('batchProgress', () => {
  const batch = (over: Partial<Batch>): Batch => ({
    since: SINCE,
    total: 235,
    running: 235,
    seenAt: 0,
    finished: false,
    ...over,
  });

  it('counts the audits done and gives no time before one has finished', () => {
    expect(batchProgress(batch({}), 2 * MIN)).toEqual({
      done: 0,
      total: 235,
      fraction: 0,
      minutesLeft: null,
    });
  });

  it('estimates the time left from the pace so far, in whole minutes', () => {
    // 6 done in 2 minutes (3 a minute): 229 left take about 77 minutes.
    const progress = batchProgress(batch({ running: 229 }), 2 * MIN);
    expect(progress.done).toBe(6);
    expect(progress.minutesLeft).toBe(77);
    expect(progress.fraction).toBeCloseTo(6 / 235);
  });

  it('says at least a minute while audits are left', () => {
    expect(batchProgress(batch({ total: 10, running: 1 }), 9 * MIN).minutesLeft).toBe(1);
  });

  it('has no time left once the batch is done', () => {
    expect(batchProgress(batch({ running: 0, finished: true }), 70 * MIN)).toEqual({
      done: 235,
      total: 235,
      fraction: 1,
      minutesLeft: null,
    });
  });
});
