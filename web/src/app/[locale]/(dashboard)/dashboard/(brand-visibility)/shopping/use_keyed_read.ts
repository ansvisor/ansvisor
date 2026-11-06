'use client';

import { useEffect, useRef, useState } from 'react';
import { readKey } from '@/components/brand-visibility/read-cache';
import { useBrandVisibilityShell } from '@/components/brand-visibility/shell-context';

/**
 * A read made once per `key` while it's `wanted`, and kept for that key:
 * undefined while it reads (or until it's wanted), 'failed' when it threw.
 * `key` names what `read` reads (the brand and the filters): a new key reads
 * again, and an answer for an older one is dropped. Product Visibility's
 * reads go this way, each apart from the others, so none waits for another,
 * and each only once its view is open.
 *
 * What it read is kept in Visibility's shared cache too, under `name` and
 * `key`: the tab opened again (or a key read before) shows it at once and
 * reads it again, quietly; a failed quiet read leaves it there. A new
 * `attempt` (Retry, a source connected) reads again.
 */
export function useKeyedRead<T>(
  wanted: boolean,
  name: string,
  key: string,
  read: () => Promise<T>,
  /** What it reads, for the console when it fails. */
  what: string,
  attempt: number = 0,
): T | 'failed' | undefined {
  const { cache } = useBrandVisibilityShell();
  const cacheKey = readKey('shopping', name, key);
  const readFor = `${cacheKey}#${attempt}`;
  const [kept, setKept] = useState<{ key: string; value: T | 'failed' } | null>(null);
  // The latest read: a new function each render, called for the key it was made with.
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  const keptKey = kept?.key;
  useEffect(() => {
    if (!wanted || keptKey === readFor) return;
    let cancelled = false;
    cache
      .read(cacheKey, () => readRef.current())
      .then(
        (value) => {
          if (!cancelled) setKept({ key: readFor, value });
        },
        (err) => {
          console.error(`Failed to read ${what}:`, err);
          if (!cancelled) setKept({ key: readFor, value: 'failed' });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [wanted, cacheKey, readFor, keptKey, what, cache]);
  const before = cache.get<T>(cacheKey);
  if (kept?.key === readFor) return kept.value === 'failed' ? (before ?? 'failed') : kept.value;
  return before;
}
