'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import { ADD_TRACKING_HREF } from '@/lib/billing/add-on-links';
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
 * A prompt saved waiting starts waiting as it is added; one that started
 * waiting well after (an hour) was tracked, then set waiting because the
 * plan's tracking went down (prompt-capacity.ts). How many, and the latest
 * day it happened; null when none.
 */
export function movedToWaiting(
  prompts: readonly Prompt[],
): { count: number; latest: string } | null {
  let count = 0;
  let latest: string | null = null;
  for (const p of prompts) {
    if (p.isActive || !p.waitingSince) continue;
    if (Date.parse(p.waitingSince) - Date.parse(p.createdAt) <= MOVED_AFTER_MS) continue;
    count++;
    if (!latest || Date.parse(p.waitingSince) > Date.parse(latest)) latest = p.waitingSince;
  }
  return latest ? { count, latest } : null;
}

const MOVED_AFTER_MS = 60 * 60 * 1000;

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
  addMore = false,
}: {
  prompts: readonly Prompt[];
  /** The plan's numbers, from the usage cards; null while they load. */
  quota: LocationQuota | null;
  onShow: () => void;
  /** Opens the swap dialog; undefined for those who can't act. */
  onFreeUp?: () => void;
  /** Growth can buy more tracking (00546): offered beside freeing up a spot. */
  addMore?: boolean;
}) {
  const t = useTranslations('prompts.waiting.banner');
  const format = useFormatter();
  const count = prompts.filter((p) => !p.isActive && p.waitingSince).length;
  if (count === 0) return null;
  const free = !quota ? 0 : quota.maxPrompts === -1 ? null : quota.maxPrompts - quota.used;
  const room = free === null || free > 0;
  const moved = movedToWaiting(prompts);
  const limit = quota && quota.maxPrompts >= 0 ? quota.maxPrompts : null;
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
          {moved && (
            <p data-moved className="text-amber-800/80 dark:text-amber-300/80">
              {t(limit === null ? 'movedNoLimit' : 'moved', {
                count: moved.count,
                date: format.dateTime(new Date(moved.latest), { month: 'short', day: 'numeric' }),
                limit: limit ?? 0,
              })}
            </p>
          )}
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
        {addMore && !room && (
          <Link
            href={ADD_TRACKING_HREF}
            onClick={() => track('add_on_entry', { source: 'waiting_banner' })}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('addTracking')}
          </Link>
        )}
      </div>
    </div>
  );
}
