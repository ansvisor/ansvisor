'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { TrackingWindow } from '@/lib/actions/tracking';
import { NO_READ_CACHE, readKey, type ReadCache } from './read-cache';

/**
 * What Brand Visibility's shared layout (the header, the run line and the
 * tabs) gives the tab under it, and takes from it.
 */
export interface BrandVisibilityShell {
  /**
   * Where the tab's own header actions go (its Export CSV, Copy summary),
   * beside Reports and the run buttons: null until the header is drawn,
   * undefined outside Brand Visibility, where they stay in the tab.
   */
  actionsSlot: HTMLElement | null | undefined;
  /**
   * Bumped while a run brings answers in (about every 10 s), when it ends,
   * and when a daily run seen going finishes: the Overview reads again, quietly.
   */
  refreshes: number;
  /** A run this browser started is going. */
  isRunning: boolean;
  /** Run All, for admins and managers on a self-hosted install; absent otherwise. */
  runAll?: () => void;
  /** Test a single prompt, as Run All. */
  openSinglePrompt?: () => void;
  /** The run window the Overview's read came with, for the run line and the run's band. */
  reportRunWindow: (window: TrackingWindow) => void;
  /** What the Overview read: whether the brand has answers, and its newest. */
  reportData: (facts: { hasData: boolean; lastCheckedAt: string | null }) => void;
  /**
   * What the tabs last read, by brand and filters, kept while the page is
   * open: a tab opened again shows it at once and reads again quietly.
   */
  cache: ReadCache;
  /** The tab's first figures are on screen: the other tabs are prefetched then, not before. */
  shown: () => void;
}

const noop = () => {};

const OUTSIDE: BrandVisibilityShell = {
  actionsSlot: undefined,
  refreshes: 0,
  isRunning: false,
  reportRunWindow: noop,
  reportData: noop,
  cache: NO_READ_CACHE,
  shown: noop,
};

export const BrandVisibilityShellContext = createContext<BrandVisibilityShell>(OUTSIDE);

export function useBrandVisibilityShell(): BrandVisibilityShell {
  return useContext(BrandVisibilityShellContext);
}

/**
 * A read a tab keeps for the brand (the filters' choices, the topics, the
 * Opportunities card), kept under `name`: what it brought back last shows at
 * once when the tab opens again, and it reads again, quietly, on opening, on
 * another brand and when `version` changes. A failed read keeps what was
 * there. Undefined until there is something to show; no brand reads nothing.
 */
export function useBrandRead<T>(
  name: string,
  brandId: string | null | undefined,
  read: (brandId: string) => Promise<T>,
  version: number = 0,
): T | undefined {
  const { cache } = useBrandVisibilityShell();
  const key = brandId ? readKey(name, brandId) : null;
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    if (!key || !brandId) return;
    let cancelled = false;
    cache
      .read(key, () => read(brandId))
      .then(
        (value) => {
          if (!cancelled) setState({ key, value });
        },
        () => {},
      );
    return () => {
      cancelled = true;
    };
  }, [key, brandId, read, version, cache]);
  if (!key) return undefined;
  return state?.key === key ? state.value : cache.get<T>(key);
}

/** A tab's own header actions: in the shared header, or in place outside Brand Visibility. */
export function TabHeaderActions({ children }: { children: ReactNode }) {
  const { actionsSlot } = useBrandVisibilityShell();
  if (actionsSlot === undefined) return <>{children}</>;
  return actionsSlot ? createPortal(children, actionsSlot) : null;
}
