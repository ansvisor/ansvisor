'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useCaughtErrorText, useServerErrorText } from '@/hooks/use-server-error';
import { toast } from 'sonner';
import {
  Search,
  Loader2,
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  RefreshCw,
  Pin,
  EyeOff,
  Layers,
  Settings,
} from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useRecentAudit } from '@/components/audit/use-recent-audit';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { qualityPhase } from '@/lib/content/quality';
import { useBrandStore } from '@/stores/use-brand-store';
import { useUserRole } from '@/hooks/use-user-role';
import { useDotViewer } from '@/components/layout/menu-dot';
import { PageDot } from '@/components/layout/page-dot';
import { markPageSeen, readPageSeen } from '@/lib/actions/user-brand-state';
import { autoAuditDots, opportunityDots, pickDot } from '@/lib/page-dots';
import type { PageSeenKey } from '@/lib/user-brand-state';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { isNoPlan } from '@/lib/billing/no-plan';
import {
  runAudit,
  runAuditsBulk,
  getAuditPages,
  getAuditHub,
  getAuditHubExtras,
  setOpportunityPrefs,
  getAuditSettings,
  getAuditTemplates,
  saveAuditSettings,
  deleteAudit,
  type AutoAuditRun,
  type AuditTemplate,
  type AuditedPage,
  type RecentAudit,
  type AuditOverview,
  type AuditOpportunities,
  type AuditOpportunity,
  type AuditQuota,
  type AuditTrend,
} from '@/lib/actions/audits';
import { barColor, pct, scoreColor, CATEGORY_META } from '@/components/audit/audit-report';
import { formatMonthDay, formatNumber } from '@/lib/format';
import { frictionFlow } from '@/lib/friction-events';
import { SiteTrustCard } from './_site-trust-card';
import { ScoreTrendChart } from './_charts';
import { AuditPagesTable } from './_pages-table';
import { mergePages, pruneSelection } from '@/lib/audit/merge-pages';
import { AuditBulkBar, ExportMenu } from './_bulk-bar';
import { AuditOverviewCards } from './_overview-cards';
import {
  OpportunitiesTable,
  opportunityAuditUrls,
  opportunityPagesToAudit,
} from './_opportunities-table';
import { AuditConfirmDialog, type PageToAudit } from './_audit-confirm-dialog';
import {
  OpportunityFilterChips,
  matchesFilter,
  type OpportunityFilter,
} from './_opportunity-filter';
import { AuditSettingsDialog } from './_settings-dialog';
import { AutoRunNotice } from './_auto-run-notice';
import { BatchProgress } from './_batch-progress';
import { nextBatch, type Batch } from '@/lib/audit/batch-progress';
import { AuditSummaryStrip } from './_summary-strip';
import { EmptyPoolMessage } from './_quota-meter';
import { usePagesExport } from './_use-pages-export';
import { nextAutoRun } from '@/lib/audit-auto-runs';
import { cn } from '@/lib/utils';
import { parseListTab, withListTab, type ListTab } from './_list-tab';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';
import { useChatPageContext } from '@/components/chat/panel/chat-panel-context';
import { rangeChipLabel } from '@/lib/chat/page-context';
import { viewRows } from '@/lib/chat/page-view';
import { useRubricText } from '@/hooks/use-rubric-text';

type RangePreset = '7d' | '30d' | '90d' | 'all';
const RANGE_DAYS: Record<RangePreset, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };

/** Pages one bulk request may audit (the server's BULK_AUDIT_MAX). */
const BULK_REQUEST_MAX = 50;

/** site_audit_run: Run audit, or the pages or opportunities picked, until the audits run. */
const SITE_AUDIT_RUN = frictionFlow('site_audit_run');

/** A tab's count, as the mockup's grey pill. */
function TabCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {formatNumber(count)}
    </span>
  );
}

/** While audits run, the Pages list and the quota are read again this often. */
const RUNNING_POLL_MS = 10_000;

/** The most pages one read returns (the server's limit). */
const HUB_PAGES_MAX = 100;

function barClass(score: number | null): string {
  return barColor(score);
}

export default function SiteAuditPage() {
  const t = useTranslations('audit');
  const rubric = useRubricText();
  const router = useRouter();
  const { askOne, saySkipped } = useRecentAudit();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): Run audit, the bulk bars' Audit,
  // Pin, Exclude and Restore, and deleting a run open the upgrade dialog
  // instead; the settings open to read, and their Save asks too.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const caughtError = useCaughtErrorText();
  const serverError = useServerErrorText();

  // Prefill the URL with the active brand's primary domain (read once at init).
  const [url, setUrl] = useState(() => {
    const { brands, activeBrandId: id } = useBrandStore.getState();
    const brand = brands.find((b) => b.id === id);
    const primary = brand?.domains?.find((d) => d.isPrimary) ?? brand?.domains?.[0];
    return primary?.domain ? `https://${primary.domain.replace(/^https?:\/\//, '')}` : '';
  });
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pages, setPages] = useState<AuditedPage[]>([]);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [primaryHost, setPrimaryHost] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [quota, setQuota] = useState<AuditQuota | null>(null);
  const [trend, setTrend] = useState<AuditTrend | null>(null);
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [range, setRange] = useState<RangePreset>('30d');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // The bulk audit under way, or just done: "N of M done · about X min left", and This batch.
  const [batch, setBatch] = useState<Batch | null>(null);
  const [batchNow, setBatchNow] = useState(() => Date.now());
  // Pages lists only the batch's pages (read from the time its first audit started).
  const [thisBatchOnly, setThisBatchOnly] = useState(false);
  const [opps, setOpps] = useState<AuditOpportunities | null>(null);
  const [oppSelected, setOppSelected] = useState<Set<string>>(() => new Set());
  // Opportunities shown by why they're listed (customer priorities item 11).
  const [oppFilter, setOppFilter] = useState<OpportunityFilter>('all');
  // A bulk audit asks first (item 11): which pages, from where, and when it was asked.
  const [confirm, setConfirm] = useState<{
    pages: PageToAudit[];
    mode: 'notAudited' | 'picked';
    target: 'opportunities' | 'pages';
    at: number;
  } | null>(null);
  // Opportunities when it lists pages, else Pages; chosen once per brand.
  const [tab, setTab] = useState<ListTab | null>(null);
  const [startingBulk, setStartingBulk] = useState(false);
  const [latestRun, setLatestRun] = useState<AutoAuditRun | null>(null);
  // The person's last looks (nav_seen's audit keys), for the dots: undefined
  // until read, null when they couldn't be.
  const [seen, setSeen] = useState<{ brandId: string; at: Record<string, string> | null } | null>(
    null,
  );
  // The brand whose Opportunities tab the person opened on this visit: its dot is gone.
  const [oppOpened, setOppOpened] = useState<string | null>(null);
  const dotViewer = useDotViewer();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Pages › Group by template (SA-007): the templates, read while it's on.
  const [groupByTemplate, setGroupByTemplate] = useState(false);
  const [templates, setTemplates] = useState<AuditTemplate[] | null>(null);
  const { exporting, exportAll, exportPages } = usePagesExport(activeBrandId);
  // Capture "now" once (impure call belongs in a lazy initializer, not render).
  const [nowMs] = useState(() => Date.now());
  // A list the address names (?tab=pages, the auto-audit e-mail's link) opens
  // first on the brand the page opened with; another brand starts as usual.
  const searchParams = useSearchParams();
  const linked = useRef({ tab: parseListTab(searchParams.get('tab')), brandId: activeBrandId });

  const refetch = () => setRefreshKey((k: number) => k + 1);

  // The Opportunities tab shown keeps this look for the next visit's dot,
  // once the last one was read.
  const seenBrand = seen?.brandId ?? null;
  useEffect(() => {
    if (!activeBrandId || tab !== 'opportunities' || seenBrand !== activeBrandId) return;
    markPageSeen(activeBrandId, 'audit/opportunities').catch(() => {});
  }, [activeBrandId, tab, seenBrand]);

  // The last look at each part, for its dot: undefined until read or when it couldn't be.
  const seenAt = (key: PageSeenKey) =>
    seen && seen.brandId === activeBrandId && seen.at ? (seen.at[key] ?? null) : undefined;
  const autoDot = pickDot(
    autoAuditDots({ run: latestRun, auto: quota?.auto ?? null, seenAt: seenAt('audit/auto') }),
    dotViewer,
  );
  const oppDot =
    oppOpened === activeBrandId
      ? null
      : pickDot(
          opportunityDots({
            audits: (opps?.opportunities ?? [])
              .filter((o) => o.reasons.length > 0)
              .map((o) => o.lastAudit?.at ?? null),
            run:
              latestRun?.status === 'completed'
                ? { finishedAt: latestRun.finishedAt, fixed: latestRun.compare?.fixed ?? 0 }
                : null,
            seenAt: seenAt('audit/opportunities'),
          }),
          dotViewer,
        );

  // The address follows the list shown, so it can be shared or reopened.
  const showList = (next: ListTab) => {
    // Opening Opportunities clears its dot.
    if (next === 'opportunities') setOppOpened(activeBrandId ?? null);
    setTab(next);
    window.history.replaceState(null, '', withListTab(window.location.href, next));
  };

  // The run notice's View pages: the Pages list, latest audits first, so the
  // run's pages lead it (tagged Auto).
  const listsRef = useRef<HTMLDivElement>(null);
  const showPages = () => {
    showList('pages');
    listsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Load the hub in two requests side by side: the audited pages, the quota,
  // the trend and the cards; the Opportunities inbox and the latest auto-audit
  // run. The page shows once both are in, in its final layout: filled in
  // one after the other, the cards, the trend and the run's notice pushed
  // the lists down twice while it opened.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // A selection, and the tab, belong to the brand they were made on.
    setSelected(new Set());
    setOppSelected(new Set());
    setOppFilter('all');
    setBatch(null);
    setThisBatchOnly(false);
    // The store may only know the brand after the first render: that's the one it opened with.
    linked.current.brandId ??= activeBrandId;
    setTab(activeBrandId === linked.current.brandId ? linked.current.tab : null);
    setOpps(null);
    setLatestRun(null);
    // Read before this visit is kept: the dots compare with the visit before.
    readPageSeen(activeBrandId)
      .catch(() => null)
      .then((at) => {
        if (cancelled) return;
        setSeen({ brandId: activeBrandId, at });
        markPageSeen(activeBrandId, 'audit/auto').catch(() => {});
      });
    (async () => {
      try {
        const [hub, extras] = await Promise.all([
          getAuditHub(activeBrandId),
          getAuditHubExtras(activeBrandId),
        ]);
        if (cancelled) return;
        setPages(hub.pages.pages);
        setPagesTotal(hub.pages.total);
        setPrimaryHost(hub.pages.primaryHost);
        applyRunning(hub.pages.running);
        setQuota(hub.quota);
        setTrend(hub.trend);
        setOverview(hub.overview);
        setOpps(extras.opportunities);
        setLatestRun(extras.latestRun);
        // The inbox is the first tab when it has pages, unless one was picked meanwhile.
        setTab(
          (current) =>
            current ??
            ((extras.opportunities?.opportunities.length ?? 0) > 0 ? 'opportunities' : 'pages'),
        );
      } catch (err) {
        console.error('Failed to load audit hub data:', err);
        if (!cancelled) {
          const msg = caughtError(err, t('failed'));
          setError(msg);
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, refreshKey, t, caughtError]);

  useEffect(() => {
    if (!groupByTemplate || !activeBrandId) return;
    let cancelled = false;
    getAuditTemplates(activeBrandId)
      .then((next) => {
        if (!cancelled) setTemplates(next);
      })
      .catch((err) => {
        console.error('Failed to load the page templates:', err);
        if (!cancelled) {
          toast.error(serverError(err, t('pages.templatesFailed')));
          setGroupByTemplate(false);
        }
      });
    return () => {
      cancelled = true;
      setTemplates(null);
    };
  }, [groupByTemplate, activeBrandId, refreshKey, t, serverError]);

  // Without an active plan the quota reads 0 of 0: not used up. Run audit
  // stays clickable, and opens the plan dialog.
  const quotaExhausted =
    quota !== null && !isNoPlan(quota, isLocked) && quota.limit !== -1 && quota.remaining <= 0;

  // Trend points within the selected range (oldest → newest).
  const rangePoints = useMemo(() => {
    const points = trend?.points ?? [];
    const days = RANGE_DAYS[range];
    if (days === null) return points;
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
    return points.filter((p) => new Date(p.createdAt).getTime() >= cutoff);
  }, [trend, range, nowMs]);

  // Collapse to one point per calendar day (the latest audit that day) so the
  // x-axis doesn't repeat identical date labels when a page is audited several
  // times in a day. rangePoints is ascending, so the last write per day wins.
  const dailyPoints = useMemo(() => {
    const byDay = new Map<string, (typeof rangePoints)[number]>();
    for (const p of rangePoints) {
      const date = new Date(p.createdAt);
      const localDay = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');

      byDay.set(localDay, p);
    }
    return [...byDay.values()];
  }, [rangePoints]);

  const chartData = dailyPoints
    .filter((p) => p.totalScore !== null)
    .map((p) => ({
      date: formatMonthDay(p.createdAt),
      score: pct(p.totalScore) ?? 0,
    }));

  const latestPoint = dailyPoints[dailyPoints.length - 1] ?? null;
  const delta =
    dailyPoints.length >= 2
      ? (pct(dailyPoints[dailyPoints.length - 1].totalScore) ?? 0) -
        (pct(dailyPoints[0].totalScore) ?? 0)
      : null;

  // POST returns immediately with a running row (the page's own, when one
  // runs already); navigate to its detail page, which polls until the audit
  // completes. A page audited minutes ago asks first: Open it or Audit again.
  const startAudit = async (brandId: string, target: string, force = false) => {
    setRunning(true);
    try {
      const started = force
        ? await runAudit(brandId, target, { force: true })
        : await runAudit(brandId, target);
      if (started.recent) {
        setRunning(false);
        askOne(started.recent, () => void startAudit(brandId, target, true));
        return;
      }
      SITE_AUDIT_RUN.completed();
      router.push(`/dashboard/audit/${started.audit.id}`);
    } catch (err) {
      SITE_AUDIT_RUN.failed();
      toast.error(caughtError(err, t('failed')));
      setRunning(false);
    }
  };

  const handleRun = guard(
    async () => {
      if (!activeBrandId) {
        toast.error(t('noBrand'));
        return;
      }
      if (!url.trim()) {
        toast.error(t('urlRequired'));
        return;
      }
      SITE_AUDIT_RUN.started();
      await startAudit(activeBrandId, url.trim());
    },
    { action: tActions('runAudit') },
  );

  // The reads that follow a bulk audit say how many audits still run; the
  // batch is what they add up to (lib/audit/batch-progress.ts). The ref gives
  // the polling timer the batch's start, which its closure would hold stale.
  const sinceRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    sinceRef.current = thisBatchOnly && batch ? batch.since : undefined;
  }, [thisBatchOnly, batch]);
  const applyRunning = (running: { count: number; since: string | null } | undefined) => {
    if (!running) return;
    const now = Date.now();
    setBatchNow(now);
    setBatch((prev) => nextBatch(prev, running, now));
  };

  // This batch on or off: the Pages list is read again, from the batch's
  // start or in full. Selected pages stay selected, kept by page key.
  const showBatchOnly = async (on: boolean) => {
    if (!activeBrandId) return;
    const since = on && batch ? batch.since : undefined;
    sinceRef.current = since;
    setThisBatchOnly(on);
    setLoadingMore(true);
    try {
      const res = await getAuditPages(activeBrandId, 0, 50, since);
      setPages(res.pages);
      setPagesTotal(res.total);
      setPrimaryHost(res.primaryHost);
      applyRunning(res.running);
      if (on) showList('pages');
    } catch (err) {
      sinceRef.current = undefined;
      setThisBatchOnly(false);
      toast.error(err instanceof Error ? err.message : t('failed'));
    } finally {
      setLoadingMore(false);
    }
  };

  // Append the next page of the Pages list. Dedupe by page: a page audited
  // since the first read moves to the top and shifts offsets by one.
  const handleLoadMore = async () => {
    if (!activeBrandId) return;
    setLoadingMore(true);
    try {
      const next = await getAuditPages(activeBrandId, pages.length, 50, sinceRef.current);
      setPages((current) => {
        const seen = new Set(current.map((p) => p.key));
        return [...current, ...next.pages.filter((p) => !seen.has(p.key))];
      });
      setPagesTotal(next.total);
    } catch (err) {
      toast.error(caughtError(err, t('failed')));
    } finally {
      setLoadingMore(false);
    }
  };

  // Read the pages shown, the quota and the trend again, in place: the table
  // stays up with its open histories and every row loaded so far, the rows
  // patched where they are (by page key) rather than the list replaced. The
  // selection is kept by key, outside the paged rows; only pages now running
  // (or gone) leave it.
  const shownRef = useRef(0);
  useEffect(() => {
    shownRef.current = pages.length;
  }, [pages.length]);
  const reloadInPlace = async (brandId: string) => {
    const shown = Math.max(shownRef.current, 50);
    const since = sinceRef.current;
    const hub = await getAuditHub(brandId, Math.min(shown, HUB_PAGES_MAX), since);
    const data = hub.pages;
    // The hub reads the first rows only; the rest of what's shown is read in chunks.
    let fresh = data.pages;
    while (shown > HUB_PAGES_MAX && fresh.length < Math.min(shown, data.total)) {
      const more = await getAuditPages(
        brandId,
        fresh.length,
        Math.min(HUB_PAGES_MAX, shown - fresh.length),
        since,
      );
      if (more.pages.length === 0) break;
      fresh = [...fresh, ...more.pages];
    }
    // With This batch on, the read covers the batch only, so it can't say a
    // page outside it is gone: rows and selection are kept as they are.
    const complete = !since && fresh.length >= data.total;
    setPages((current) => mergePages(current, fresh, complete));
    setPagesTotal(data.total);
    setPrimaryHost(data.primaryHost);
    applyRunning(data.running);
    setQuota(hub.quota);
    setTrend(hub.trend);
    setOverview(hub.overview);
    setSelected((prev) => pruneSelection(prev, fresh, complete));

    const { opportunities: op, latestRun: run } = await getAuditHubExtras(brandId);
    setOpps(op);
    setLatestRun(run);
    const oppSelectable = new Set(
      (op?.opportunities ?? []).filter((o) => !o.running).map((o) => o.key),
    );
    setOppSelected((prev) => new Set([...prev].filter((key) => oppSelectable.has(key))));
  };

  // Deleting a run can change its page's score, status or trend, or remove
  // the page.
  const handleDelete = async (id: string) => {
    if (!activeBrandId) return;
    try {
      await deleteAudit(id);
      await reloadInPlace(activeBrandId);
    } catch (err) {
      toast.error(caughtError(err, t('failed')));
    }
  };

  const handleSelect = (keys: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  const selectedPages = pages.filter((p) => selected.has(p.key));

  // Start audits of the pages, BULK_REQUEST_MAX a request (a template's
  // pages can pass one request's limit). Pages audited minutes ago aren't
  // started: a notice says so, with Audit again.
  const auditUrls = async (brandId: string, urls: string[], force = false) => {
    let started = 0;
    const recent: RecentAudit[] = [];
    for (let i = 0; i < urls.length; i += BULK_REQUEST_MAX) {
      const chunk = urls.slice(i, i + BULK_REQUEST_MAX);
      const result = force
        ? await runAuditsBulk(brandId, chunk, { force: true })
        : await runAuditsBulk(brandId, chunk);
      started += result.started;
      recent.push(...result.recent);
    }
    if (started > 0) toast.success(t('bulk.started', { count: started }));
    saySkipped(recent, async () => {
      try {
        await auditUrls(
          brandId,
          recent.flatMap((r) => (r.url ? [r.url] : [])),
          true,
        );
        await reloadInPlace(brandId);
      } catch (err) {
        toast.error(caughtError(err, t('failed')));
      }
    });
  };

  // Re-audit on the Pages tab: asks first, with the pages audited this week.
  const confirmReaudit = () =>
    setConfirm({
      pages: selectedPages.map((p) => ({ url: p.url, path: p.path, lastAuditAt: p.lastAuditedAt })),
      mode: 'picked',
      target: 'pages',
      at: Date.now(),
    });

  const handleBulkReaudit = async (urls: string[]) => {
    if (!activeBrandId || urls.length === 0) return;
    setStartingBulk(true);
    SITE_AUDIT_RUN.started();
    try {
      await auditUrls(activeBrandId, urls);
      SITE_AUDIT_RUN.completed();
      setSelected(new Set());
      setConfirm(null);
      await reloadInPlace(activeBrandId);
    } catch (err) {
      SITE_AUDIT_RUN.failed();
      toast.error(caughtError(err, t('failed')));
    } finally {
      setStartingBulk(false);
    }
  };

  // While any page is being audited, follow it until its run ends.
  const handleOppSelect = (keys: string[], on: boolean) =>
    setOppSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  // The rows the filter shows; one with none left (the list read again) shows them all.
  const filteredOpps = (opps?.opportunities ?? []).filter((o) => matchesFilter(o, oppFilter));
  const filterShown: OpportunityFilter = filteredOpps.length > 0 ? oppFilter : 'all';
  const shownOpps = filterShown === oppFilter ? filteredOpps : (opps?.opportunities ?? []);
  // Only rows on screen go to the bulk bar: a filter hides the others' ticks.
  const selectedOpps = shownOpps.filter((o) => oppSelected.has(o.key));
  // Pages audited's link: Opportunities, on the pages without a current audit.
  const showNotAudited = () => {
    setOppFilter('notAudited');
    showList('opportunities');
    listsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const oppAuditUrls = opportunityAuditUrls(selectedOpps);
  // Pin and Exclude by page; a template is excluded by its pattern (SA-007).
  const selectedOppUrls = selectedOpps.flatMap((o) => (!o.template && o.url ? [o.url] : []));
  const selectedTemplates = selectedOpps.filter((o) => o.template).map((o) => o.path);

  // Audit selected, and Not audited's Audit all: ask first, most valuable first.
  const confirmOpps = (rows: AuditOpportunity[], mode: 'notAudited' | 'picked') =>
    setConfirm({
      pages: opportunityPagesToAudit(rows.filter((o) => !o.running)),
      mode,
      target: 'opportunities',
      at: Date.now(),
    });

  const handleAuditOpps = async (urls: string[]) => {
    if (!activeBrandId || urls.length === 0) return;
    setStartingBulk(true);
    SITE_AUDIT_RUN.started();
    try {
      await auditUrls(activeBrandId, urls);
      SITE_AUDIT_RUN.completed();
      setOppSelected(new Set());
      setConfirm(null);
      await reloadInPlace(activeBrandId);
    } catch (err) {
      SITE_AUDIT_RUN.failed();
      toast.error(caughtError(err, t('failed')));
    } finally {
      setStartingBulk(false);
    }
  };

  // Pin, exclude or restore pages, then read the inbox again. Excluding can
  // be undone from its toast.
  const savePrefs = async (
    urls: string[],
    state: 'pinned' | 'excluded' | null,
    message: string,
    undo?: () => void,
  ) => {
    if (!activeBrandId || urls.length === 0) return;
    try {
      await setOpportunityPrefs(activeBrandId, urls, state);
      setOppSelected(new Set());
      toast.success(
        message,
        undo ? { action: { label: t('opportunities.undo'), onClick: undo } } : undefined,
      );
      await reloadInPlace(activeBrandId);
    } catch (err) {
      console.error('Failed to update the opportunities:', err);
      toast.error(serverError(err, t('opportunities.prefsFailed')));
    }
  };

  const selectedPagesOpps = selectedOpps.filter((o) => !o.template);
  const allPinned = selectedPagesOpps.length > 0 && selectedPagesOpps.every((o) => o.pinned);
  const handlePin = () => {
    const urls = selectedOppUrls;
    return allPinned
      ? savePrefs(urls, null, t('opportunities.unpinnedToast', { count: urls.length }))
      : savePrefs(urls, 'pinned', t('opportunities.pinnedToast', { count: urls.length }));
  };

  // Excluding a template adds its pattern ("/blog/*") to the brand's exclude
  // patterns, so its pages leave the inbox too; Undo puts the patterns back.
  const savePatterns = async (patterns: string[], message: string, undo?: () => void) => {
    if (!activeBrandId) return;
    try {
      await saveAuditSettings(activeBrandId, { excludePatterns: patterns });
      setOppSelected(new Set());
      toast.success(
        message,
        undo ? { action: { label: t('opportunities.undo'), onClick: undo } } : undefined,
      );
      await reloadInPlace(activeBrandId);
    } catch (err) {
      toast.error(caughtError(err, t('opportunities.prefsFailed')));
    }
  };
  const excludeTemplates = async (templates: string[]) => {
    if (!activeBrandId) return;
    let before: string[];
    try {
      before = (await getAuditSettings(activeBrandId)).excludePatterns;
    } catch (err) {
      toast.error(caughtError(err, t('opportunities.prefsFailed')));
      return;
    }
    await savePatterns(
      [...new Set([...before, ...templates])],
      t('opportunities.templateExcludedToast', { count: templates.length, template: templates[0] }),
      () => void savePatterns(before, t('opportunities.templateRestoredToast')),
    );
  };
  const handleExclude = async () => {
    const urls = selectedOppUrls;
    const templates = selectedTemplates;
    if (templates.length > 0) await excludeTemplates(templates);
    if (urls.length === 0) return;
    await savePrefs(
      urls,
      'excluded',
      t('opportunities.excludedToast', { count: urls.length }),
      () => void savePrefs(urls, null, t('opportunities.restoredToast', { count: urls.length })),
    );
  };
  const handleRestore = (urls: string[]) =>
    savePrefs(urls, null, t('opportunities.restoredToast', { count: urls.length }));

  const anyRunning =
    pages.some((p) => p.status === 'running') || (opps?.opportunities ?? []).some((o) => o.running);
  useEffect(() => {
    if (!anyRunning || !activeBrandId) return;
    // A read can take longer than the interval: the next one waits for it
    // rather than queueing behind it.
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      reloadInPlace(activeBrandId)
        .catch((err) => console.error('Failed to refresh the audited pages:', err))
        .finally(() => {
          reading = false;
        });
    }, RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, activeBrandId]);

  // Chat's side panel sees the page (the owner's plan of 2026-11-16, step 9): its trend's range,
  // the list open, and once read its rows as the list shows them, each by the Site Audit it
  // opens (a page not audited yet has none, and no read takes it).
  const tChatRange = useTranslations('chatPanel.range');
  useChatPageContext(
    activeBrandId
      ? {
          pageName: t('title'),
          dateRange: {
            from: range,
            to: null,
            label: rangeChipLabel(range, {}, (key, values) => tChatRange(key, values)),
          },
          view: {
            ...(tab ? { tab } : {}),
            ...(tab === 'pages' && !loading
              ? {
                  rows: viewRows(pages, (page) => ({
                    ref: page.auditId,
                    label: page.url,
                  })),
                  total: pagesTotal,
                }
              : tab === 'opportunities' && !loading
                ? {
                    rows: viewRows(shownOpps, (o) => ({
                      ref: o.lastAudit?.auditId,
                      label: o.title || o.url || o.path,
                    })),
                  }
                : {}),
          },
        }
      : null,
  );

  if (!activeBrandId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">{t('noBrand')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </div>
          <Button variant="outline" className="shrink-0" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
            {t('settings.button')}
          </Button>
        </div>
      </HeaderWithAiUsage>
      <AuditConfirmDialog
        // Each asking starts over, Leave out the recent ones as its kind starts it.
        key={confirm?.at}
        pages={confirm?.pages ?? null}
        mode={confirm?.mode ?? 'picked'}
        ordered={confirm?.target === 'pages' ? 'shown' : 'value'}
        staleDays={opps?.staleDays ?? 90}
        quota={quota}
        starting={startingBulk}
        now={confirm?.at ?? nowMs}
        onConfirm={(urls) =>
          void (confirm?.target === 'pages' ? handleBulkReaudit(urls) : handleAuditOpps(urls))
        }
        onOpenChange={(open) => !open && setConfirm(null)}
      />
      <AuditSettingsDialog
        brandId={activeBrandId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        canManage={canManage}
        onSaved={() =>
          void reloadInPlace(activeBrandId).catch((err) =>
            console.error('Failed to refresh after saving the settings:', err),
          )
        }
        schedule={quota?.auto ?? null}
        latestRun={latestRun}
        now={new Date(nowMs)}
      />

      {/* Summary strip, as in the v2 mockup (SA-019) */}
      <AuditSummaryStrip
        loading={loading}
        overview={loading ? null : overview}
        quota={quota}
        now={new Date(nowMs)}
        coverage={opps?.coverage ?? null}
      />

      {/* Run bar */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              type="url"
              inputMode="url"
              placeholder="https://example.com/page"
              aria-label="Website URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !running && !quotaExhausted && handleRun()}
              disabled={running}
              className="flex-1"
            />
            {/* The Audits this month card shows what's left; here only why Run is off. */}
            {quotaExhausted && !(quota.auto?.reserved ?? 0) && (
              <span className="shrink-0 text-xs tabular-nums text-destructive">
                {quota.remaining}/{quota.limit} {t('auditsLeft')}
              </span>
            )}
            <Button onClick={handleRun} disabled={running || quotaExhausted} className="shrink-0">
              {running ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {t('running')}
                </>
              ) : (
                <>
                  <Search className="me-2 h-4 w-4" />
                  {t('runAudit')}
                </>
              )}
            </Button>
          </div>
          {/* The user's share is used, the runs' isn't (spec §4.4). */}
          <EmptyPoolMessage quota={quota} onOpenSettings={() => setSettingsOpen(true)} />
        </CardContent>
      </Card>

      {/* The latest auto-audit run on this brand's pages (SA-006) */}
      <AutoRunNotice
        key={activeBrandId}
        brandId={activeBrandId}
        run={latestRun}
        nextRun={quota?.auto?.enabled ? nextAutoRun(quota.auto, new Date(nowMs)) : null}
        onViewPages={showPages}
        dot={autoDot}
        onSetUp={canManage ? () => setSettingsOpen(true) : undefined}
      />

      {/* A bulk audit's progress: N of M done, the time left, and This batch */}
      {batch && (
        <BatchProgress
          batch={batch}
          now={batchNow}
          thisBatch={thisBatchOnly}
          onToggleThisBatch={() => void showBatchOnly(!thisBatchOnly)}
          onDismiss={() => {
            setBatch(null);
            if (thisBatchOnly) void showBatchOnly(false);
          }}
        />
      )}

      {/* KPI cards, as in the v2 mockup (SA-018) */}
      {(loading || overview) && (
        <AuditOverviewCards
          overview={loading ? null : overview}
          quota={quota}
          now={new Date(nowMs)}
          coverage={opps?.coverage ?? null}
          staleDays={opps?.staleDays}
          onShowNotAudited={showNotAudited}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* While the hub loads, the trend card's place, line for line, so the
          cards below don't move when it fills in */}
      {loading && (
        <Card aria-hidden data-testid="audit-trend-skeleton">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <div className="flex h-6 items-center">
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="mt-0.5 flex h-4 items-center">
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-[26px] w-40 shrink-0" />
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="mb-2 flex h-9 items-center">
                <Skeleton className="h-7 w-20" />
              </div>
              <Skeleton className="h-[200px] w-full" />
            </div>
            <div className="space-y-3">
              <div className="flex h-4 items-center">
                <Skeleton className="h-3 w-28" />
              </div>
              {CATEGORY_META.map((cat) => (
                <div key={cat.key}>
                  <div className="mb-1 flex h-4 items-center">
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Primary-domain score trend + category breakdown */}
      {!loading && trend && trend.points.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">{t('scoreOverTime')}</CardTitle>
              {trend.primaryDomain && (
                <p className="mt-0.5 text-xs text-muted-foreground">{trend.primaryDomain}</p>
              )}
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-md border">
              {(['7d', '30d', '90d', 'all'] as RangePreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setRange(p)}
                  aria-pressed={range === p}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium transition-colors',
                    range === p
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {p === 'all' ? t('all') : p}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Chart + delta */}
            <div className="lg:col-span-2">
              <div className="mb-2 flex items-baseline gap-2">
                <span
                  className={cn(
                    'text-3xl font-bold tabular-nums',
                    scoreColor(latestPoint?.totalScore ?? null),
                  )}
                >
                  {latestPoint ? (pct(latestPoint.totalScore) ?? '—') : '—'}
                </span>
                <span className="text-sm text-muted-foreground">/100</span>
                {delta !== null && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 text-xs font-medium',
                      delta > 0
                        ? 'text-green-600'
                        : delta < 0
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                    )}
                  >
                    {delta > 0 ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : delta < 0 ? (
                      <TrendingDown className="h-3.5 w-3.5" />
                    ) : null}
                    {delta > 0 ? '+' : ''}
                    {delta} {t('inRange')}
                  </span>
                )}
              </div>
              {chartData.length >= 2 ? (
                <ScoreTrendChart data={chartData} score={latestPoint?.totalScore ?? null} />
              ) : (
                <div className="flex h-[200px] items-center justify-center text-center text-sm text-muted-foreground">
                  {t('trendNeedsMore')}
                </div>
              )}
            </div>

            {/* Category breakdown grid (latest audit in range) */}
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground">
                {t('categoryBreakdown')}
              </div>
              {CATEGORY_META.map((cat) => {
                const cs = latestPoint?.categoryScores?.[cat.key];
                const score = cs?.score ?? null;
                const p = pct(score);
                return (
                  <div key={cat.key}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium">{rubric.category(cat.key, cat.label)}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {p === null ? t('na') : `${p}/100`}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', barClass(score))}
                        style={{ width: `${p ?? 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Site trust (Content Editor Quality, CE-043): with Quality's first phase */}
      {activeBrandId && qualityPhase() >= 1 && (
        <SiteTrustCard key={`site-trust-${activeBrandId}`} brandId={activeBrandId} />
      )}

      {loading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b py-2.5 last:border-b-0"
              >
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div className="text-base font-semibold">{t('failed')}</div>
            <p className="max-w-md text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="me-2 h-4 w-4" />
              {t('retry')}
            </Button>
          </CardContent>
        </Card>
      ) : pages.length === 0 &&
        (opps?.opportunities.length ?? 0) === 0 &&
        (opps?.excluded.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Sparkles className="h-7 w-7 text-primary" />
            <div className="text-base font-semibold">{t('emptyTitle')}</div>
            <p className="max-w-md text-sm text-muted-foreground">{t('emptyBody')}</p>
          </CardContent>
        </Card>
      ) : (
        <Tabs ref={listsRef} value={tab ?? 'pages'} onValueChange={(v) => showList(v as ListTab)}>
          <TabsList variant="line" aria-label={t('lists.label')}>
            {opps && (
              <TabsTrigger value="opportunities">
                {t('lists.opportunities')}
                <PageDot dot={oppDot} />
                <TabCount count={opps.opportunities.length} />
              </TabsTrigger>
            )}
            <TabsTrigger value="pages">
              {t('lists.pages')}
              <TabCount count={pagesTotal} />
            </TabsTrigger>
          </TabsList>
          {opps && (
            <TabsContent value="opportunities" className="mt-3">
              <OpportunitiesTable
                opportunities={shownOpps}
                excluded={opps.excluded}
                staleDays={opps.staleDays}
                filters={
                  <OpportunityFilterChips
                    opportunities={opps.opportunities}
                    filter={filterShown}
                    onFilter={setOppFilter}
                    staleDays={opps.staleDays}
                    action={
                      filterShown === 'notAudited' && (
                        <Button
                          size="sm"
                          className="ms-2 h-7 rounded-full px-3 text-xs"
                          disabled={startingBulk}
                          onClick={guard(() => confirmOpps(shownOpps, 'notAudited'), {
                            action: tActions('auditPages'),
                          })}
                        >
                          {t('opportunities.auditAll', {
                            count: shownOpps.filter((o) => !o.running).length,
                          })}
                        </Button>
                      )
                    }
                  />
                }
                selected={oppSelected}
                onSelect={handleOppSelect}
                // Pins and exclusions hold for the whole brand: admins and
                // managers change them, as the server allows.
                onRestore={
                  canManage
                    ? guard((urls: string[]) => void handleRestore(urls), {
                        action: tActions('restorePages'),
                      })
                    : undefined
                }
                toolbar={
                  selectedOpps.length > 0 && (
                    <AuditBulkBar
                      count={selectedOpps.length}
                      audits={oppAuditUrls.length}
                      quota={quota}
                      starting={startingBulk}
                      auditLabel={t('opportunities.auditSelected')}
                      onAudit={guard(() => confirmOpps(selectedOpps, 'picked'), {
                        action: tActions('auditPages'),
                      })}
                      onClear={() => setOppSelected(new Set())}
                    >
                      {canManage && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={selectedOppUrls.length === 0}
                            onClick={guard(() => void handlePin(), {
                              action: tActions(allPinned ? 'unpinPages' : 'pinPages'),
                            })}
                          >
                            <Pin className="h-3 w-3" />
                            {allPinned ? t('opportunities.unpin') : t('opportunities.pin')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={guard(() => void handleExclude(), {
                              action: tActions('excludePages'),
                            })}
                          >
                            <EyeOff className="h-3 w-3" />
                            {t('opportunities.exclude')}
                          </Button>
                        </>
                      )}
                      {!canManage && (
                        <span className="text-xs text-muted-foreground">
                          {t('opportunities.prefsManagersOnly')}
                        </span>
                      )}
                    </AuditBulkBar>
                  )
                }
              />
            </TabsContent>
          )}
          <TabsContent value="pages" className="mt-3">
            {pages.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {t('lists.noPages')}
                </CardContent>
              </Card>
            ) : (
              <AuditPagesTable
                showTitle={false}
                pages={pages}
                total={pagesTotal}
                primaryHost={primaryHost}
                loadingMore={loadingMore}
                onLoadMore={handleLoadMore}
                onDeleteRun={canManage ? handleDelete : undefined}
                selected={selected}
                onSelect={handleSelect}
                templates={groupByTemplate ? templates : null}
                headerAction={
                  <div className="flex items-center gap-2">
                    <Button
                      variant={groupByTemplate ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      aria-pressed={groupByTemplate}
                      onClick={() => setGroupByTemplate((on) => !on)}
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {t('pages.groupByTemplate')}
                    </Button>
                    <ExportMenu busy={exporting} onExport={exportAll} />
                  </div>
                }
                toolbar={
                  selectedPages.length > 0 && (
                    <AuditBulkBar
                      count={selectedPages.length}
                      quota={quota}
                      starting={startingBulk}
                      onAudit={guard(confirmReaudit, { action: tActions('auditPages') })}
                      onExport={(format) => exportPages(selectedPages, format)}
                      onClear={() => setSelected(new Set())}
                    />
                  )
                }
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
