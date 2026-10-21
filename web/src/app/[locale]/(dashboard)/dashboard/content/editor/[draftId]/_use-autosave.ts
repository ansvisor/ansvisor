'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveContentDraft } from '@/lib/actions/content-drafts';
import { AUTOSAVE_DELAY_MS, MAX_BODY_HTML_LENGTH, bodyHash } from '@/lib/content/editor';

/**
 * Where the page stands: conflict when someone else changed it meanwhile
 * (nothing more saves until it's reloaded), too_large when it's over the
 * limit (nothing saves until it's shorter).
 */
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed' | 'conflict' | 'too_large';

/** How long settle() waits for saves before giving up. */
const SETTLE_TIMEOUT_MS = 15_000;

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
 *
 * Each save goes only over the version this editor loaded or last saved, so
 * a page someone else changed meanwhile is never overwritten: the editor says
 * so and stops saving until it's reloaded. A page over the size limit isn't
 * sent at all.
 *
 * Before a step that reads the saved page (Mark ready keeps it in History) or
 * replaces it (a restore), settle() saves what is waiting and waits for a
 * save under way, and throws when the page isn't saved; discard() drops what
 * is waiting once the server's page has replaced it, and saves go on from
 * that version.
 */
export function useDraftAutosave(draftId: string, loaded: { updatedAt: string; bodyHtml: string }) {
  const [state, setState] = useState<SaveState>('saved');
  const pending = useRef<DraftContent | null>(null);
  const saving = useRef(false);
  const failed = useRef(false);
  // Changed elsewhere: nothing more is saved over it.
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The version saves go over; its hash is worked out at the first save.
  const base = useRef<{ updatedAt: string; bodyHash: string | null }>({
    updatedAt: loaded.updatedAt,
    bodyHash: null,
  });
  const loadedBody = useRef(loaded.bodyHtml);

  const baseVersion = useCallback(async () => {
    base.current.bodyHash ??= await bodyHash(loadedBody.current);
    return { updatedAt: base.current.updatedAt, bodyHash: base.current.bodyHash };
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (stopped.current || saving.current || !pending.current) return;
    const content = pending.current;
    if (content.bodyHtml.length > MAX_BODY_HTML_LENGTH) {
      failed.current = true;
      setState('too_large');
      return;
    }
    pending.current = null;
    saving.current = true;
    setState('saving');
    try {
      const result = await saveContentDraft(draftId, { ...content, base: await baseVersion() });
      saving.current = false;
      if (!result.ok) {
        // Unless something newer is waiting, this text is still to save.
        pending.current ??= content;
        failed.current = true;
        if (result.reason === 'conflict') stopped.current = true;
        setState(
          result.reason === 'conflict'
            ? 'conflict'
            : result.reason === 'too_large'
              ? 'too_large'
              : 'failed',
        );
        return;
      }
      base.current = { updatedAt: result.updatedAt, bodyHash: result.bodyHash };
      failed.current = false;
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
      failed.current = true;
      pending.current ??= content;
      setState('failed');
    }
  }, [draftId, baseVersion]);

  const schedule = useCallback(
    (content: DraftContent) => {
      pending.current = content;
      if (stopped.current) return;
      clearTimeout(timer.current);
      if (content.bodyHtml.length > MAX_BODY_HTML_LENGTH) {
        // Nothing to send until it's shorter.
        failed.current = true;
        if (!saving.current) setState('too_large');
        return;
      }
      if (!saving.current) setState('unsaved');
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  /** Saves what is waiting and waits for a save under way; throws when the page isn't saved. */
  const settle = useCallback(async () => {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (saving.current || pending.current) {
      if (stopped.current || Date.now() > deadline) throw new Error('unsaved');
      if (saving.current) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      await flush();
      if (failed.current) throw new Error('unsaved');
    }
  }, [flush]);

  /** Drops what is waiting to save: the server's page replaced it, and saves go on from it. */
  const discard = useCallback((version: { updatedAt: string; bodyHtml: string }) => {
    clearTimeout(timer.current);
    pending.current = null;
    failed.current = false;
    stopped.current = false;
    base.current = { updatedAt: version.updatedAt, bodyHash: null };
    loadedBody.current = version.bodyHtml;
    if (!saving.current) setState('saved');
  }, []);

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
      const content = pending.current;
      if (
        !content ||
        saving.current ||
        stopped.current ||
        content.bodyHtml.length > MAX_BODY_HTML_LENGTH
      ) {
        return;
      }
      void baseVersion()
        .then((version) => saveContentDraft(draftId, { ...content, base: version }))
        .catch((err) => console.error('Failed to save the draft on leaving:', err));
    },
    [draftId, baseVersion],
  );

  return { state, schedule, retry: flush, settle, discard };
}
