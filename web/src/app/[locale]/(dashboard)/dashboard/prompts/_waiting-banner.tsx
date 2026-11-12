'use client';

import { useTranslations } from 'next-intl';
import { Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LocationQuota } from '@/lib/actions/prompt';
import type { Prompt } from '@/types';

/** The brand's prompt that has waited for a spot the longest; null when none waits. */
export function oldestWaiting(prompts: readonly Prompt[]): Prompt | null {
  let oldest: Prompt | null = null;
  for (const p of prompts) {
    if (p.isActive || !p.waitingSince) continue;
    if (!oldest || Date.parse(p.waitingSince) < Date.parse(oldest.waitingSince!)) oldest = p;
  }
  return oldest;
}

/**
 * Tracked Prompts' yellow banner while prompts wait for a spot (Simplify
 * PR 16): how many, whether the plan has room now (waiting prompts
 * never start by themselves), the waiting ones a click away, and for those
 * who can act, the swap dialog for the one waiting longest. Members and a
 * plan that ended see the banner without the action.
 */
export function WaitingBanner({
  prompts,
  quota,
  onShow,
  onFreeUp,
}: {
  prompts: readonly Prompt[];
  /** The plan's numbers, from the usage cards; null while they load. */
  quota: LocationQuota | null;
  onShow: () => void;
  /** Opens the swap dialog; undefined for those who can't act. */
  onFreeUp?: () => void;
}) {
  const t = useTranslations('prompts.waiting.banner');
  const count = prompts.filter((p) => !p.isActive && p.waitingSince).length;
  if (count === 0) return null;
  const free = !quota ? 0 : quota.maxPrompts === -1 ? null : quota.maxPrompts - quota.used;
  const room = free === null || free > 0;
  return (
    <div
      role="status"
      data-waiting-banner
      className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50 dark:bg-amber-950/30"
    >
      <div className="flex items-start gap-2.5">
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">{t('title', { count })}</p>
          <p className="text-amber-800/80 dark:text-amber-300/80">
            {free === null ? t('bodyUnlimited') : room ? t('bodyRoom', { free }) : t('body')}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onShow}>
          {t('show')}
        </Button>
        {onFreeUp && (
          <Button size="sm" onClick={onFreeUp}>
            {room ? t('track') : t('freeUp')}
          </Button>
        )}
      </div>
    </div>
  );
}
