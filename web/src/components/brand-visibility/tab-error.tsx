'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ReadError } from './read-error';

/**
 * A Brand Visibility tab that broke while drawing (its error.tsx): the
 * header and the other tabs stay, and Retry draws this tab again.
 */
export function TabError({
  error,
  reset,
  title,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** What couldn't load, as the tab names it. */
  title: string;
}) {
  const router = useRouter();
  useEffect(() => {
    console.error('[brand-visibility] a tab failed to draw', error);
  }, [error]);
  return (
    <ReadError
      title={title}
      onRetry={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
    />
  );
}
