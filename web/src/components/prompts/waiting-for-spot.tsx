'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { track } from '@/lib/analytics';

/**
 * Prompts someone adds while the plan's prompt locations are all in use are
 * saved "Waiting for a spot" instead of being refused (Simplify PR 15; 00535). They aren't tracked and don't start by themselves when
 * a spot frees up: the person picks them in Tracked Prompts.
 */

export const TRACKED_PROMPTS_HREF = '/dashboard/prompts/tracked';

/** Where a prompt was added from, for the `prompt_saved_waiting` event. */
export type WaitingPath =
  | 'dialog'
  | 'import'
  | 'suggestion'
  | 'add_all'
  | 'track_n'
  | 'untracked_queries'
  | 'page_prompts'
  | 'fanout'
  | 'demand'
  | 'brand_page'
  | 'new_brand'
  | 'topic_card';

/** Counts prompts saved waiting (no-op on self-hosted, as every event is). */
export function trackSavedWaiting(path: WaitingPath, count: number): void {
  if (count > 0) track('prompt_saved_waiting', { path, count });
}

/**
 * The result of an add that saved some prompts waiting: "N added, M waiting
 * for a spot" (or "Saved, but not tracked yet" when none was tracked), what
 * makes room, and the way to Tracked Prompts. Returns whether it showed:
 * nothing waits, nothing shows, and the caller says what it says today.
 */
export function useWaitingForSpotToast() {
  const t = useTranslations('prompts.waiting');
  return useCallback(
    (path: WaitingPath, added: number, waiting: number): boolean => {
      if (waiting <= 0) return false;
      trackSavedWaiting(path, waiting);
      toast.warning(waitingTitle(t, added, waiting), {
        description: t('body', { count: waiting }),
        duration: 10_000,
        action: (
          <Link
            href={TRACKED_PROMPTS_HREF}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('open')}
          </Link>
        ),
      });
      return true;
    },
    [t],
  );
}

/** "N added, M waiting for a spot", or "Saved, but not tracked yet" when none was added. */
export function waitingTitle(
  t: ReturnType<typeof useTranslations<'prompts.waiting'>>,
  added: number,
  waiting: number,
): string {
  return added > 0 ? t('resultTitle', { added, waiting }) : t('savedTitle', { count: waiting });
}
