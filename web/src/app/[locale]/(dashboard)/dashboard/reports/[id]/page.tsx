'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';

// Reuse the insights page's Recharts trend chart (same VisibilityTrendPoint
// shape the report payload stores), loaded client-only like insights does.
const TrendChart = dynamic(() => import('../../insights/_charts').then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full" />,
});
import { toast } from 'sonner';
import { getReport, type Report } from '@/lib/actions/reports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, FileDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLATFORM_LABELS } from '@/config/platform-labels';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Signed percentage delta with up/down coloring; renders nothing for null. */
function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className={cn('text-xs font-medium', up ? 'text-emerald-600' : 'text-red-600')}>
      {up ? '+' : ''}
      {value}%
    </span>
  );
}

function KpiCard({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: number | null;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold">{value}</span>
          <Delta value={change} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const t = useTranslations('reports');

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getReport(id)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => console.error('Failed to load report:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-sm text-muted-foreground">{t('notFound')}</p>
        <Link
          href="/dashboard/reports"
          className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backToReports')}
        </Link>
      </div>
    );
  }

  const { payload } = report;
  const maxSov = Math.max(...payload.shareOfVoice.byPlatform.map((p) => p.sov), 1);

  // Render a true vector PDF from the saved payload with @react-pdf/renderer
  // (selectable text, exact layout — no screenshot artifacts). The renderer
  // and the document component both load on demand: PDF export is rare and
  // the library is heavy.
  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const [{ pdf }, { ReportPdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./_report-pdf'),
      ]);
      const blob = await pdf(<ReportPdfDocument report={report} />).toBlob();

      const slug =
        payload.brandName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'brand';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ansvisor_${slug}_report_${report.dateTo.slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download error:', err);
      toast.error(t('downloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            href="/dashboard/reports"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('backToReports')}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{report.title}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(report.dateFrom)} — {formatDate(report.dateTo)} · {t('generatedOn')}{' '}
            {formatDate(report.createdAt)}
          </p>
        </div>
        <Button onClick={handleDownloadPdf} disabled={downloading} className="gap-2">
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="h-4 w-4" />
          )}
          {t('downloadPDF')}
        </Button>
      </div>

      {/* Everything below renders from the immutable saved payload; the
          container id is the future PDF capture root. */}
      <div id="report-root" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('executiveSummary')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {payload.summaryText}
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label={t('kpi.visibility')}
            value={`${payload.insights.avgVisibilityScore}%`}
            change={payload.insights.visibilityChange}
          />
          <KpiCard
            label={t('kpi.mentions')}
            value={String(payload.insights.totalMentions)}
            change={payload.insights.mentionsChange}
          />
          <KpiCard
            label={t('kpi.citations')}
            value={String(payload.insights.totalCitations)}
            change={payload.insights.citationsChange}
          />
          <KpiCard
            label={t('kpi.sentiment')}
            value={`${payload.insights.positiveSentimentPct}%`}
            change={payload.insights.sentimentChange}
          />
        </div>

        {/* Optional sections below guard on their payload field: reports
            generated before a section shipped simply don't render it. */}
        {payload.visibilityTrend && payload.visibilityTrend.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('visibilityTrend')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart data={payload.visibilityTrend} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-baseline gap-2 text-base">
              {t('shareOfVoice')}
              <span className="text-2xl font-bold">{payload.shareOfVoice.overallSov}%</span>
              <Delta value={payload.shareOfVoice.overallSovChange} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {payload.shareOfVoice.byPlatform.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noData')}</p>
            ) : (
              payload.shareOfVoice.byPlatform.map((p) => (
                <div key={p.provider} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm">{p.provider}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min((p.sov / maxSov) * 100, 100)}%` }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-sm font-medium">{p.sov}%</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('competitorLeaderboard')}</CardTitle>
          </CardHeader>
          <CardContent>
            {payload.competitors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noData')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.brand')}</TableHead>
                    <TableHead className="text-right">{t('kpi.visibility')}</TableHead>
                    <TableHead className="text-right">{t('columns.change')}</TableHead>
                    <TableHead className="text-right">{t('kpi.mentions')}</TableHead>
                    <TableHead className="text-right">{t('kpi.citations')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.competitors.map((c) => (
                    <TableRow key={c.name} className={cn(c.isOwnBrand && 'bg-primary/5')}>
                      <TableCell className={cn('font-medium', c.isOwnBrand && 'text-primary')}>
                        {c.name}
                        {c.isOwnBrand && (
                          <span className="ml-2 text-xs text-muted-foreground">{t('you')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{c.avgVisibilityScore}%</TableCell>
                      <TableCell className="text-right">
                        <Delta value={c.change} />
                      </TableCell>
                      <TableCell className="text-right">{c.totalMentions}</TableCell>
                      <TableCell className="text-right">{c.totalCitations}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {payload.promptPerformance &&
          (payload.promptPerformance.best.length > 0 ||
            payload.promptPerformance.worst.length > 0) && (
            <div className="grid gap-6 lg:grid-cols-2">
              {(
                [
                  ['bestPrompts', payload.promptPerformance.best],
                  ['worstPrompts', payload.promptPerformance.worst],
                ] as const
              ).map(
                ([key, prompts]) =>
                  prompts.length > 0 && (
                    <Card key={key}>
                      <CardHeader>
                        <CardTitle className="text-base">{t(key)}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('columns.prompt')}</TableHead>
                              <TableHead className="w-24 text-right">
                                {t('kpi.visibility')}
                              </TableHead>
                              <TableHead className="w-16 text-right">{t('columns.runs')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {prompts.map((p) => (
                              <TableRow key={p.text}>
                                <TableCell className="max-w-[280px] truncate font-medium">
                                  {p.text}
                                </TableCell>
                                <TableCell className="text-right">{p.avgVisibility}%</TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {p.runs}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  ),
              )}
            </div>
          )}

        {payload.queryFanout && payload.queryFanout.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('queryFanout')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('queryFanoutDescription')}</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.query')}</TableHead>
                    <TableHead>{t('columns.engines')}</TableHead>
                    <TableHead className="w-32 text-right">{t('columns.timesSearched')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.queryFanout.map((q) => (
                    <TableRow key={q.query}>
                      <TableCell className="max-w-[320px] truncate font-medium">
                        {q.query}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {q.engines.map((e) => PLATFORM_LABELS[e] ?? e).join(', ')}
                      </TableCell>
                      <TableCell className="text-right">{q.timesSearched}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('topCitationSources')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('citationTotals', {
                domains: payload.citations.totals.domains,
                citations: payload.citations.totals.citations,
              })}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {payload.citations.topDomains.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noData')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.domain')}</TableHead>
                    <TableHead>{t('columns.sourceType')}</TableHead>
                    <TableHead className="text-right">{t('kpi.citations')}</TableHead>
                    <TableHead className="text-right">{t('columns.usage')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payload.citations.topDomains.map((d) => (
                    <TableRow key={d.domain}>
                      <TableCell className="font-medium">{d.domain}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {d.category}
                      </TableCell>
                      <TableCell className="text-right">{d.totalCitations}</TableCell>
                      <TableCell className="text-right">{d.usagePct}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
