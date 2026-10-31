'use client';

import { createContext, useContext, useEffect } from 'react';
import type { ChatPageContext } from '@/lib/chat/page-context';
import type { PanelSize } from '@/lib/chat/panel';
import type { ChatReference } from '@/lib/chat/references';
import type { ChatSkillItem } from '@/lib/chat/composer-setup';
import type { ChatMode } from '@/lib/chat/precedence';

/**
 * The side panel's state for what sits on the page (Ask Chat, Ask about
 * this, the page's context, the panel): kept apart from its provider so a
 * page reads it without anything of the provider's.
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
  /** Full auto closed by the Admin's switch, not the plan (CHAT-23). */
  fullAutoOffByAdmin: boolean;
  /** Chat runs on the workspace's own key: a used-up allowance doesn't pause it. */
  onOwnKey: boolean;
  /** The AI usage period whose 80% line the person already saw (CHAT-04 item 16). */
  usageNoticeSeen: string | null;
  /** The / menu's Skills group (CHAT-13 item 5). */
  skills: ChatSkillItem[];
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
  /** What the page on screen says it shows (CHAT-01 item 20); null when it says nothing. */
  page: ChatPageContext | null;
  setPage: (page: ChatPageContext | null) => void;
  /** Something for the panel's box: a question to fill, or an object attached with @. */
  draft: PanelDraft | null;
  /** "Ask about this" (item 22): opens the panel with the object attached. */
  ask: (reference: ChatReference) => void;
  /** A suggestion chip (item 21): the question in the box, not sent. */
  fill: (text: string) => void;
}

/** One hand-off to the panel's composer; `nonce` tells a new one from the last. */
export interface PanelDraft {
  nonce: number;
  text?: string;
  reference?: ChatReference;
}

export const ChatPanelContext = createContext<ChatPanelState | null>(null);

/** The page's context setter on its own, which never changes: what pages read. */
export const ChatPageSetterContext = createContext<((page: ChatPageContext | null) => void) | null>(
  null,
);

/** The side panel; outside its provider (the Chat flag off, a test), never available. */
export function useChatPanel(): ChatPanelState | null {
  return useContext(ChatPanelContext);
}

/**
 * A page tells the side panel what it shows (CHAT-01 items 20–22): its
 * name, date range, filters, suggestions and what can be asked about. The
 * chips follow it while the panel is open; leaving the page takes it back.
 * Outside the panel's provider, or with it off, it does nothing.
 */
export function useChatPageContext(page: ChatPageContext | null): void {
  // The setter alone: the page doesn't render again when the panel changes.
  const setPage = useContext(ChatPageSetterContext);
  // By value: a page builds its context anew on every render.
  const key = page ? JSON.stringify(page) : null;
  useEffect(() => {
    if (!setPage) return;
    setPage(key ? (JSON.parse(key) as ChatPageContext) : null);
    return () => setPage(null);
  }, [setPage, key]);
}
