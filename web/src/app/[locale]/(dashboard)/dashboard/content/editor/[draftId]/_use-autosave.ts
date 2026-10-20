'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveContentDraft } from '@/lib/actions/content-drafts';
import { AUTOSAVE_DELAY_MS } from '@/lib/content/editor';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed';

interface DraftContent {
  title: string;
  bodyHtml: string;
}

/**
 * The editor's autosave (CE-004). Each change waits for typing to pause,
 * then saves; a change made while a save runs goes out right after it, so
 * saves never overlap and the last one is always the newest text. A failed
 * save keeps the text pending: Retry, or the next change, sends it again.
 * While anything is unsaved, leaving the page asks first.
 */
export function useDraftAutosave(draftId: string) {
  const [state, setState] = useState<SaveState>('saved');
  const pending = useRef<DraftContent | null>(null);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (saving.current || !pending.current) return;
    const content = pending.current;
    pending.current = null;
    saving.current = true;
    setState('saving');
    try {
      await saveContentDraft(draftId, content);
      saving.current = false;
      if (pending.current) {
        // Typed while it saved: that waits for its own pause.
        setState('unsaved');
        timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
      } else {
        setState('saved');
      }
    } catch (err) {
      console.error('Failed to save the draft:', err);
      saving.current = false;
      // Unless something newer is waiting, this text is still to save.
      pending.current ??= content;
      setState('failed');
    }
  }, [draftId]);

  const schedule = useCallback(
    (content: DraftContent) => {
      pending.current = content;
      if (!saving.current) setState('unsaved');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  const unsaved = state !== 'saved';
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Leaving the editor inside the app saves what is waiting.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current && !saving.current) {
        void saveContentDraft(draftId, pending.current).catch((err) =>
          console.error('Failed to save the draft on leaving:', err),
        );
      }
    },
    [draftId],
  );

  return { state, schedule, retry: flush };
}
