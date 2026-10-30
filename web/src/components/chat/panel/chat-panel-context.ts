'use client';

import { createContext, useContext } from 'react';
import type { PanelSize } from '@/lib/chat/panel';
import type { ChatMode } from '@/lib/chat/precedence';

/**
 * The side panel's state for what sits on the page (Ask Chat, the panel):
 * kept apart from its provider so a page's header reads it without
 * anything of the provider's.
 */

export interface ChatPanelSetup {
  /** The new Chat on for the workspace, and Ask Chat on pages for the person. */
  enabled: boolean;
  /** The size it had last (chat_user_prefs.panel_size). */
  size: PanelSize;
  /** "Hi {first name}" in the empty panel (item 21). */
  firstName: string | null;
  /** What the panel's composer starts with (W1-10). */
  defaultMode: ChatMode;
  fullAutoOpen: boolean;
}

export interface ChatPanelState {
  setup: ChatPanelSetup;
  /** The panel is on this page: Ask Chat shows, and the key opens it. */
  available: boolean;
  open: boolean;
  size: PanelSize;
  toggle: () => void;
  close: () => void;
  /** A header size button: the size clicked, Full screen again back to the size before. */
  resize: (clicked: PanelSize) => void;
}

export const ChatPanelContext = createContext<ChatPanelState | null>(null);

/** The side panel; outside its provider (the Chat flag off, a test), never available. */
export function useChatPanel(): ChatPanelState | null {
  return useContext(ChatPanelContext);
}
