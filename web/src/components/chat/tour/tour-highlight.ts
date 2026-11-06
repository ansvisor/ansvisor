'use client';

import { useEffect } from 'react';
import { TOUR_TARGETS, type TourTopic } from '@/lib/chat/tour';

/** How long the explained element stays outlined. */
export const TOUR_HIGHLIGHT_MS = 4000;

/** How often, and how many times, a page still drawing its data is looked at again. */
const RETRY_MS = 300;
const RETRIES = 10;

/**
 * The outline: amber, as the app's notices, with its dark-theme pair. Kept
 * as whole class names here so Tailwind makes them.
 */
export const TOUR_HIGHLIGHT_CLASSES = [
  'ring-2',
  'ring-amber-400',
  'ring-offset-2',
  'ring-offset-background',
  'dark:ring-amber-300',
] as const;

/** The element a topic's turn explains on the page on screen; null when it isn't there. */
export function tourTargetOf(topic: TourTopic, root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(TOUR_TARGETS[topic]);
}

/**
 * Outlines the element the tour's turn about this page explains, for a few
 * seconds, brought into view, each time `key` changes (the panel opens on
 * the turn, or the page changes). Nothing happens when the element isn't on
 * the page: it never holds the page up or changes what it does.
 */
export function useTourHighlight(topic: TourTopic | null, key: string) {
  useEffect(() => {
    if (!topic) return;
    let element: HTMLElement | null = null;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => element?.classList.remove(...TOUR_HIGHLIGHT_CLASSES);
    const find = () => {
      element = tourTargetOf(topic);
      if (!element) {
        tries += 1;
        if (tries < RETRIES) timer = setTimeout(find, RETRY_MS);
        return;
      }
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView?.({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
      element.classList.add(...TOUR_HIGHLIGHT_CLASSES);
      timer = setTimeout(clear, TOUR_HIGHLIGHT_MS);
    };
    find();
    return () => {
      clearTimeout(timer);
      clear();
    };
  }, [topic, key]);
}
