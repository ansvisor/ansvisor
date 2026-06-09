'use client';

import { useState, useEffect, useCallback } from 'react';
import { ReferralTrendChart, PlatformBreakdownChart, getPlatformName } from './_charts';
import { useBrandStore } from '@/stores/use-brand-store';
import {
  getTrafficSummary,
  getTrafficTrend,
  getTrafficLogs,
  type TrafficSummary,
  type TrafficTrendPoint,
  type TrafficLog,
} from '@/lib/actions/traffic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Globe,
  TrendingUp,
  TrendingDown,
  Users,
  LayoutList,
  Code,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  title,
  icon: Icon,
  value,
  sub,
  subPositive,
}: {
  title: string;
  icon: React.ElementType;
  value: React.ReactNode;
  sub: React.ReactNode;
  subPositive?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p
          className={cn(
            'text-xs mt-1 flex items-center gap-0.5',
            subPositive === true
              ? 'text-green-600 dark:text-green-400'
              : subPositive === false
                ? 'text-red-500'
                : 'text-muted-foreground',
          )}
        >
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0)
    return <span className="text-xs text-muted-foreground">—</span>;
  if (previous === 0)
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600 dark:text-green-400">
        <TrendingUp className="h-3 w-3" />
        new
      </span>
    );
  const delta = Math.round(((current - previous) / previous) * 100);
  if (delta === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const pos = delta > 0;
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 text-xs font-medium',
        pos ? 'text-green-600 dark:text-green-400' : 'text-red-500',
      )}
    >
      {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pos ? '+' : ''}
      {delta}%
    </span>
  );
}

function SnippetBanner({ trackingCode }: { trackingCode?: string }) {
  const [copied, setCopied] = useState(false);
  const isCloud = process.env.NEXT_PUBLIC_IS_CLOUD === 'true';
  const apiUrl = isCloud ? 'https://api.ansvisor.com' : process.env.NEXT_PUBLIC_API_URL;
  const snippet = `<script src="${apiUrl}/t.js" data-t="${trackingCode || 'YOUR_TRACKING_CODE'}" defer></script>`;

  if (!trackingCode || !apiUrl) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="border-blue-500/20 bg-blue-500/5">
      <CardContent className="py-3 px-4 flex items-start gap-3">
        <Code className="h-4 w-4 mt-0.5 shrink-0 text-blue-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Add this snippet to your website</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Paste this before the closing <code className="text-[11px]">&lt;/head&gt;</code> tag to
            track AI-referred visits.
          </p>
          <div className="mt-2 relative">
            <pre className="text-[11px] bg-muted/50 rounded-md px-3 py-2 overflow-x-auto font-mono">
              {snippet}
            </pre>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={handleCopy}>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TrafficPage() {
  const { getActiveBrand } = useBrandStore();
  const brand = getActiveBrand();

  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [trend, setTrend] = useState<TrafficTrendPoint[]>([]);
  const [logs, setLogs] = useState<TrafficLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!brand) return;
    setIsLoading(true);
    try {
      const [s, t, l] = await Promise.all([
        getTrafficSummary(brand.id),
        getTrafficTrend(brand.id),
        getTrafficLogs(brand.id, { limit: 10 }),
      ]);
      setSummary(s);
      setTrend(t);
      setLogs(l.logs);
      setLogsTotal(l.total);
    } catch (err) {
      console.error('Failed to load traffic data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [brand]);

  useEffect(() => {
    load();
  }, [load]);

  if (!brand) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-lg font-semibold">No brand selected</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Select a brand to view AI traffic analytics.
        </p>
      </div>
    );
  }

  const primaryDomain = brand.domains.find((d) => d.isPrimary)?.domain ?? brand.domains[0]?.domain;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const totalVisits = summary?.totalVisits ?? 0;
  const totalVisitsPrev = summary?.totalVisitsPrev ?? 0;
  const visitsDelta =
    totalVisitsPrev > 0 ? Math.round(((totalVisits - totalVisitsPrev) / totalVisitsPrev) * 100) : 0;
  const topPlatform = summary?.platformBreakdown[0];

  const isEmpty = totalVisits === 0 && logs.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Traffic Analytics</h1>
        <p className="text-muted-foreground text-sm">
          {primaryDomain ? `${primaryDomain} · ` : ''}AI-referred visits to your website
        </p>
      </div>

      {/* Snippet Banner */}
      <SnippetBanner trackingCode={brand.trackingCode} />

      {isEmpty ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Globe className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <h3 className="text-lg font-semibold mt-4">No traffic data yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              {brand.trackingCode
                ? 'Once visitors arrive from AI platforms, their visits will appear here.'
                : 'Add the tracking snippet to your website to start collecting AI-referred traffic data.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <KpiCard
              title="AI-Referred Visits"
              icon={Users}
              value={totalVisits.toLocaleString()}
              sub={
                totalVisitsPrev > 0 ? (
                  <>
                    {visitsDelta >= 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {visitsDelta >= 0 ? '+' : ''}
                    {visitsDelta}% vs previous period
                  </>
                ) : (
                  'last 7 days'
                )
              }
              subPositive={visitsDelta > 0 ? true : visitsDelta < 0 ? false : undefined}
            />
            <KpiCard
              title="Top Platform"
              icon={Globe}
              value={topPlatform ? getPlatformName(topPlatform.platform) : '—'}
              sub={topPlatform ? `${topPlatform.visits} visits` : 'no data'}
            />
            <KpiCard
              title="Platforms"
              icon={Globe}
              value={summary?.platformBreakdown.length ?? 0}
              sub="unique AI sources"
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  AI Referral Trend — Last 7 Days
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ReferralTrendChart data={trend} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Platform Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <PlatformBreakdownChart data={summary?.platformBreakdown ?? []} />
              </CardContent>
            </Card>
          </div>

          {/* Tables row */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Platform table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Referrals by Platform</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Platform</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right pr-6">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(summary?.platformBreakdown ?? []).map((row) => (
                      <TableRow key={row.platform} className="hover:bg-muted/50">
                        <TableCell className="pl-6">
                          <span className="font-medium text-sm">
                            {getPlatformName(row.platform)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {row.visits.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end">
                            <DeltaBadge current={row.visits} previous={row.visitsPrev} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Top Pages */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top Landing Pages</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Page</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right pr-6">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(summary?.topPages ?? []).map((row) => (
                      <TableRow key={row.url} className="hover:bg-muted/50">
                        <TableCell className="pl-6 max-w-[200px]">
                          <span className="font-mono text-xs text-muted-foreground line-clamp-1">
                            {row.url}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-sm">
                          {row.visits.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end">
                            <DeltaBadge current={row.visits} previous={row.visitsPrev} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Recent Visit Log */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LayoutList className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium">Recent AI Referral Visits</CardTitle>
                </div>
                {logsTotal > 10 && (
                  <Badge variant="secondary" className="text-xs">
                    {logsTotal} total
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 w-[100px]">Time</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Page</TableHead>
                    <TableHead className="text-right pr-6">Country</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((row) => (
                    <TableRow key={row.id} className="hover:bg-muted/50">
                      <TableCell className="pl-6 text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgo(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {getPlatformName(row.sourcePlatform ?? 'unknown')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground line-clamp-1">
                          {(() => {
                            try {
                              return new URL(row.url).pathname;
                            } catch {
                              return row.url;
                            }
                          })()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <span className="text-xs text-muted-foreground">{row.country ?? '—'}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
