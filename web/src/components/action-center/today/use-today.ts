'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { markSeen, readUserBrandState } from '@/lib/actions/user-brand-state';
import type { UserBrandState } from '@/lib/user-brand-state';

/** One of Today's reads: loading, its answer, or failed (its part then stays away). */
export type TodayLoad<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed' };

/**
 * Reads one of Today's parts on its own: again when `key` changes (the
 * brand; null waits), or when `version` goes up, keeping the last answer on
 * screen until the next one comes. An answer for an older key is dropped.
 */
export function useTodayRead<T>(
  key: string | null,
  read: () => Promise<T>,
  version = 0,
): TodayLoad<T> {
  const [result, setResult] = useState<{ key: string; load: TodayLoad<T> } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    read().then(
      (data) => {
        if (live) setResult({ key, load: { status: 'ready', data } });
      },
      () => {
        if (live) setResult({ key, load: { status: 'failed' } });
      },
    );
    return () => {
      live = false;
    };
    // The read is the key's: it runs again only when the key or version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  if (key === null || !result || result.key !== key) return { status: 'loading' };
  return result.load;
}

/** The parts a visit waits on before it counts as seen, with what each counted. */
export type TodayVisitPart = 'since' | 'focus' | 'waiting';

export interface TodayVisit {
  /** The person's state on the brand: undefined while it reads, null when it couldn't be read. */
  state: UserBrandState | null | undefined;
  /** Their last visit to Today before this one: undefined while it reads, null for none. */
  seenAt: string | null | undefined;
  /** A part has read: its count goes into today_viewed. */
  settle: (part: TodayVisitPart, count: number | null) => void;
}

/**
 * A visit to Today on a brand: the person's state as it was when they came
 * (their last visit, for "Since yesterday" and the New tags), and, once
 * each part in `waitFor` has read, the visit kept (markSeen) and
 * today_viewed sent, once per brand. Kept after the reads, so a slot the
 * focus filled on this visit isn't New again on the next.
 */
export function useTodayVisit(
  brandId: string | null,
  waitFor: readonly TodayVisitPart[],
  extra: () => Record<string, unknown> = () => ({}),
): TodayVisit {
  const load = useTodayRead(brandId, () => readUserBrandState(brandId!));
  const visit = useRef<{ brandId: string | null; counts: Map<TodayVisitPart, number | null> }>({
    brandId: null,
    counts: new Map(),
  });
  const sent = useRef(new Set<string>());
  const extraRef = useRef(extra);
  useEffect(() => {
    extraRef.current = extra;
  });

  const settle = useCallback(
    (part: TodayVisitPart, count: number | null) => {
      if (!brandId) return;
      if (visit.current.brandId !== brandId) visit.current = { brandId, counts: new Map() };
      visit.current.counts.set(part, count);
      if (sent.current.has(brandId) || !waitFor.every((p) => visit.current.counts.has(p))) return;
      sent.current.add(brandId);
      void markSeen(brandId, 'today');
      const counts = visit.current.counts;
      track('today_viewed', {
        state: 'normal',
        ...(counts.has('since') ? { since_count: counts.get('since') } : {}),
        ...(counts.has('focus') ? { focus_count: counts.get('focus') } : {}),
        ...(counts.has('waiting') ? { waiting_count: counts.get('waiting') } : {}),
        ...extraRef.current(),
      });
    },
    [brandId, waitFor],
  );

  const state = load.status === 'loading' ? undefined : load.status === 'ready' ? load.data : null;
  const seenAt = state === undefined ? undefined : (state?.navSeen.today ?? null);
  return { state, seenAt, settle };
}
