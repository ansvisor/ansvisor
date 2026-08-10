import { describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { isTransientDbError, series } from './metrics.js';

/**
 * Pulse metric execution shape (#687).
 *
 * The digest is a background job, so its aggregate queries run one at a time
 * rather than all at once: concurrency bought no perceived speed and instead
 * multiplied a single brand's peak database load, which is how the largest
 * brand's statements crossed the 8s timeout and its pulse was dropped.
 */

describe('series', () => {
  it('runs thunks one at a time, never overlapping', async () => {
    let running = 0;
    let maxConcurrent = 0;
    const task = () => async () => {
      maxConcurrent = Math.max(maxConcurrent, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return 'ok';
    };

    await series([task(), task(), task()]);

    expect(maxConcurrent).toBe(1);
  });

  it('returns results in input order, like Promise.all', async () => {
    const results = await series([async () => 'first', async () => 'second', async () => 'third']);

    expect(results).toEqual(['first', 'second', 'third']);
  });

  it('propagates a failure instead of swallowing it', async () => {
    const after = vi.fn();

    await expect(
      series([
        async () => 'ok',
        async () => {
          throw new Error('aggregate failed');
        },
        after,
      ]),
    ).rejects.toThrow('aggregate failed');
    // Sequencing means the remaining work never starts — the caller handles
    // the failure rather than the pulse half-computing itself.
    expect(after).not.toHaveBeenCalled();
  });
});

describe('isTransientDbError', () => {
  it('recognises the statement timeout that dropped a production pulse', () => {
    expect(isTransientDbError('canceling statement due to statement timeout')).toBe(true);
  });

  it('recognises deadlocks', () => {
    expect(isTransientDbError('deadlock detected')).toBe(true);
  });

  it('does not retry genuine errors', () => {
    // Retrying these would waste time and hide a real bug behind a slower
    // failure.
    expect(isTransientDbError('column "foo" does not exist')).toBe(false);
    expect(isTransientDbError('permission denied for table prompt_results')).toBe(false);
  });

  it('handles a missing message without throwing', () => {
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError('')).toBe(false);
  });
});
