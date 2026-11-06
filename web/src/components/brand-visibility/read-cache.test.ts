import { describe, expect, it, vi } from 'vitest';
import { createReadCache, NO_READ_CACHE, readKey } from './read-cache';

/**
 * What the Visibility tabs last read, kept by their shared layout: keyed by
 * the read, the brand and the filters; a read already on its way is joined,
 * not sent twice; the oldest goes first past the limit.
 */

describe('the tabs’ read cache', () => {
  it('keeps a read under its brand and filters, and nothing under another', () => {
    const cache = createReadCache();
    cache.set(readKey('overview', 'b1', { range: '7d' }), { answers: 120 });
    expect(cache.get(readKey('overview', 'b1', { range: '7d' }))).toEqual({ answers: 120 });
    expect(cache.get(readKey('overview', 'b2', { range: '7d' }))).toBeUndefined();
    expect(cache.get(readKey('overview', 'b1', { range: '30d' }))).toBeUndefined();
  });

  it('keeps a read that came back empty, as empty', () => {
    const cache = createReadCache();
    cache.set('mentions', null);
    expect(cache.get('mentions')).toBeNull();
  });

  it('joins a read already on its way, and keeps what it brings back', async () => {
    const cache = createReadCache();
    let answer: (topics: string[]) => void = () => {};
    const read = vi.fn(() => new Promise<string[]>((resolve) => (answer = resolve)));
    const first = cache.read('topics|b1', read);
    const second = cache.read('topics|b1', read);
    expect(read).toHaveBeenCalledTimes(1);
    answer(['Espresso']);
    expect(await first).toEqual(['Espresso']);
    expect(await second).toEqual(['Espresso']);
    expect(cache.get('topics|b1')).toEqual(['Espresso']);

    // Done: the next one reads again.
    await cache.read('topics|b1', async () => ['Espresso', 'Filter']);
    expect(cache.get('topics|b1')).toEqual(['Espresso', 'Filter']);
  });

  it('keeps nothing from a failed read, and the next one tries again', async () => {
    const cache = createReadCache();
    await expect(
      cache.read('topics|b1', async () => Promise.reject(new Error('offline'))),
    ).rejects.toThrow('offline');
    expect(cache.get('topics|b1')).toBeUndefined();
    expect(await cache.read('topics|b1', async () => ['Espresso'])).toEqual(['Espresso']);
  });

  it('lets the one read longest ago go past the limit', () => {
    const cache = createReadCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // Read again: newest now.
    cache.set('a', 3);
    cache.set('c', 4);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(3);
    expect(cache.get('c')).toBe(4);
  });

  it('outside Visibility keeps nothing, and every read is its own', async () => {
    const read = vi.fn(async () => 1);
    NO_READ_CACHE.set('a', 1);
    expect(NO_READ_CACHE.get('a')).toBeUndefined();
    await Promise.all([NO_READ_CACHE.read('a', read), NO_READ_CACHE.read('a', read)]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
