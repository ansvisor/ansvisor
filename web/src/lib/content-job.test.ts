/**
 * content-job.test.ts  (PROMPT-006)
 *
 * Following a content job until it completes, fails or we stop waiting.
 */

import { describe, expect, test } from 'vitest';
import type { GenerationJobStatus } from '@/lib/actions/content';
import { waitForContentJob } from './content-job';

const status = (s: Partial<GenerationJobStatus>): GenerationJobStatus => ({
  status: 'active',
  progress: null,
  result: null,
  failedReason: null,
  ...s,
});

/** A clock that moves only when the wait sleeps. */
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

describe('waitForContentJob', () => {
  test('returns the result once the job completes, through blips', async () => {
    const seen = [
      status({ status: 'not_found' }),
      status({ status: 'active' }),
      status({ status: 'completed', result: { generated: 1, opportunityIds: ['o1'] } }),
    ];
    const outcome = await waitForContentJob('j1', {
      getStatus: async () => seen.shift()!,
      ...fakeClock(),
    });
    expect(outcome).toEqual({
      kind: 'completed',
      result: { generated: 1, opportunityIds: ['o1'] },
    });
  });

  test('keeps waiting when a status read throws', async () => {
    let calls = 0;
    const outcome = await waitForContentJob('j1', {
      getStatus: async () => {
        calls += 1;
        if (calls === 1) throw new Error('Session expired');
        return status({ status: 'completed', result: { generated: 1, opportunityIds: ['o1'] } });
      },
      ...fakeClock(),
    });
    expect(outcome).toEqual({
      kind: 'completed',
      result: { generated: 1, opportunityIds: ['o1'] },
    });
  });

  test('reports a failure with its reason', async () => {
    const outcome = await waitForContentJob('j1', {
      getStatus: async () => status({ status: 'failed', failedReason: 'No AI key' }),
      ...fakeClock(),
    });
    expect(outcome).toEqual({ kind: 'failed', reason: 'No AI key' });
  });

  test('stops waiting after the timeout, without claiming the job failed', async () => {
    const outcome = await waitForContentJob('j1', {
      getStatus: async () => status({ status: 'active' }),
      timeoutMs: 9000,
      intervalMs: 3000,
      ...fakeClock(),
    });
    expect(outcome).toEqual({ kind: 'timeout' });
  });
});
