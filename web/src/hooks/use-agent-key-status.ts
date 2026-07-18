'use client';

import { useEffect, useState } from 'react';

/**
 * Module-level cache so we only hit /api/settings/anthropic-key once per
 * page-load session — not on every navigation. The sidebar and mobile nav
 * both consume this hook; sharing the cache means a single inflight request
 * even when both components mount simultaneously (e.g. on a resize boundary).
 *
 * The cache intentionally resets on a full page reload (module re-evaluation),
 * which satisfies the acceptance criterion: "after the key is saved, the badge
 * disappears on next load fine — no realtime requirement."
 */
let cachedStatus: 'loading' | 'configured' | 'missing' = 'loading';
let fetchPromise: Promise<void> | null = null;

export function fetchKeyStatus(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const res = await fetch('/api/settings/anthropic-key');
      if (!res.ok) {
        cachedStatus = 'missing';
        return;
      }
      const body = (await res.json()) as { configured?: boolean };
      cachedStatus = body.configured ? 'configured' : 'missing';
    } catch {
      cachedStatus = 'missing';
    }
  })();
  return fetchPromise;
}

/** Exposed for tests only — reads the current module-level cache value. */
export function getCachedStatus() {
  return cachedStatus;
}

/**
 * Returns whether the org has saved an Anthropic API key.
 *
 * On self-host (`isCloud === false`) this is a no-op — the key lives in the
 * server env and no network call is made. Only cloud instances probe the
 * endpoint, gated by the same `NEXT_PUBLIC_IS_CLOUD` flag the rest of the
 * dashboard uses.
 *
 * @param isCloud - pass the value from `useFeatureGate()` so this hook stays
 *   pure and testable without a real PlanContext.
 */
export function useAgentKeyStatus(isCloud: boolean): 'loading' | 'configured' | 'missing' {
  // Self-host never needs a key check — return a stable value immediately.
  if (!isCloud) return 'configured';

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [status, setStatus] = useState<'loading' | 'configured' | 'missing'>(cachedStatus);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    // Already resolved from a prior render or sibling mount — nothing to do.
    if (cachedStatus !== 'loading') {
      setStatus(cachedStatus);
      return;
    }
    let cancelled = false;
    fetchKeyStatus().then(() => {
      if (!cancelled) setStatus(cachedStatus);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
