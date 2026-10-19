import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const manager = vi.hoisted(() => ({
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

vi.mock('./job-manager.js', () => manager);
vi.mock('../workers/tracking-worker.js', () => ({ processTrackingJob }));
vi.mock('../workers/content-worker.js', () => ({ processContentJob }));
vi.mock('./pulse/engine.js', () => ({ generatePulseForBrand: vi.fn() }));
vi.mock('./signals/pass.js', () => ({ runFirstSignalPass: vi.fn(), runSignalPass: vi.fn() }));
vi.mock('./logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { runTrackingJob, recoverWaitingJobs } = await import('./job-runner.js');

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
  });
});
