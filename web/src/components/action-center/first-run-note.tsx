'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { getJobStatus, getTrackingWindow, type TrackingJobStatus } from '@/lib/actions/tracking';
import { loadTrackingJob } from '@/lib/tracking-job-store';

/** How often the note reads again while the first run goes on. */
const POLL_MS = 30_000;

/** A saved job the worker hasn't finished: queued, delayed or running. */
const LIVE_JOB = new Set<TrackingJobStatus['status']>(['waiting', 'delayed', 'active']);

interface FirstRun {
  brandId: string;
  /** Queued: the worker hasn't started it, so the ledger has no row yet. */
  queued: boolean;
  progress: TrackingJobStatus['progress'];
}

/**
 * "First analysis running" on the Action Center (#1238's review): after the
 * payment, a new brand or onboarding, people land on Actions while the first
 * tracking run is still going, and only Visibility showed it. Shown while the
 * brand has no completed run and one is under way: from the tracking_runs
 * ledger (any browser's run), or, while the job still waits for the worker,
 * from the job this browser saved (TrackingJobHandoff), which also gives the
 * progress. It stops reading once the brand has a completed run.
 */
export function FirstRunNote() {
  const t = useTranslations('actionCenter.firstRun');
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [run, setRun] = useState<FirstRun | null>(null);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const win = await getTrackingWindow(brandId).catch(() => null);
      if (cancelled) return;
      if (win?.lastRunAt) {
        // The first run is done: this brand never needs the note again.
        setRun(null);
        return;
      }
      // A failed read keeps what the note says until the next one.
      if (win) {
        const saved = loadTrackingJob();
        const job =
          saved?.brandId === brandId ? await getJobStatus(saved.jobId).catch(() => null) : null;
        if (cancelled) return;
        const live = job !== null && LIVE_JOB.has(job.status);
        setRun(
          win.activeRun || live
            ? {
                brandId,
                queued: !win.activeRun && job?.status !== 'active',
                progress: live ? job.progress : null,
              }
            : null,
        );
      }
      timer = setTimeout(tick, POLL_MS);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [brandId]);

  // Another brand's run never shows under this one.
  if (!run || run.brandId !== brandId) return null;
  const { progress } = run;

  return (
    <div role="status" className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
        <span className="text-sm font-medium">{run.queued ? t('queued') : t('running')}</span>
        {progress && progress.total > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('progress', { current: progress.current, total: progress.total })}
          </span>
        )}
        <Link
          href="/dashboard/insights"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {t('link')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {run.queued ? t('queuedBody') : t('runningBody')}
      </p>
    </div>
  );
}
