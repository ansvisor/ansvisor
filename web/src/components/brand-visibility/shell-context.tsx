'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { TrackingWindow } from '@/lib/actions/tracking';

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
   * The tab's first read is on its way. Server actions run one at a time, so
   * the run line's own read waits for this: it never holds the tab's data.
   */
  readSent: () => void;
}

const noop = () => {};

const OUTSIDE: BrandVisibilityShell = {
  actionsSlot: undefined,
  refreshes: 0,
  isRunning: false,
  reportRunWindow: noop,
  reportData: noop,
  readSent: noop,
};

export const BrandVisibilityShellContext = createContext<BrandVisibilityShell>(OUTSIDE);

export function useBrandVisibilityShell(): BrandVisibilityShell {
  return useContext(BrandVisibilityShellContext);
}

/** A tab's own header actions: in the shared header, or in place outside Brand Visibility. */
export function TabHeaderActions({ children }: { children: ReactNode }) {
  const { actionsSlot } = useBrandVisibilityShell();
  if (actionsSlot === undefined) return <>{children}</>;
  return actionsSlot ? createPortal(children, actionsSlot) : null;
}
