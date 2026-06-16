'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Search, Loader2, Trash2, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBrandStore } from '@/stores/use-brand-store';
import {
  runAudit,
  getAudits,
  getAuditQuota,
  getAuditTrend,
  deleteAudit,
  type AuditSummary,
  type AuditQuota,
  type AuditTrend,
} from '@/lib/actions/audits';
import { pct, scoreColor, CATEGORY_META } from '@/components/audit/audit-report';
import { ScoreTrendChart } from './_charts';
import { cn } from '@/lib/utils';

type RangePreset = '7d' | '30d' | '90d' | 'all';
const RANGE_DAYS: Record<RangePreset, number | null> = { '7d': 7, '30d': 30, '90d': 90, all: null };

function barClass(score: number | null): string {
  if (score === null) return 'bg-muted';
  if (score >= 0.7) return 'bg-green-600';
  if (score >= 0.4) return 'bg-amber-500';
  return 'bg-destructive';
}

export default function SiteAuditPage() {
  const t = useTranslations('audit');
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);

  // Prefill the URL with the active brand's primary domain (read once at init).
  const [url, setUrl] = useState(() => {
    const { brands, activeBrandId: id } = useBrandStore.getState();
    const brand = brands.find((b) => b.id === id);
    const primary = brand?.domains?.find((d) => d.isPrimary) ?? brand?.domains?.[0];
    return primary?.domain ? `https://${primary.domain.replace(/^https?:\/\//, '')}` : '';
  });
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<AuditSummary[]>([]);
  const [quota, setQuota] = useState<AuditQuota | null>(null);
  const [trend, setTrend] = useState<AuditTrend | null>(null);
  const [range, setRange] = useState<RangePreset>('30d');
  // Capture "now" once (impure call belongs in a lazy initializer, not render).
  const [nowMs] = useState(() => Date.now());

  // Load recent audits + the monthly quota + the primary-domain trend.
  // Each is fetched independently: recent audits are the core of the page, so a
  // failing quota/trend call (e.g. during a deploy window where the web is live
  // but the server doesn't yet have the /quota & /trend routes) must NOT blank
  // the list — it just hides that one enhancement.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getAudits(activeBrandId);
        if (!cancelled) setHistory(data);
      } catch (err) {
        console.error('Failed to load audit history:', err);
      }
      try {
        const q = await getAuditQuota();
        if (!cancelled) setQuota(q);
      } catch (err) {
        console.error('Failed to load audit quota:', err);
      }
      try {
        const tr = await getAuditTrend(activeBrandId);
        if (!cancelled) setTrend(tr);
      } catch (err) {
        console.error('Failed to load audit trend:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  const quotaExhausted = quota !== null && quota.limit !== -1 && quota.remaining <= 0;

  // Trend points within the selected range (oldest → newest).
  const rangePoints = useMemo(() => {
    const points = trend?.points ?? [];
    const days = RANGE_DAYS[range];
    if (days === null) return points;
    const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
    return points.filter((p) => new Date(p.createdAt).getTime() >= cutoff);
  }, [trend, range, nowMs]);

  const chartData = rangePoints
    .filter((p) => p.totalScore !== null)
    .map((p) => ({
      date: new Date(p.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      score: pct(p.totalScore) ?? 0,
    }));

  const latestPoint = rangePoints[rangePoints.length - 1] ?? null;
  const delta =
    rangePoints.length >= 2
      ? (pct(rangePoints[rangePoints.length - 1].totalScore) ?? 0) -
        (pct(rangePoints[0].totalScore) ?? 0)
      : null;

  const handleRun = async () => {
    if (!activeBrandId) {
      toast.error(t('noBrand'));
      return;
    }
    if (!url.trim()) {
      toast.error(t('urlRequired'));
      return;
    }
    setRunning(true);
    try {
      // POST returns immediately with a running row; navigate to its detail
      // page, which polls until the audit completes.
      const started = await runAudit(activeBrandId, url.trim());
      router.push(`/dashboard/audit/${started.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failed'));
      setRunning(false);
    }
  };

  const handleDelete = async (id: string) => {
    const prev = history;
    setHistory((h) => h.filter((a) => a.id !== id));
    try {
      await deleteAudit(id);
    } catch (err) {
      setHistory(prev);
      toast.error(err instanceof Error ? err.message : t('failed'));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* Primary-domain score trend + category breakdown */}
      {trend && trend.points.length > 0 && (
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
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium transition-colors',
                    range === p
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {p === 'all' ? 'All' : p}
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
                      <span className="font-medium">{cat.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {p === null ? 'n/a' : `${p}/100`}
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

      {/* Run bar */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://example.com/page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !running && !quotaExhausted && handleRun()}
            disabled={running}
            className="flex-1"
          />
          {quota && quota.limit !== -1 && (
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                quotaExhausted ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {quota.remaining}/{quota.limit} {t('auditsLeft')}
            </span>
          )}
          <Button onClick={handleRun} disabled={running || quotaExhausted} className="shrink-0">
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('running')}
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                {t('runAudit')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {history.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Sparkles className="h-7 w-7 text-primary" />
            <div className="text-base font-semibold">{t('emptyTitle')}</div>
            <p className="max-w-md text-sm text-muted-foreground">{t('emptyBody')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('recent')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 border-b py-1 last:border-b-0 hover:bg-muted/40"
              >
                <Link
                  href={`/dashboard/audit/${h.id}`}
                  className="flex flex-1 items-center gap-3 py-2 text-left"
                >
                  <span className="flex-1 truncate text-sm">{h.url}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleDateString()}
                  </span>
                  <span
                    className={cn(
                      'w-12 text-right text-sm font-semibold tabular-nums',
                      scoreColor(h.total_score),
                    )}
                  >
                    {h.status === 'completed' ? (pct(h.total_score) ?? '—') : h.status}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(h.id)}
                  aria-label={t('deleteAudit')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
