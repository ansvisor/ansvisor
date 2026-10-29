import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The first run after a payment: the Stripe return page and the checkout
 * webhook both ask for it, and only one run starts.
 */

// The brand's tracking jobs, as the jobs table holds them (newest first).
const table = vi.hoisted(() => ({ jobs: [], reads: [], readError: null }));
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const read = { filters: [] };
      const chain = {
        select: () => chain,
        eq: (column, value) => {
          read.filters.push(['eq', column, value]);
          return chain;
        },
        in: (column, values) => {
          read.filters.push(['in', column, values]);
          return chain;
        },
        gte: (column, value) => {
          read.filters.push(['gte', column, value]);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        then: (resolve, reject) => {
          table.reads.push(read);
          // The answer is the table as it is when the read lands, after any
          // insert made meanwhile.
          return Promise.resolve(
            table.readError
              ? { data: null, error: table.readError }
              : { data: [...table.jobs], error: null },
          ).then(resolve, reject);
        },
      };
      return chain;
    },
  },
}));

const createJob = vi.hoisted(() => vi.fn());
vi.mock('./job-manager.js', () => ({ createJob }));

const { isFullRun, pickStartedRun, startFirstRun } = await import('./first-run.js');

let ids = 0;
beforeEach(() => {
  table.jobs = [];
  table.reads = [];
  table.readError = null;
  createJob.mockReset().mockImplementation(async ({ data }) => {
    // Inserted a moment later, as a network call would be.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const job = {
      id: `job-${++ids}`,
      status: 'waiting',
      data,
      created_at: new Date().toISOString(),
    };
    table.jobs.unshift(job);
    return job;
  });
});

const CHECKOUT = '2026-10-29T10:00:00.000Z';
const job = (status, createdAt, data = {}) => ({
  id: `${status}-${createdAt}`,
  status,
  data: { brandId: 'b1', ...data },
  created_at: createdAt,
});

describe('startFirstRun', () => {
  it('starts one run when the return page and the webhook ask at the same moment', async () => {
    const [page, webhook] = await Promise.all([
      startFirstRun({ brandId: 'b1', since: CHECKOUT }),
      startFirstRun({ brandId: 'b1', since: CHECKOUT }),
    ]);

    expect(createJob).toHaveBeenCalledTimes(1);
    expect(createJob).toHaveBeenCalledWith({
      type: 'tracking',
      brandId: 'b1',
      data: { brandId: 'b1', immediate: true, firstRun: true },
      maxAttempts: 3,
    });
    expect(page).toEqual({ job: expect.objectContaining({ id: 'job-1' }), created: true });
    // The second gets the first's run back, for the progress bar.
    expect(webhook.created).toBe(false);
    expect(webhook.job.id).toBe(page.job.id);
  });

  it('starts a run when the webhook asks alone', async () => {
    const { created } = await startFirstRun({ brandId: 'b1', since: CHECKOUT });

    expect(created).toBe(true);
    expect(createJob).toHaveBeenCalledTimes(1);
    // Reads the brand's tracking jobs only.
    expect(table.reads[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'brand_id', 'b1'],
        ['eq', 'type', 'tracking'],
        ['in', 'status', ['waiting', 'active', 'completed']],
      ]),
    );
  });

  it('keeps brands apart: another brand still gets its run', async () => {
    await Promise.all([
      startFirstRun({ brandId: 'b1', since: CHECKOUT }),
      startFirstRun({ brandId: 'b2', since: CHECKOUT }),
    ]);
    // Both reads saw an empty table at the time, one per brand.
    expect(table.reads.map((read) => read.filters[0])).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['eq', 'brand_id', 'b2'],
    ]);
    expect(createJob).toHaveBeenCalledTimes(2);
  });

  it('starts nothing when the jobs cannot be read, and lets the next call try', async () => {
    table.readError = { message: 'timeout' };
    await expect(startFirstRun({ brandId: 'b1', since: CHECKOUT })).rejects.toThrow('timeout');
    expect(createJob).not.toHaveBeenCalled();

    table.readError = null;
    expect((await startFirstRun({ brandId: 'b1', since: CHECKOUT })).created).toBe(true);
  });
});

describe('pickStartedRun', () => {
  it('finds a run of every prompt still waiting or running, however old', () => {
    const live = job('active', '2026-10-29T08:00:00.000Z');
    expect(pickStartedRun([live], CHECKOUT)).toBe(live);
  });

  it('finds a run finished since the checkout began', () => {
    const done = job('completed', '2026-10-29T10:00:05.000Z');
    expect(pickStartedRun([done], CHECKOUT)).toBe(done);
  });

  it('starts again after a run that finished before the checkout', () => {
    expect(pickStartedRun([job('completed', '2026-10-29T09:00:00.000Z')], CHECKOUT)).toBeNull();
  });

  it('never counts a single-prompt or new-prompts run as the first run', () => {
    const jobs = [
      job('active', '2026-10-29T10:00:01.000Z', { promptId: 'p1' }),
      job('waiting', '2026-10-29T10:00:02.000Z', { promptIds: ['p1', 'p2'] }),
    ];
    expect(pickStartedRun(jobs, CHECKOUT)).toBeNull();
  });

  it('counts a run with an empty new-prompts list as a full run', () => {
    expect(isFullRun({ data: { brandId: 'b1', promptIds: [] } })).toBe(true);
    expect(isFullRun({ data: { brandId: 'b1', promptId: null } })).toBe(true);
  });
});
