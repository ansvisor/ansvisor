import { describe, expect, it, vi } from 'vitest';
import { oncePerRequest, requestScope } from './request-scope.js';

/** What a request reads once (lib/request-scope.js): kept for that request only. */

const inRequest = (fn) =>
  new Promise((resolve, reject) => requestScope({}, {}, () => fn().then(resolve, reject)));

describe('oncePerRequest', () => {
  it('reads once in a request, afresh in the next and outside one', async () => {
    const read = vi.fn(async () => 'value');
    await inRequest(async () => {
      expect(await oncePerRequest('k', read)).toBe('value');
      expect(await oncePerRequest('k', read)).toBe('value');
    });
    expect(read).toHaveBeenCalledTimes(1);
    await inRequest(() => oncePerRequest('k', read));
    await oncePerRequest('k', read);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('keeps no failed read: the next caller in the request tries again', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce('value');
    await inRequest(async () => {
      await expect(oncePerRequest('k', read)).rejects.toThrow('connection reset');
      expect(await oncePerRequest('k', read)).toBe('value');
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
