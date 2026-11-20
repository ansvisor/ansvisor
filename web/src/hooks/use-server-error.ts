'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { caughtErrorText, serverErrorKey } from '@/lib/server-error';

/**
 * What to tell the person about a failed call (LOC-008): the refusal's words
 * in their language when the server's stable code is one we map
 * (lib/server-error.ts), else `fallback`: the server's own sentence where a
 * caller showed it before, or the caller's own translated message.
 */
export function useServerErrorText() {
  const t = useTranslations();
  return useCallback(
    (body: unknown, fallback: string, status = 0): string => {
      const key = serverErrorKey(body, status);
      return key ? t(key) : fallback;
    },
    [t],
  );
}

/**
 * The same for an error a `catch` caught: the refusal's words when its code
 * (or a server action's digest) is one we map, else the error's own message
 * when the browser threw it, else `fallback` (caughtErrorText).
 */
export function useCaughtErrorText() {
  const t = useTranslations();
  return useCallback(
    (err: unknown, fallback: string): string => {
      const status = (err as { status?: unknown } | null)?.status;
      const key = serverErrorKey(err, typeof status === 'number' ? status : 0);
      return key ? t(key) : caughtErrorText(err, fallback);
    },
    [t],
  );
}
