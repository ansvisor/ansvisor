// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READ_RETRY_MS, READ_TIMEOUT_MS, attemptRead } from './read-attempt';

/**
 * A read's own call (CHAT-20 §11b): its 20 s limit, one more try 2 s after a
 * failure, none after it ran out of time (the Visibility read that timed out
 * twice on 2026-11-11), and a Stop that doesn't wait.
 */

const never = () => new Promise<never>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('attemptRead', () => {
  it('gives what the read gave', async () => {
    const run = vi.fn(async () => ({ rows: 3 }));
    await expect(attemptRead(run, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: { rows: 3 },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reads once more, 2 s after a read that failed', async () => {
    const run = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ rows: 1 });
    const outcome = attemptRead(run, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(READ_RETRY_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toEqual({ ok: true, value: { rows: 1 } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('says why when the second try fails too', async () => {
    const run = vi.fn(async () => {
      throw new Error('relation does not exist');
    });
    const outcome = attemptRead(run, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(READ_RETRY_MS);
    await expect(outcome).resolves.toEqual({
      ok: false,
      timedOut: false,
      error: 'relation does not exist',
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stops a read at 20 s and doesn't run it again", async () => {
    const run = vi.fn(never);
    const outcome = attemptRead(run, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toMatchObject({ ok: false, timedOut: true });
    // No second try, now or after the retry's wait: the first is still running in the database.
    await vi.advanceTimersByTimeAsync(READ_RETRY_MS + READ_TIMEOUT_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends at a Stop, without waiting for the read or trying again', async () => {
    const stop = new AbortController();
    const run = vi.fn(never);
    const outcome = attemptRead(run, stop.signal);
    stop.abort();
    await expect(outcome).resolves.toEqual({ ok: false, timedOut: false, error: 'stopped' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("doesn't start after a Stop", async () => {
    const stop = new AbortController();
    stop.abort();
    const run = vi.fn(async () => ({}));
    await expect(attemptRead(run, stop.signal)).resolves.toEqual({
      ok: false,
      timedOut: false,
      error: 'stopped',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('leaves no listener on the run’s signal once the read is done', async () => {
    const stop = new AbortController();
    const remove = vi.spyOn(stop.signal, 'removeEventListener');
    await attemptRead(async () => ({}), stop.signal);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
