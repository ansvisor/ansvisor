/**
 * content-job.test.ts  (PROMPT-006)
 *
 * Following a content job until it completes, fails or we stop waiting.
 */

import { describe, expect, test } from 'vitest';
import type { GenerationJobStatus } from '@/lib/actions/content';
import { suggestForPrompt, waitForContentJob } from './content-job';

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

describe('suggestForPrompt', () => {
  const run = (
    start: Parameters<typeof suggestForPrompt>[1]['start'],
    getStatus: Parameters<typeof suggestForPrompt>[1]['getStatus'] = async () =>
      status({ status: 'active' }),
  ) => suggestForPrompt('p1', { start, getStatus, newKey: () => 'key-1', ...fakeClock() });

  test('follows the job to the opportunity it created', async () => {
    const outcome = await run(
      async () => ({ ok: true, jobId: 'j1' }),
      async () => status({ status: 'completed', result: { generated: 1, opportunityIds: ['o1'] } }),
    );
    expect(outcome).toEqual({ kind: 'created', opportunityId: 'o1' });
  });

  test('offers the open opportunity, whether known up front or found by the job', async () => {
    expect(await run(async () => ({ ok: true, existingId: 'o2' }))).toEqual({
      kind: 'existing',
      opportunityId: 'o2',
    });
    expect(
      await run(
        async () => ({ ok: true, jobId: 'j1' }),
        async () => status({ status: 'completed', result: { generated: 0, existingId: 'o3' } }),
      ),
    ).toEqual({ kind: 'existing', opportunityId: 'o3' });
  });

  test('tells a used-up quota from nothing to write yet', async () => {
    expect(
      await run(async () => ({ ok: false, error: 'Monthly limit', quotaExhausted: true })),
    ).toEqual({ kind: 'limited' });
    expect(
      await run(
        async () => ({ ok: true, jobId: 'j1' }),
        async () => status({ status: 'completed', result: { generated: 0, limited: true } }),
      ),
    ).toEqual({ kind: 'limited' });
    expect(
      await run(
        async () => ({ ok: true, jobId: 'j1' }),
        async () => status({ status: 'completed', result: { generated: 0 } }),
      ),
    ).toEqual({ kind: 'nothing' });
  });

  test('turns a refusal, a failed job or a throw into failed', async () => {
    expect(await run(async () => ({ ok: false, error: 'Prompt not found' }))).toEqual({
      kind: 'failed',
      message: 'Prompt not found',
    });
    expect(
      await run(
        async () => ({ ok: true, jobId: 'j1' }),
        async () => status({ status: 'failed', failedReason: 'No AI key' }),
      ),
    ).toEqual({ kind: 'failed', message: 'No AI key' });
    expect(
      await run(async () => {
        throw new Error('crypto.randomUUID is not a function');
      }),
    ).toEqual({ kind: 'failed', message: 'crypto.randomUUID is not a function' });
  });
});
