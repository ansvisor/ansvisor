'use client';

import { createContext, useContext } from 'react';
import type { ComposerChip } from './composer/chat-composer';

/**
 * The page open beside the chat (Open here, CHAT-25 §4, W4-15c), as the
 * chat's box sees it: the shell keeps it, the chat's page reads it. Its chip,
 * "Page: {title}", is the editor's "This draft" (W4-14): while a message
 * carries it, Chat doesn't change the page, and the Content Agent leaves
 * suggestions in it instead. × takes the chip out and leaves the page open;
 * Close takes both. Outside the shell, or with no page open, it is null.
 */
export interface PageChip {
  /** The box's chip for the page, or null once × took it out. */
  chip: ComposerChip | null;
  /** × on the chip: Chat leaves the page alone; the page stays open. */
  removeChip: () => void;
  /** The Content Agent left suggestions in the page (W4-14): the editor reads them. */
  suggested: (count: number) => void;
}

export const PageChipContext = createContext<PageChip | null>(null);

export function usePageChip(): PageChip | null {
  return useContext(PageChipContext);
}
