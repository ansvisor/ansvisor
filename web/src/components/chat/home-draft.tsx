'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { ShortcutId } from '@/lib/chat/shortcuts';
import type { ComposerDraft } from './composer/chat-composer';

/**
 * Chat Home's box, filled from the page above it (CHAT-11 item 9; W4-21):
 * What's new's Show me puts "What's new: how can {feature} help me?" in it
 * and doesn't send. Only Home has it: elsewhere the box takes the page's
 * own draft. Home's chat, too: once a message is sent, from the box or a
 * question picked on the page, the page gives way and the chat shows as
 * its own page at once (owner, 2026-11-09).
 */
const HomeDraft = createContext<{
  draft: ComposerDraft | null;
  fill: (text: string) => void;
  /** A chat started from Home: its page above gives way to the chat (owner, 2026-11-09). */
  started: boolean;
  setStarted: (started: boolean) => void;
  /** Sends a message in Home's chat, at once; false before the chat below registered. */
  send: (message: string, shortcutId?: ShortcutId) => boolean;
  /** The chat below sets how Home's page sends, or takes it back. */
  registerSend: (send: HomeSend | null) => void;
} | null>(null);

/** How Home's chat sends a message picked on the page above it. */
export type HomeSend = (message: string, shortcutId?: ShortcutId) => void;

export function HomeDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  const [started, setStarted] = useState(false);
  const sender = useRef<HomeSend | null>(null);
  const send = useCallback((message: string, shortcutId?: ShortcutId) => {
    if (!sender.current) return false;
    sender.current(message, shortcutId);
    return true;
  }, []);
  const registerSend = useCallback((next: HomeSend | null) => {
    sender.current = next;
  }, []);
  return (
    <HomeDraft.Provider
      value={{
        draft,
        // Its own nonces, never the page's (?compose= is 1): each Show me fills the box again.
        fill: (text) =>
          setDraft((was) => ({ nonce: Math.max(Date.now(), (was?.nonce ?? 0) + 1), text })),
        started,
        setStarted,
        send,
        registerSend,
      }}
    >
      {children}
    </HomeDraft.Provider>
  );
}

/**
 * Home's chat as the page and its box share it: whether one started, and
 * how the page sends into it. Null outside Home.
 */
export function useHomeChat() {
  const home = useContext(HomeDraft);
  return home
    ? {
        started: home.started,
        setStarted: home.setStarted,
        send: home.send,
        registerSend: home.registerSend,
      }
    : null;
}

/** What Home's page put in the box; null outside Home. */
export function useHomeDraft(): ComposerDraft | null {
  return useContext(HomeDraft)?.draft ?? null;
}

/** Puts text in Home's box, without sending it; nothing outside Home. */
export function useFillHomeDraft(): ((text: string) => void) | null {
  return useContext(HomeDraft)?.fill ?? null;
}
