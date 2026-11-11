'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { importBusinessHubSnapshots } from '@/lib/actions/business-hub';
import { previewCsv, templateCsv, type CsvPreview, type CsvRow } from '@/lib/business-hub/csv';
import type { BusinessHubEntry } from '@/lib/business-hub/numbers';
import { saveBlob } from '@/lib/download';
import { numberFormat } from '@/lib/number-format';
import { cn } from '@/lib/utils';

/** How long a file may be read: two years of weekly rows fit well within it. */
const MAX_FILE_BYTES = 512 * 1024;

/** A file's text, as UTF-8 (a BOM is kept for the parser to drop). */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

const STATUS_CLASS: Record<CsvRow['status'], string> = {
  new: 'text-emerald-700 dark:text-emerald-300',
  replaces: 'text-amber-700 dark:text-amber-300',
  error: 'text-red-700 dark:text-red-300',
};

/**
 * Import CSV, inside the Enter numbers dialog: Ansvisor's own template (the
 * browser builds it: Business Hub has no export), a file chosen, and a
 * preview of every row, new, replacing an entry, or refused and why, before
 * anything is saved. The rows that can be read are saved together, all or
 * none (the API's import). Every member may.
 */
export function BusinessHubImport({
  brandId,
  entries,
  onImported,
  onBack,
}: {
  brandId: string;
  entries: BusinessHubEntry[];
  onImported: () => void;
  onBack: () => void;
}) {
  const t = useTranslations('insights.businessHub.import');
  const tAll = useTranslations('insights.businessHub');
  const locale = useLocale();
  const f = numberFormat(locale);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [importing, setImporting] = useState(false);

  const choose = async (file: File | undefined) => {
    setPreview(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t('readFailed'));
      return;
    }
    try {
      setPreview(previewCsv(await readText(file), entries));
    } catch {
      toast.error(t('readFailed'));
    }
  };

  const save = async () => {
    if (!preview?.importable.length) return;
    setImporting(true);
    try {
      const result = await importBusinessHubSnapshots(brandId, preview.importable);
      if ('error' in result) {
        toast.error(
          result.error === 'demo'
            ? tAll('demo')
            : result.error === 'off'
              ? tAll('off')
              : t('failed'),
        );
        return;
      }
      toast.success(t('imported', { count: result.saved }));
      onImported();
    } catch {
      toast.error(t('failed'));
    } finally {
      setImporting(false);
    }
  };

  const statusText = (row: CsvRow) =>
    row.status !== 'error'
      ? t(`status.${row.status}`)
      : row.reason === 'count'
        ? t('reasons.count', { column: row.column ?? '' })
        : row.reason === 'duplicate'
          ? t('reasons.duplicate', { row: row.sameAs ?? 0 })
          : t(`reasons.${row.reason ?? 'empty'}`);
  const count = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : f.number(n);

  return (
    <div className="space-y-3">
      <p className="text-sm">{t('noExport')}</p>
      <p className="text-xs text-muted-foreground">{t('columnsHint')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() =>
          saveBlob(
            new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }),
            'business-hub-numbers.csv',
          )
        }
      >
        <Download className="h-3.5 w-3.5" />
        {t('template')}
      </Button>
      <div className="space-y-1.5">
        <Label htmlFor="bh-csv-file">{t('choose')}</Label>
        <Input
          id="bh-csv-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>
      {preview?.missingHeader && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {t('missingHeader')}
        </p>
      )}
      {preview && !preview.missingHeader && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground" data-testid="bh-import-summary">
            {t('summary', {
              new: preview.counts.new,
              replaces: preview.counts.replaces,
              errors: preview.counts.errors,
            })}
          </p>
          {preview.truncated > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t('truncated', { count: preview.truncated })}
            </p>
          )}
          <div className="max-h-56 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">{t('columns.row')}</th>
                  <th className="px-2 py-1 font-medium">{t('columns.lastDay')}</th>
                  <th className="px-2 py-1 font-medium">{t('columns.days')}</th>
                  <th className="px-2 py-1 text-right font-medium">{t('columns.mentions')}</th>
                  <th className="px-2 py-1 text-right font-medium">{t('columns.clicks')}</th>
                  <th className="px-2 py-1 text-right font-medium">{t('columns.views')}</th>
                  <th className="px-2 py-1 font-medium">{t('columns.status')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row} className="border-t">
                    <td className="px-2 py-1 tabular-nums">{row.row}</td>
                    <td className="px-2 py-1 tabular-nums">{row.entry?.periodEnd ?? '—'}</td>
                    <td className="px-2 py-1 tabular-nums">{row.entry?.periodDays ?? '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {count(row.entry?.mentions)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {count(row.entry?.websiteClicks)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {count(row.entry?.profileViews)}
                    </td>
                    <td className={cn('px-2 py-1', STATUS_CLASS[row.status])}>{statusText(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={importing} onClick={onBack}>
          {t('back')}
        </Button>
        <Button
          type="button"
          disabled={importing || !preview?.importable.length}
          onClick={() => void save()}
          className={cn(importing && 'gap-1.5')}
        >
          {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {importing ? t('importing') : t('import', { count: preview?.importable.length ?? 0 })}
        </Button>
      </div>
    </div>
  );
}
