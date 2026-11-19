'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { serverErrorKey } from '@/lib/server-error';

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
