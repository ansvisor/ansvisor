'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { create } from 'zustand';
import { readChatDateRange, saveChatDateRange } from '@/lib/actions/chat-range';
import type { ChatRange } from '@/lib/chat/range';

/**
 * The person's Chat date range in this browser (chat_user_prefs.date_range,
 * 00528), shared by the line under every message box and Chat Settings, so
 * a change in one shows in the other at once. Read from the server once a
 * visit, and again when a run ends (its range card or a short range may have
 * changed it). Never kept in the browser.
 */
interface RangeState {
  range: ChatRange | null;
  /** It can be read and kept: the new Chat is on and the database has 00528. */
  available: boolean;
}

interface RangeStore {
  /** Undefined until read. */
  state: RangeState | undefined;
  set: (state: RangeState) => void;
}

export const useChatRangeStore = create<RangeStore>()((set) => ({
  state: undefined,
  set: (state) => set({ state }),
}));

let reading: Promise<void> | null = null;

/** Reads the person's range from the server, once at a time; one that can't be read hides it. */
function readRange(): Promise<void> {
  if (reading) return reading;
  const read = async () => {
    let next: RangeState = { range: null, available: false };
    try {
      const kept = await readChatDateRange();
      if (kept.ok) next = { range: kept.range, available: true };
    } catch {
      // Not read: the line and the setting stay hidden.
    }
    useChatRangeStore.getState().set(next);
  };
  reading = read().finally(() => {
    reading = null;
  });
  return reading;
}

/**
 * The person's range and how to change it. `running`: a run is working in
 * this box; when it ends the range is read again.
 */
export function useChatRange(running = false) {
  const t = useTranslations('chatRange');
  const state = useChatRangeStore((store) => store.state);
  const set = useChatRangeStore((store) => store.set);

  useEffect(() => {
    if (state === undefined) void readRange();
  }, [state]);

  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void readRange();
    wasRunning.current = running;
  }, [running]);

  /** Keeps a new range (null: ask again); one that isn't kept goes back and says so. */
  const save = async (range: ChatRange | null): Promise<boolean> => {
    const before = useChatRangeStore.getState().state;
    set({ range, available: true });
    const saved = await saveChatDateRange(range).catch(() => ({ ok: false }));
    if (!saved.ok) {
      if (before) set(before);
      toast.error(t('saveFailed'));
    }
    return saved.ok;
  };

  return {
    range: state?.range ?? null,
    available: state?.available === true,
    save,
  };
}
