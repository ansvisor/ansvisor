'use client';

import { useCallback, useMemo, useState } from 'react';
import { readKey } from '@/components/brand-visibility/read-cache';
import { useBrandVisibilityShell } from '@/components/brand-visibility/shell-context';
import type { ShoppingDatePreset } from '@/lib/actions/shopping';
import { setOpenAiProductFeed } from '@/lib/actions/shopping-openai-index';
import type { OpenAiIndexRead } from '@/lib/shopping/openai-index';
import { getOpenAiIndexRead } from '@/lib/visibility-reads';
import { useKeyedRead } from './use_keyed_read';

/**
 * "Catalog in OpenAI's product index" (#1281): the brand's direct-feed word
 * and its own products' US ChatGPT Shopping cards, over the Overview's window.
 * Read in the page, as the destinations are, while Readiness is open.
 * Supplemental: a failed read leaves the row empty.
 */
export function useOpenAiIndex(
  brandId: string | null,
  datePreset: ShoppingDatePreset,
  enabled: boolean,
): {
  read: OpenAiIndexRead | null;
  loading: boolean;
  /** Saves the brand's word; the box shows it at once and goes back if the save fails. */
  setDirectFeed: (on: boolean) => Promise<void>;
} {
  const { cache } = useBrandVisibilityShell();
  const wanted = enabled && !!brandId;
  const key = `${brandId}|${datePreset}`;
  const loaded = useKeyedRead(
    wanted,
    'openAiIndex',
    key,
    () => getOpenAiIndexRead(brandId!, datePreset),
    "OpenAI's product index",
  );
  // The word just saved, shown before the next read brings it back.
  const [saved, setSaved] = useState<{ key: string; directFeed: boolean } | null>(null);
  const read = useMemo(() => {
    const fromRead = loaded && loaded !== 'failed' ? loaded : null;
    return fromRead && saved?.key === key
      ? { ...fromRead, directFeed: saved.directFeed }
      : fromRead;
  }, [loaded, saved, key]);

  const setDirectFeed = useCallback(
    async (on: boolean) => {
      if (!brandId || !read) return;
      const before = read.directFeed;
      setSaved({ key, directFeed: on });
      try {
        await setOpenAiProductFeed(brandId, on);
        // The tab opened again shows it too.
        cache.set(readKey('shopping', 'openAiIndex', key), { ...read, directFeed: on });
      } catch (err) {
        setSaved({ key, directFeed: before });
        throw err;
      }
    },
    [brandId, key, read, cache],
  );

  return { read, loading: wanted && loaded === undefined, setDirectFeed };
}
