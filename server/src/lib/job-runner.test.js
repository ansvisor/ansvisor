import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const manager = vi.hoisted(() => ({
  cancelClaimedJob: vi.fn(),
  cancelWaitingJob: vi.fn(),
  claimWaitingJob: vi.fn(),
  listWaitingJobs: vi.fn(),
  getJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  updateJobProgress: vi.fn(),
  registerActiveJob: vi.fn(),
  unregisterActiveJob: vi.fn(),
}));
const processTrackingJob = vi.hoisted(() => vi.fn());
const processContentJob = vi.hoisted(() => vi.fn());
const activeBrandFilter = vi.hoisted(() => vi.fn());
const isBrandActive = vi.hoisted(() => vi.fn());

vi.mock('./job-manager.js', () => manager);
// A retry sets its job back to waiting itself.
vi.mock('../config/supabase.js', () => ({
  default: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) },
}));
vi.mock('./active-subscriptions.js', () => ({ activeBrandFilter, isBrandActive }));
vi.mock('../workers/tracking-worker.js', () => ({ processTrackingJob }));
vi.mock('../workers/content-worker.js', () => ({ processContentJob }));
vi.mock('./pulse/engine.js', () => ({ generatePulseForBrand: vi.fn() }));
vi.mock('./signals/pass.js', () => ({ runFirstSignalPass: vi.fn(), runSignalPass: vi.fn() }));
vi.mock('./logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { runContentJob, runTrackingJob, recoverWaitingJobs } = await import('./job-runner.js');

// Default TRACKING_CONCURRENCY.
const MAX = 2;

/** A tracking run that stays in flight until released. */
function heldRuns() {
  const releases = [];
  processTrackingJob.mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(() => resolve({ resultCount: 0, stamped: false }));
      }),
  );
  return releases;
}

const flush = () => vi.advanceTimersByTimeAsync(0);

/** Finish every run, including the ones still waiting for a slot. */
async function drain(releases) {
  for (let i = 0; i < 10; i++) {
    releases.forEach((release) => release());
    await vi.advanceTimersByTimeAsync(5000);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of Object.values(manager)) fn.mockReset();
  processTrackingJob.mockReset();
  processContentJob.mockReset();
  // Every organization on a plan unless a test says otherwise.
  activeBrandFilter.mockReset().mockResolvedValue(() => true);
  isBrandActive.mockReset().mockResolvedValue(true);
  manager.cancelClaimedJob.mockResolvedValue(true);
  // The claim resolves a tick later, as a network call would.
  manager.claimWaitingJob.mockImplementation(async (id) => {
    await Promise.resolve();
    return { id, attempts: 1, max_attempts: 3, data: { brandId: `brand-${id}` } };
  });
});

// Each test drains its runs, so the module's slot counters start at zero.
afterEach(() => {
  vi.useRealTimers();
});

describe('runTrackingJob', () => {
  it('never runs more than the concurrency limit, even when slots are claimed at once', async () => {
    const releases = heldRuns();
    for (const id of ['a', 'b', 'c', 'd', 'e']) runTrackingJob(id);
    await flush();

    expect(processTrackingJob).toHaveBeenCalledTimes(MAX);

    // A finished run frees one slot, and only one waiting job takes it.
    releases[0]();
    await vi.advanceTimersByTimeAsync(5000);
    expect(processTrackingJob).toHaveBeenCalledTimes(MAX + 1);

    await drain(releases);
    expect(processTrackingJob).toHaveBeenCalledTimes(5);
  });

  it('gives the slot back when the job cannot be claimed', async () => {
    const releases = heldRuns();
    manager.claimWaitingJob.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    for (const id of ['gone-1', 'gone-2', 'f', 'g']) runTrackingJob(id);
    await vi.advanceTimersByTimeAsync(5000);

    expect(processTrackingJob).toHaveBeenCalledTimes(2);
    await drain(releases);
  });

  it('starts one run chain per job, however often it is asked to', async () => {
    const releases = heldRuns();
    runTrackingJob('dup');
    runTrackingJob('dup');
    await flush();

    expect(manager.claimWaitingJob).toHaveBeenCalledTimes(1);
    await drain(releases);
  });
});

/**
 * The first run after a payment goes ahead of the queue: someone is watching
 * it, and the nightly runs can hold every slot for an hour.
 */
describe('runTrackingJob, the first run after a payment', () => {
  it('starts at once in its extra slot while the nightly runs hold every slot', async () => {
    const releases = heldRuns();
    runTrackingJob('night-1');
    runTrackingJob('night-2');
    await flush();
    expect(processTrackingJob).toHaveBeenCalledTimes(MAX);

    runTrackingJob('first', undefined, { priority: true });
    await flush();
    expect(processTrackingJob).toHaveBeenCalledTimes(MAX + 1);
    expect(processTrackingJob.mock.calls[MAX][0].brandId).toBe('brand-first');

    // The extra slot is the first run's only: a regular job still waits.
    runTrackingJob('night-3');
    await vi.advanceTimersByTimeAsync(5000);
    expect(processTrackingJob).toHaveBeenCalledTimes(MAX + 1);

    await drain(releases);
    expect(processTrackingJob).toHaveBeenCalledTimes(MAX + 2);
  });

  it('takes the next free slot when even its extra one is taken, ahead of regular jobs', async () => {
    const releases = heldRuns();
    for (const id of ['night-1', 'night-2', 'night-3']) runTrackingJob(id);
    runTrackingJob('first-1', undefined, { priority: true });
    await flush();
    // night-3 waits, retrying every 5 s from now.
    expect(processTrackingJob).toHaveBeenCalledTimes(MAX + 1);

    // Another payment, every slot still taken.
    await vi.advanceTimersByTimeAsync(4500);
    runTrackingJob('first-2', undefined, { priority: true });
    await flush();

    // Two slots free up just before night-3 tries again: night-3 steps aside.
    releases[0]();
    releases[1]();
    await vi.advanceTimersByTimeAsync(500);
    const started = () => processTrackingJob.mock.calls.map(([job]) => job.brandId);
    expect(started()).not.toContain('brand-night-3');

    await vi.advanceTimersByTimeAsync(500);
    expect(started()).toContain('brand-first-2');
    expect(started()).not.toContain('brand-night-3');

    await drain(releases);
    expect(started()).toContain('brand-night-3');
  });

  it('keeps its place when the recovery sweep restarts it', async () => {
    const releases = heldRuns();
    runTrackingJob('night-1');
    runTrackingJob('night-2');
    await flush();

    manager.listWaitingJobs.mockResolvedValue([
      { id: 'lost-first', type: 'tracking', brand_id: 'b', data: { firstRun: true } },
      { id: 'lost-night', type: 'tracking', brand_id: 'b', data: { immediate: false } },
    ]);
    await recoverWaitingJobs();
    await flush();

    expect(processTrackingJob.mock.calls.map(([job]) => job.brandId)).toEqual([
      'brand-night-1',
      'brand-night-2',
      'brand-lost-first',
    ]);
    await drain(releases);
  });
});

/**
 * Once the plan has ended (2026-10-27): a job is cancelled when it is
 * claimed, however it was started, before anything is tracked or written.
 */
describe('a job of an organization whose plan has ended', () => {
  it('is cancelled once claimed, not tracked, and gives its slot back', async () => {
    const releases = heldRuns();
    isBrandActive.mockImplementation(async (brandId) => brandId !== 'brand-lapsed');

    for (const id of ['lapsed', 'a', 'b']) runTrackingJob(id);
    await vi.advanceTimersByTimeAsync(5000);

    expect(isBrandActive).toHaveBeenCalledWith('brand-lapsed');
    expect(manager.cancelClaimedJob).toHaveBeenCalledWith('lapsed', 'subscription_inactive');
    expect(processTrackingJob.mock.calls.map(([job]) => job.brandId)).toEqual([
      'brand-a',
      'brand-b',
    ]);
    expect(manager.completeJob).not.toHaveBeenCalledWith('lapsed', expect.anything());
    expect(manager.failJob).not.toHaveBeenCalled();
    await drain(releases);
  });

  it('is failed, never left active, when it cannot be cancelled', async () => {
    isBrandActive.mockResolvedValue(false);
    manager.cancelClaimedJob.mockResolvedValue(false);
    const { default: logger } = await import('./logger.js');
    vi.mocked(logger.warn).mockClear();

    runTrackingJob('stuck');
    await flush();

    expect(manager.cancelClaimedJob).toHaveBeenCalledWith('stuck', 'subscription_inactive');
    expect(manager.failJob).toHaveBeenCalledWith('stuck', 'subscription_inactive');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(processTrackingJob).not.toHaveBeenCalled();
  });

  it('is only cancelled, not failed, when the cancel is written', async () => {
    isBrandActive.mockResolvedValue(false);
    manager.cancelClaimedJob.mockResolvedValue(true);

    runTrackingJob('cancelled');
    await flush();

    expect(manager.failJob).not.toHaveBeenCalled();
  });

  it('writes no content either', async () => {
    isBrandActive.mockResolvedValue(false);

    runContentJob('lapsed-content');
    await flush();

    expect(manager.cancelClaimedJob).toHaveBeenCalledWith(
      'lapsed-content',
      'subscription_inactive',
    );
    expect(processContentJob).not.toHaveBeenCalled();
  });

  it('is not retried once the plan ends between two attempts', async () => {
    processTrackingJob.mockRejectedValueOnce(new Error('cloro down'));
    manager.getJob.mockResolvedValue({ attempts: 1, max_attempts: 3 });
    isBrandActive.mockResolvedValueOnce(true).mockResolvedValue(false);

    runTrackingJob('retry');
    await flush();
    expect(processTrackingJob).toHaveBeenCalledTimes(1);

    // The retry waits attempts × 30 s.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(manager.claimWaitingJob).toHaveBeenCalledTimes(2);
    expect(manager.cancelClaimedJob).toHaveBeenCalledWith('retry', 'subscription_inactive');
    expect(processTrackingJob).toHaveBeenCalledTimes(1);
  });

  it('tracks nothing when it cannot tell, and retries as after any failure', async () => {
    isBrandActive.mockRejectedValueOnce(new Error('brands read: timeout'));
    manager.getJob.mockResolvedValue({ attempts: 1, max_attempts: 3 });
    processTrackingJob.mockResolvedValue({ resultCount: 0, stamped: false });

    runTrackingJob('unsure');
    await flush();

    expect(processTrackingJob).not.toHaveBeenCalled();
    expect(manager.cancelClaimedJob).not.toHaveBeenCalled();
    expect(manager.failJob).toHaveBeenCalledWith('unsure', 'brands read: timeout');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(processTrackingJob).toHaveBeenCalledTimes(1);
  });
});

describe('recoverWaitingJobs', () => {
  it('restarts waiting jobs with no run chain here, routed by type', async () => {
    const releases = heldRuns();
    processContentJob.mockResolvedValue({ generated: 0 });
    runTrackingJob('live');
    await flush();

    manager.listWaitingJobs.mockResolvedValue([
      { id: 'live', type: 'tracking' },
      { id: 'lost-tracking', type: 'tracking' },
      { id: 'lost-content', type: 'content' },
      { id: 'other', type: 'export' },
    ]);
    const recovered = await recoverWaitingJobs();
    await flush();

    expect(recovered).toBe(2);
    expect(manager.claimWaitingJob.mock.calls.map(([id]) => id)).toEqual([
      'live',
      'lost-tracking',
      'lost-content',
    ]);
    expect(processContentJob).toHaveBeenCalledTimes(1);
    expect(manager.listWaitingJobs).toHaveBeenCalledWith({
      idleMs: 2 * 60_000,
      maxAgeMs: 20 * 60 * 60_000,
    });
    await drain(releases);
  });

  it('does nothing when no job is waiting', async () => {
    manager.listWaitingJobs.mockResolvedValue([]);
    expect(await recoverWaitingJobs()).toBe(0);
    expect(manager.claimWaitingJob).not.toHaveBeenCalled();
    expect(activeBrandFilter).not.toHaveBeenCalled();
  });

  it('cancels, rather than runs, the waiting jobs of an organization whose plan has ended', async () => {
    const releases = heldRuns();
    processContentJob.mockResolvedValue({ generated: 0 });
    activeBrandFilter.mockResolvedValue((brandId) => brandId === 'paying');
    manager.cancelWaitingJob.mockResolvedValue(true);
    manager.listWaitingJobs.mockResolvedValue([
      { id: 'kept', type: 'tracking', brand_id: 'paying' },
      { id: 'lapsed-tracking', type: 'tracking', brand_id: 'lapsed' },
      { id: 'lapsed-content', type: 'content', brand_id: 'lapsed' },
    ]);

    const recovered = await recoverWaitingJobs();
    await flush();

    expect(recovered).toBe(1);
    expect(activeBrandFilter).toHaveBeenCalledWith(['paying', 'lapsed', 'lapsed']);
    // Only while still waiting, saying why.
    expect(manager.cancelWaitingJob.mock.calls).toEqual([
      ['lapsed-tracking', 'subscription_inactive'],
      ['lapsed-content', 'subscription_inactive'],
    ]);
    expect(manager.claimWaitingJob.mock.calls.map(([id]) => id)).toEqual(['kept']);
    expect(processContentJob).not.toHaveBeenCalled();
    await drain(releases);
  });

  it('runs nothing when it cannot tell which organizations are on a plan', async () => {
    activeBrandFilter.mockRejectedValue(new Error('organizations read: timeout'));
    manager.listWaitingJobs.mockResolvedValue([{ id: 'lost', type: 'tracking', brand_id: 'b' }]);

    await expect(recoverWaitingJobs()).rejects.toThrow('organizations read');
    expect(manager.claimWaitingJob).not.toHaveBeenCalled();
    expect(manager.cancelWaitingJob).not.toHaveBeenCalled();
  });
});
