'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ListDotState } from '@/components/agentic/list-dot';
import type { ScheduleListItem, ScheduleRunView } from '@/lib/chat/schedule/views';
import { dateWords, whenWords, type WhenWords } from '@/lib/chat/schedule/when';

/** A run's status as the list's dot (Chat agentic plan §2). */
export function runDotOf(status: string): ListDotState {
  switch (status) {
    case 'running':
      return 'running';
    case 'needs_you':
      return 'needsYou';
    case 'done':
    case 'unchanged':
      return 'done';
    case 'failed':
      return 'failed';
    case 'paused_cap':
      return 'paused';
    default:
      return 'idle';
  }
}

/**
 * The Scheduled page's words (CHAT-12 items 22, 24; mockup `#s-sched`): a
 * job's When on its own clock ("Every Monday, 09:00"), its next run or why
 * it is paused, its last run's status and parts, where its result goes and
 * its mode. `now` is fixed in tests.
 */
export function useScheduleWords(now: Date) {
  const t = useTranslations('chatSchedules.page');
  const tWhen = useTranslations('chatSchedules.when') as unknown as WhenWords;
  return useMemo(() => {
    const date = (iso: string, zone?: string) => dateWords(iso, zone ?? 'UTC', now, tWhen);
    return {
      date,
      when: (job: Pick<ScheduleListItem, 'when' | 'timezone' | 'dueAt' | 'kind'>) =>
        job.when
          ? whenWords(job.when, job.timezone, now, tWhen)
          : job.dueAt
            ? date(job.dueAt, job.timezone)
            : '',
      /** The When column's line under it: the next run, or why it is off. */
      next: (job: ScheduleListItem) => {
        if (!job.enabled) {
          return job.pausedReason && t.has(`pausedWhy.${job.pausedReason}`)
            ? t(`pausedWhy.${job.pausedReason}`)
            : t('paused');
        }
        return job.nextRunAt ? t('next', { date: date(job.nextRunAt, job.timezone) }) : null;
      },
      status: (run: ScheduleRunView) =>
        t.has(`status.${run.status}`) ? t(`status.${run.status}`) : run.status,
      /** A run's line under its date: its parts, its reason, or that it was emailed. */
      runLine: (run: ScheduleRunView) =>
        [
          run.partsTotal > 1 ? t('parts', { done: run.partsDone, total: run.partsTotal }) : null,
          run.reason,
          run.emailed ? t('emailed') : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      deliver: (job: Pick<ScheduleListItem, 'deliver'>) => t(`deliverTo.${job.deliver}`),
      mode: (mode: string) => (t.has(`mode.${mode}`) ? t(`mode.${mode}`) : mode),
    };
  }, [now, t, tWhen]);
}

export type ScheduleWords = ReturnType<typeof useScheduleWords>;
