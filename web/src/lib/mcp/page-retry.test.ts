import { describe, expect, it, vi } from 'vitest';
import { readWithRetry } from './page-retry';

const timeout = { ok: false as const, code: 'timeout' };
const page = { ok: true as const, text: 'hi' };
const msg = () => "Couldn't read u: it timed out twice.";

describe('readWithRetry', () => {
  it('returns the page when a timeout is followed by success', async () => {
    const read = vi.fn().mockResolvedValueOnce(timeout).mockResolvedValueOnce(page);
    expect(await readWithRetry(read, msg, 0)).toBe(page);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('says incomplete after two timeouts, also when the fetch aborts', async () => {
    const abort = Object.assign(new Error('x'), { name: 'TimeoutError' });
    const read = vi.fn().mockResolvedValueOnce(timeout).mockRejectedValueOnce(abort);
    expect(await readWithRetry(read, msg, 0)).toEqual({
      ok: false,
      code: 'timeout',
      message: msg(),
      incomplete: true,
    });
  });

  it('does not retry other refusals or errors', async () => {
    const blocked = { ok: false as const, code: 'blocked' };
    const read = vi.fn().mockResolvedValue(blocked);
    expect(await readWithRetry(read, msg, 0)).toBe(blocked);
    expect(read).toHaveBeenCalledTimes(1);
    const boom = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(readWithRetry(boom, msg, 0)).rejects.toThrow('boom');
    expect(boom).toHaveBeenCalledTimes(1);
  });
});
