'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { FileText, FlaskConical, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';
import { usePlanContext } from '@/components/providers/plan-provider';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { useUserRole } from '@/hooks/use-user-role';
import { Link, usePathname } from '@/i18n/navigation';
import {
  cancelTrackingJob,
  getJobStatus,
  triggerTrackingCheck,
  type TrackingJobStatus,
  type TrackingWindow,
} from '@/lib/actions/tracking';
import { brandVisibilityTabOf } from '@/lib/brand-visibility';
import {
  clearTrackingJob,
  doneMessage,
  loadTrackingJob,
  saveTrackingJob,
} from '@/lib/tracking-job-store';
import { withSample, type ProgressSample } from '@/lib/tracking-eta';
import { writeUrlParams } from '@/lib/url-state';
import { cn } from '@/lib/utils';
import { getTrackingWindow } from '@/lib/visibility-reads';
import { useBrandStore } from '@/stores/use-brand-store';
import { createReadCache } from './read-cache';
import { RunLine } from './run-line';
import { RunSinglePromptDialog, ServerRunBanner, TrackingProgressBanner } from './run-controls';
import { BrandVisibilityShellContext, type BrandVisibilityShell } from './shell-context';
import { BrandVisibilityTabs } from './tabs';

/** How often the run ledger is read for the run line and a run going on. */
export const RUN_LINE_POLL_MS = 60_000;

/** A read every ~10 s while a run this browser started brings answers in. */
const RUNNING_REFRESH_MS = 10_000;

type RunTimes = Pick<TrackingWindow, 'lastRunAt' | 'nextRunAt'>;

/**
 * Brand Visibility's shared layout (the owner's mockup): the title, the run
 * line ("Acme · Last run 11h ago · next run in 13h") and the actions, then
 * the tabs, then the band of a run going on, then the tab. It needs no data
 * of its own to draw, so it shows at once; the run line's times arrive by
 * themselves. It stays mounted while the tab under it changes, and so do
 * the runs it starts and watches (they were the Insights page's), and what
 * the tabs last read (`cache`), so a tab opened again shows at once.
 */
export function BrandVisibilityShellView({ children }: { children: ReactNode }) {
  const t = useTranslations('brandVisibility');
  const tInsights = useTranslations('insights');
  const tActions = useTranslations('readOnly.actions');
  const pathname = usePathname();
  const tab = brandVisibilityTabOf(pathname);
  const brandId = useBrandStore((s) => s.activeBrandId);
  const brand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);
  const { isCloud } = usePlanContext();
  // A read-only workspace (plan not active): Run All and Test Single Prompt
  // open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  // Running tracking now (or stopping it) spends the plan's checks: admins and managers.
  const { canManage } = useUserRole();
  // The job poll's toasts read it: the loop outlives a render.
  const tRef = useRef(tInsights);
  useLayoutEffect(() => {
    tRef.current = tInsights;
  }, [tInsights]);

  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const refresh = useCallback(() => setRefreshes((n) => n + 1), []);

  // ── The run line, from the ledger ─────────────────────────────────────────
  // Null until read for this brand: the line shows a placeholder, never
  // another brand's times.
  const [runTimes, setRunTimes] = useState<(RunTimes & { brandId: string }) | null>(null);
  const [cronRun, setCronRun] = useState<TrackingWindow['activeRun']>(null);
  const cronRunRef = useRef<TrackingWindow['activeRun']>(null);
  const [facts, setFacts] = useState<{
    brandId: string;
    hasData: boolean;
    lastCheckedAt: string | null;
  } | null>(null);
  // The brand a read was for is checked against the one shown when it lands.
  const brandRef = useRef(brandId);
  useLayoutEffect(() => {
    brandRef.current = brandId;
  }, [brandId]);

  const applyWindow = useCallback(
    (win: TrackingWindow, forBrand: string | null) => {
      if (!forBrand || forBrand !== brandRef.current) return;
      const wasRunning = cronRunRef.current !== null;
      cronRunRef.current = win.activeRun;
      setCronRun(win.activeRun);
      // Kept as is when unchanged, so the minute's read doesn't re-render the page.
      setRunTimes((prev) =>
        prev &&
        prev.brandId === forBrand &&
        prev.lastRunAt === win.lastRunAt &&
        prev.nextRunAt === win.nextRunAt
          ? prev
          : { brandId: forBrand, lastRunAt: win.lastRunAt, nextRunAt: win.nextRunAt },
      );
      // A run seen going has finished: the tab reads its data again.
      if (wasRunning && !win.activeRun) refresh();
    },
    [refresh],
  );

  useEffect(() => {
    cronRunRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- another brand's run isn't this one's
    setCronRun(null);
  }, [brandId]);

  // Read beside the tab's own reads, not after them: they are fetches, which
  // the browser runs side by side.
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    const tick = async () => {
      const win = await getTrackingWindow(brandId).catch(() => null);
      if (!cancelled && win) applyWindow(win, brandId);
    };
    void tick();
    const id = setInterval(tick, RUN_LINE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [brandId, applyWindow]);

  const reportRunWindow = useCallback(
    (win: TrackingWindow) => applyWindow(win, brandRef.current),
    [applyWindow],
  );
  const reportData = useCallback((next: { hasData: boolean; lastCheckedAt: string | null }) => {
    const id = brandRef.current;
    if (!id) return;
    setFacts((prev) =>
      prev &&
      prev.brandId === id &&
      prev.hasData === next.hasData &&
      prev.lastCheckedAt === next.lastCheckedAt
        ? prev
        : { brandId: id, ...next },
    );
  }, []);

  // ── What the tabs read, and the tabs ahead ────────────────────────────────
  const [cache] = useState(createReadCache);
  // Once the open tab's figures are on screen, the other tabs are prefetched,
  // so a switch has nothing to wait for but its own reads.
  const [warm, setWarm] = useState(false);
  const shown = useCallback(() => setWarm(true), []);

  // ── Runs this browser starts ──────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<TrackingJobStatus | null>(null);
  // The tracking job's pace while this page polls it ("about N min left").
  const [pace, setPace] = useState<ProgressSample[]>([]);
  const [showSinglePrompt, setShowSinglePrompt] = useState(false);

  // Restore the active job from localStorage or the address (post-payment redirect).
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!brandId) return;
    const urlJobId = searchParams.get('jobId');
    if (urlJobId) {
      saveTrackingJob({ jobId: urlJobId, brandId, startedAt: Date.now() });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the job the address hands over
      setActiveJobId(urlJobId);
      setIsRunning(true);
      writeUrlParams({ jobId: null });
      return;
    }
    const saved = loadTrackingJob();
    if (saved && saved.brandId === brandId) {
      setActiveJobId(saved.jobId);
      setIsRunning(true);
    }
  }, [brandId, searchParams]);

  // Poll the job's status while it is active.
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    let lastRefresh = 0;
    const poll = async () => {
      while (!cancelled) {
        try {
          const status = await getJobStatus(activeJobId);
          if (cancelled) break;
          setJobStatus(status);
          const current = status.progress?.current;
          if (current !== undefined) {
            setPace((prev) => withSample(prev, { at: Date.now(), current }));
          }
          // New results appear as they come in.
          const now = Date.now();
          if (status.status === 'active' && now - lastRefresh > RUNNING_REFRESH_MS) {
            lastRefresh = now;
            refresh();
          }
          if (status.status === 'completed') {
            clearTrackingJob();
            setActiveJobId(null);
            setIsRunning(false);
            setJobStatus(null);
            const done = doneMessage(status.result);
            toast.success(tRef.current(`tracking.${done.key}`, 'count' in done ? done : undefined));
            refresh();
            break;
          }
          if (status.status === 'failed' || status.status === 'not_found') {
            clearTrackingJob();
            setActiveJobId(null);
            setIsRunning(false);
            setJobStatus(null);
            if (status.status === 'failed') {
              toast.error(
                tRef.current('tracking.failed', {
                  reason: status.failedReason ?? tRef.current('tracking.unknownError'),
                }),
              );
            }
            break;
          }
        } catch {
          // A network error: keep polling.
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [activeJobId, refresh]);

  const startJob = useCallback(
    (jobId: string) => {
      if (!brandId) return;
      setIsRunning(true);
      saveTrackingJob({ jobId, brandId, startedAt: Date.now() });
      setActiveJobId(jobId);
      setJobStatus({ status: 'waiting', progress: null, result: null, failedReason: null });
    },
    [brandId],
  );

  const handleRunPrompts = async () => {
    if (!brandId) return;
    setIsRunning(true);
    try {
      const { jobId } = await triggerTrackingCheck(brandId);
      startJob(jobId);
    } catch (err) {
      setIsRunning(false);
      toast.error(err instanceof Error ? err.message : 'Failed to trigger tracking');
    }
  };

  const handleStopTracking = async () => {
    if (!activeJobId) return;
    try {
      await cancelTrackingJob(activeJobId);
    } catch {}
    clearTrackingJob();
    setActiveJobId(null);
    setIsRunning(false);
    setJobStatus(null);
    toast.success('Tracking stopped');
    refresh();
  };

  const canRun = !isCloud && canManage;
  const runAll = guard(handleRunPrompts, { action: tActions('runPrompts') });
  const openSinglePrompt = guard(() => setShowSinglePrompt(true), {
    action: tActions('testPrompt'),
  });
  // The tab gets steady handles that call this render's actions, so a run
  // poll's re-render doesn't re-render the tab.
  const actionsRef = useRef({ runAll, openSinglePrompt });
  useLayoutEffect(() => {
    actionsRef.current = { runAll, openSinglePrompt };
  });
  const stableRunAll = useCallback(() => actionsRef.current.runAll(), []);
  const stableOpenSinglePrompt = useCallback(() => actionsRef.current.openSinglePrompt(), []);

  const value = useMemo<BrandVisibilityShell>(
    () => ({
      actionsSlot,
      refreshes,
      isRunning,
      runAll: canRun ? stableRunAll : undefined,
      openSinglePrompt: canRun ? stableOpenSinglePrompt : undefined,
      reportRunWindow,
      reportData,
      cache,
      shown,
    }),
    [
      actionsSlot,
      refreshes,
      isRunning,
      canRun,
      stableRunAll,
      stableOpenSinglePrompt,
      reportRunWindow,
      reportData,
      cache,
      shown,
    ],
  );

  // The band this browser's job draws (with progress and Stop) wins; the
  // ledger's covers every other run.
  const localJobActive =
    jobStatus !== null && (jobStatus.status === 'active' || jobStatus.status === 'waiting');
  const times = runTimes && runTimes.brandId === brandId ? runTimes : null;
  const known = facts && facts.brandId === brandId ? facts : null;

  return (
    <BrandVisibilityShellContext.Provider value={value}>
      <div className="space-y-6">
        <HeaderWithAiUsage>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
              {brand && (
                // The brand's last full run from the ledger; before the ledger
                // has one, the newest answer the Overview read.
                <RunLine
                  brandName={brand.name}
                  loading={times === null}
                  lastRunAt={times?.lastRunAt ?? known?.lastCheckedAt ?? null}
                  nextRunAt={times?.nextRunAt ?? null}
                  // Unknown off the Overview: say nothing rather than "No runs yet".
                  hasData={known?.hasData ?? true}
                />
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {/* The tab's own actions (Export CSV, Copy summary) land here. */}
              <div ref={setActionsSlot} className="contents" data-testid="tab-actions" />
              <Link href="/dashboard/reports" className={cn(buttonVariants(), 'gap-2')}>
                <FileText className="h-4 w-4" />
                {t('actions.reports')}
              </Link>
              {/* Self-host only, for admins and managers. */}
              {canRun && (
                <>
                  <Button variant="outline" onClick={openSinglePrompt} className="gap-2">
                    <FlaskConical className="h-4 w-4" />
                    {t('actions.testSinglePrompt')}
                  </Button>
                  <Button onClick={runAll} disabled={isRunning} className="gap-2">
                    {isRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {t('actions.runAll')}
                  </Button>
                </>
              )}
            </div>
          </div>
        </HeaderWithAiUsage>

        <BrandVisibilityTabs current={tab} prefetch={warm} />

        <TrackingProgressBanner
          jobStatus={jobStatus}
          pace={pace}
          onStop={canManage ? handleStopTracking : undefined}
        />
        {!localJobActive && <ServerRunBanner run={cronRun} firstRun={!times?.lastRunAt} />}

        {children}
      </div>

      {brandId && (
        <RunSinglePromptDialog
          brandId={brandId}
          open={showSinglePrompt}
          onClose={() => setShowSinglePrompt(false)}
          onJobStarted={startJob}
        />
      )}
    </BrandVisibilityShellContext.Provider>
  );
}
