'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useFailureToast } from '@/hooks/use-failure-toast';
import { trackPromptsNow } from '@/lib/track-now';
import { saveTrackingJob } from '@/lib/tracking-job-store';

/**
 * Track now on Tracked Prompts (the brand's Manage prompts page called it
 * Analyze Prompts): the active prompts with no answers yet, said in the
 * table's status line, and a tracking run for them, or for the selected
 * ones, without leaving the page. The run is saved as the brand's tracking
 * job, so Visibility follows it; the line links there.
 */

/** Where a run's progress and its answers show: Visibility, which follows the saved job. */
export const TRACK_NOW_ANSWERS_HREF = '/dashboard/insights';

interface Asked {
  brandId: string;
  ids: Set<string>;
}

/**
 * The prompts with no answers yet, and Track now for some of them.
 *
 * `ids`: the brand's active prompts with no answers yet, as the table's own
 * read gives them (getPromptsPageData, for admins and managers), read again
 * with it after the prompts change; null when unread, or for those who
 * can't track. `activeIds`: the brand's active prompts on the page; a
 * prompt without answers counts only while it is one of them.
 */
export function useTrackNow({
  brandId,
  ids: withoutAnswers,
  activeIds,
}: {
  brandId: string | null;
  ids: readonly string[] | null;
  activeIds: ReadonlySet<string>;
}) {
  const t = useTranslations('prompts.trackNow');
  const failureToast = useFailureToast();
  // Asked for in this visit: left out of the count, as the brand's page did.
  const [asked, setAsked] = useState<Asked | null>(null);
  const [starting, setStarting] = useState(false);
  // The run started from here, for the status line.
  const [started, setStarted] = useState<{ brandId: string; count: number } | null>(null);

  const ids = useMemo(() => {
    // Unread, the line says nothing: a failed read isn't "no answers".
    if (!brandId || !withoutAnswers) return [];
    const done = asked?.brandId === brandId ? asked.ids : null;
    return withoutAnswers.filter((id) => activeIds.has(id) && !done?.has(id));
  }, [brandId, withoutAnswers, asked, activeIds]);
  const noAnswers = useMemo(() => new Set(ids), [ids]);

  const start = useCallback(
    async (promptIds: string[]) => {
      if (!brandId || promptIds.length === 0 || starting) return;
      setStarting(true);
      try {
        const result = await trackPromptsNow(brandId, promptIds);
        if (!result.ok) {
          // The plan isn't active: the upgrade dialog, as the guarded buttons do.
          if (result.status === 402) failureToast('subscription');
          else
            toast.error(t('failed'), result.message ? { description: result.message } : undefined);
          return;
        }
        // Started, or answered meanwhile: either way, these have nothing left to start.
        setAsked((prev) => ({
          brandId,
          ids: new Set([...(prev?.brandId === brandId ? prev.ids : []), ...promptIds]),
        }));
        if (result.jobId === null) {
          toast.info(t('alreadyAnswered'));
          return;
        }
        saveTrackingJob({ jobId: result.jobId, brandId, startedAt: Date.now() });
        setStarted({ brandId, count: result.count });
        toast.success(t('startedToast', { count: result.count }), {
          description: t('startedBody'),
        });
      } finally {
        setStarting(false);
      }
    },
    [brandId, starting, failureToast, t],
  );

  return {
    /** The active prompts with no answers yet, those asked for here aside. */
    noAnswers,
    starting,
    /** How many the run started from here tracks, on this brand; null before one. */
    startedCount: started && started.brandId === brandId ? started.count : null,
    start,
  };
}

/**
 * "● 3 prompts have no answers yet · Track now" in the table's status line,
 * then "● Tracking 3 prompts now · See answers" once a run starts. Track now
 * is left out for those who can't track (the line isn't shown to them).
 */
export function TrackNowLine({
  count,
  starting,
  startedCount,
  onTrack,
}: {
  /** Active prompts with no answers yet. */
  count: number;
  starting: boolean;
  /** The run started from here, if any. */
  startedCount: number | null;
  onTrack: () => void;
}) {
  const t = useTranslations('prompts.trackNow');
  if (count === 0 && startedCount === null && !starting) return null;
  const linkClass =
    'rounded-sm font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';
  return (
    <>
      {startedCount !== null && (
        <p
          data-track-now="started"
          role="status"
          className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
        >
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span>{t('started', { count: startedCount })}</span>
          <span aria-hidden>·</span>
          <Link href={TRACK_NOW_ANSWERS_HREF} className={linkClass}>
            {t('seeAnswers')}
          </Link>
        </p>
      )}
      {(count > 0 || starting) && (
        <p
          data-track-now="waiting"
          className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
          title={t('hint')}
        >
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
          {starting ? (
            <span role="status" className="inline-flex items-center gap-1">
              <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
              {t('starting')}
            </span>
          ) : (
            <>
              <span>{t('count', { count })}</span>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={onTrack}
                aria-label={t('trackLabel', { count })}
                className={linkClass}
              >
                {t('track')}
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}
