import type { MouseEvent } from 'react';
import { sectionFor } from '@/lib/prompts-routes';

/**
 * A brand's prompts are managed on the Prompts page, on Tracked Prompts
 * (where Add prompt is), for the brand picked in the app: no address there
 * names a brand. The brand's own prompts page is going away.
 */
export const TRACKED_PROMPTS_HREF = sectionFor('all', 'tracked').href;

/** What a link needs to pick a brand as it opens. */
export interface PickOnOpen {
  onClick: () => void;
  onAuxClick: (event: Pick<MouseEvent, 'button'>) => void;
}

/**
 * Picks the brand when its link opens, here or in a new tab: on a click, a
 * Ctrl, Cmd or Shift click included (the new tab reads the pick this browser
 * keeps), and on a middle click, which fires auxclick, not click. A
 * right-click menu's "Open in new tab" picks nothing: that tab shows the
 * brand picked already.
 */
export function pickOnOpen(pick: () => void): PickOnOpen {
  return {
    onClick: pick,
    onAuxClick: (event) => {
      if (event.button === 1) pick();
    },
  };
}

/** A link to Tracked Prompts for one brand: it picks the brand, then opens the page. */
export function brandPromptsLink(
  brandId: string,
  setActiveBrand: (brandId: string) => void,
): PickOnOpen & { href: string } {
  return { href: TRACKED_PROMPTS_HREF, ...pickOnOpen(() => setActiveBrand(brandId)) };
}
