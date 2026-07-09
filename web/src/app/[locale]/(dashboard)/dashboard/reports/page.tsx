'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useBrandStore } from '@/stores/use-brand-store';
import { createReport, getReports, deleteReport, type ReportListItem } from '@/lib/actions/reports';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FileBarChart, Loader2, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type DatePreset = '7d' | '30d' | '90d' | 'custom';

/** Resolve a preset into the concrete [from, to] ISO range a report snapshots. */
function getDateRange(preset: DatePreset, custom: { from: string; to: string }) {
  if (preset === 'custom') {
    return {
      dateFrom: custom.from ? `${custom.from}T00:00:00.000Z` : '',
      dateTo: custom.to ? `${custom.to}T23:59:59.999Z` : '',
    };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function ReportsPage() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);

  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [preset, setPreset] = useState<DatePreset>('30d');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [reportTitle, setReportTitle] = useState('');

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    try {
      setReports(await getReports(activeBrandId));
    } catch (err) {
      console.error('Failed to load reports:', err);
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async () => {
    if (!activeBrandId) return;
    const { dateFrom, dateTo } = getDateRange(preset, customRange);
    if (!dateFrom || !dateTo) {
      toast.error(t('selectDates'));
      return;
    }
    setGenerating(true);
    try {
      const { id } = await createReport(activeBrandId, {
        dateFrom,
        dateTo,
        title: reportTitle || undefined,
      });
      toast.success(t('generated'));
      setDialogOpen(false);
      router.push(`/dashboard/reports/${id}`);
    } catch (err) {
      console.error('Report generation error:', err);
      toast.error(t('generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('deleteConfirm'))) return;
    setDeletingId(id);
    try {
      await deleteReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('Report delete error:', err);
      toast.error(t('deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button className="gap-2" onClick={() => setDialogOpen(true)} disabled={!activeBrandId}>
          <Plus className="h-4 w-4" />
          {t('generateReport')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('libraryTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tc('loading')}
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <FileBarChart className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t('emptyLibrary')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.title')}</TableHead>
                  <TableHead>{t('columns.period')}</TableHead>
                  <TableHead>{t('columns.created')}</TableHead>
                  <TableHead className="w-[140px] text-right">{t('columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-medium">{report.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(report.dateFrom)} — {formatDate(report.dateTo)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(report.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push(`/dashboard/reports/${report.id}`)}
                        >
                          {tc('view')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={deletingId === report.id}
                          onClick={() => handleDelete(report.id)}
                        >
                          {deletingId === report.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => !generating && setDialogOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('reportTitleLabel')}</p>
              <Input
                placeholder={t('reportTitlePlaceholder')}
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                disabled={generating}
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('dateRange')}</p>
              <div className="flex gap-1">
                {(['7d', '30d', '90d', 'custom'] as DatePreset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPreset(p)}
                    disabled={generating}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-xs transition-colors',
                      preset === p
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                    )}
                  >
                    {t(`presets.${p}`)}
                  </button>
                ))}
              </div>
              {preset === 'custom' && (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    type="date"
                    value={customRange.from}
                    onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                    disabled={generating}
                    className="text-sm"
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <Input
                    type="date"
                    value={customRange.to}
                    onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                    disabled={generating}
                    className="text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={generating}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleGenerate} disabled={generating} className="gap-2">
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {generating ? t('generating') : t('generateReport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
