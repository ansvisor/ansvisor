'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FlaskConical, Loader2, Play, StopCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import {
  getBrandPrompts,
  triggerTrackingCheck,
  type TrackingJobStatus,
  type TrackingWindow,
} from '@/lib/actions/tracking';
import { etaParts, minutesLeft, type ProgressSample } from '@/lib/tracking-eta';

/**
 * Brand Visibility's run controls, in the header every tab shares (they were
 * the Answer Engine Insights page's): Test Single Prompt's dialog, and the
 * bands that say a run is going.
 */

// ─── Run Single Prompt Dialog ─────────────────────────────────────────────────

export function RunSinglePromptDialog({
  brandId,
  open,
  onClose,
  onJobStarted,
}: {
  brandId: string;
  open: boolean;
  onClose: () => void;
  onJobStarted: (jobId: string) => void;
}) {
  const [prompts, setPrompts] = useState<
    { id: string; text: string; category?: string; platforms: string[] }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getBrandPrompts(brandId)
      .then(setPrompts)
      .catch(() => toast.error('Failed to load prompts'))
      .finally(() => setLoading(false));
  }, [open, brandId]);

  const handleRun = async (promptId: string) => {
    setRunningId(promptId);
    try {
      const { jobId } = await triggerTrackingCheck(brandId, { promptId });
      onClose();
      onJobStarted(jobId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run prompt');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Run Single Prompt
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Pick a prompt to test. Only that prompt will run across your enabled platforms.
          </p>
        </DialogHeader>

        <div className="space-y-2 pt-2">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}

          {!loading && prompts.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No active prompts found. Add prompts in brand settings first.
            </p>
          )}

          {!loading &&
            prompts.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{p.text}</p>
                  {p.category && (
                    <Badge variant="outline" className="text-[10px] mt-1">
                      {p.category}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  disabled={runningId !== null}
                  onClick={() => handleRun(p.id)}
                >
                  {runningId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Run
                </Button>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tracking Progress ────────────────────────────────────────────────────────

export function TrackingProgressBanner({
  jobStatus,
  pace,
  onStop,
}: {
  jobStatus: TrackingJobStatus | null;
  /** The run's progress readings while this page polls it, for the time left. */
  pace: ProgressSample[];
  /** Stop: admins and managers only, as the run's start. */
  onStop?: () => void;
}) {
  const t = useTranslations('insights.tracking');
  if (!jobStatus) return null;

  const isActive = jobStatus.status === 'active' || jobStatus.status === 'waiting';
  if (!isActive) return null;

  const progress = jobStatus.progress;
  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;
  const eta = progress ? minutesLeft(pace, progress.total) : null;
  const left = eta === null ? null : etaParts(eta);

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">
            {jobStatus.status === 'waiting' ? t('queued') : t('analyzing')}
          </span>
        </div>
        {onStop && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onStop}
          >
            <StopCircle className="h-3.5 w-3.5" />
            {t('stop')}
          </Button>
        )}
      </div>

      {jobStatus.status === 'waiting' && (
        <p className="text-xs text-muted-foreground">{t('queuedBody')}</p>
      )}

      {jobStatus.status === 'active' && (
        <p className="text-xs text-muted-foreground">
          {/* The pace so far, once there is enough of it; the general range before. */}
          {left === null
            ? t('activeBody')
            : 'hours' in left
              ? t('activeBodyHours', left)
              : t('activeBodyMinutes', left)}
        </p>
      )}

      {progress && progress.total > 0 && (
        <>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          {progress.promptText && (
            <p className="text-xs text-muted-foreground truncate">
              {progress.model && (
                <span className="font-medium text-foreground">
                  {PLATFORM_LABELS[progress.model] ?? progress.model}
                  {progress.region && <span> · {progress.region}</span>}
                  {' — '}
                </span>
              )}
              {progress.promptText}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Banner for runs this browser did NOT start (the daily cron, or a teammate's
 * Run All), or whose saved job this browser no longer restores: detected
 * from the tracking_runs ledger, not localStorage. The dashboard keeps
 * showing the last completed run's numbers until the active run finishes,
 * then swaps in one step. A brand's first run has none to show, and says so.
 */
export function ServerRunBanner({
  run,
  firstRun,
}: {
  run: TrackingWindow['activeRun'];
  /** No completed run yet: nothing older is on the page. */
  firstRun: boolean;
}) {
  const t = useTranslations('insights.tracking');
  if (!run) return null;
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">
          {firstRun ? t('firstRun') : run.source === 'cron' ? t('dailyRun') : t('run')}
        </span>
        <span className="text-xs text-muted-foreground">
          {firstRun ? t('firstRunBody') : t('runBody')}
        </span>
      </div>
    </div>
  );
}
