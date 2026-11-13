import { describe, expect, it, vi } from 'vitest';
import { readWithRetry } from './read-retry.js';

const timeout = () => Object.assign(new Error('slow'), { code: 'timeout' });

describe('readWithRetry', () => {
  it('retries once after a timeout, then returns the page', async () => {
    const read = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce('page');
    expect(await readWithRetry(read, { delayMs: 0 })).toEqual({ incomplete: false, value: 'page' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('marks the read incomplete after two timeouts', async () => {
    const read = vi.fn().mockRejectedValue(timeout());
    expect(await readWithRetry(read, { delayMs: 0 })).toEqual({ incomplete: true });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('passes other errors through without retrying', async () => {
    const read = vi.fn().mockRejectedValue(Object.assign(new Error('no'), { code: 'blocked' }));
    await expect(readWithRetry(read, { delayMs: 0 })).rejects.toThrow('no');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
