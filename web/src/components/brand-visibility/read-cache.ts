/**
 * What the Visibility tabs last read, kept by the shared layout while the
 * page is open (it stays mounted from tab to tab): a tab opened again shows
 * its figures for the same brand and filters at once, and reads them again
 * quietly. Each key names the read, the brand and the filters, so another
 * brand's or another range's figures never show under these.
 */
export interface ReadCache {
  /** What the read under `key` last brought back; undefined when nothing is kept. */
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  /**
   * Reads `key` with `fn`, or joins a read of it already on its way (two
   * tabs, or a tab and its filters, asking for the same thing); what it
   * brings back is kept.
   */
  read<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Reads kept at most, the one read longest ago going first: a few filter
 * changes on each tab, with the brand's filter choices beside them.
 */
export const READ_CACHE_LIMIT = 30;

/** A read's key: its name, the brand, and what it was read for. */
export function readKey(...parts: unknown[]): string {
  return JSON.stringify(parts);
}

export function createReadCache(limit: number = READ_CACHE_LIMIT): ReadCache {
  const kept = new Map<string, unknown>();
  const reading = new Map<string, Promise<unknown>>();
  const set = (key: string, value: unknown) => {
    // Kept newest last: the first key is the one read longest ago.
    kept.delete(key);
    kept.set(key, value);
    while (kept.size > limit) kept.delete(kept.keys().next().value as string);
  };
  return {
    get: <T>(key: string) => kept.get(key) as T | undefined,
    set,
    read: <T>(key: string, fn: () => Promise<T>) => {
      const going = reading.get(key);
      if (going) return going as Promise<T>;
      const promise = fn().then(
        (value) => {
          reading.delete(key);
          set(key, value);
          return value;
        },
        (err: unknown) => {
          reading.delete(key);
          throw err;
        },
      );
      reading.set(key, promise);
      return promise;
    },
  };
}

/** Outside Visibility (a tab rendered on its own): nothing is kept, every read is its own. */
export const NO_READ_CACHE: ReadCache = {
  get: () => undefined,
  set: () => {},
  read: (_key, fn) => fn(),
};
