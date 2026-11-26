'use client';

/**
 * Add prompt → Bulk import (PROMPT-005): read a one-column .xlsx or .csv of
 * prompts in the browser, preview every row (valid, duplicate, error, over
 * the plan limit), then import the rows that fit in one locked server call.
 * Topic and location are set afterwards from each prompt's Edit.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertCircle, Download, FileSpreadsheet, Info, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toCsv } from '@/lib/csv';
import { formatNumber } from '@/lib/format';
import { importPrompts } from '@/lib/actions/prompt';
import { useWaitingForSpotToast } from '@/components/prompts/waiting-for-spot';
import {
  MAX_IMPORT_ROWS,
  MAX_PROMPT_LENGTH,
  TEMPLATE_HEADER,
  TEMPLATE_ROWS,
  buildPreview,
  cellsToText,
  parseCsv,
  rowsForCsv,
  type ImportRow,
} from '@/lib/prompt-import';

interface Props {
  brandId: string;
  /** Prompt texts the brand already tracks, for duplicate detection. */
  existingTexts: string[];
  /** The dialog's platform and model selection, given to every imported prompt. */
  defaults: { platforms: string[]; models: string[] };
  /** The brand's location, given to every imported prompt. */
  defaultRegion: string;
  /** The plan's tracked-location cap and usage; null when unknown. */
  quota: { maxPrompts: number; used: number; planName: string; planId: string } | null;
  /** Upgrade / Contact us, as the Add prompt limit message shows them. */
  limitActions: React.ReactNode;
  onImported: () => void;
}

function downloadCsv(name: string, csv: string) {
  // BOM so Excel opens UTF-8 (Turkish characters) correctly.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Each status's look; its name is prompts.bulkImport.status.<status>. */
const STATUS_BADGE: Record<ImportRow['status'], { className: string }> = {
  valid: {
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  duplicate: {
    className: 'border-muted-foreground/30 text-muted-foreground',
  },
  error: {
    className: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  },
  over_limit: {
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
};

/**
 * Why a row is skipped, as the reader's language says it: from the row's
 * status (buildPreview's reasons, which the errors CSV keeps in English).
 */
function reasonKey(row: ImportRow): 'empty' | 'tooLong' | 'duplicate' | null {
  if (row.status === 'duplicate') return 'duplicate';
  if (row.status === 'error') return row.text ? 'tooLong' : 'empty';
  return null;
}

export function BulkImportPrompts({
  brandId,
  existingTexts,
  defaults,
  defaultRegion,
  quota,
  limitActions,
  onImported,
}: Props) {
  const [sheet, setSheet] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const planSlots =
    !quota || quota.maxPrompts === -1 ? -1 : Math.max(0, quota.maxPrompts - quota.used);
  // The rows past the plan's limit are imported too, saved waiting for a
  // spot, so the preview holds none back.
  const tWaiting = useTranslations('prompts.waiting');
  const t = useTranslations('prompts.bulkImport');
  const showWaiting = useWaitingForSpotToast();

  const preview = useMemo(
    () => (sheet ? buildPreview(sheet, { existingTexts, freeSlots: -1 }) : null),
    [sheet, existingTexts],
  );
  // Rows that will wait for a spot: one location each, past the free slots.
  const waitingRows =
    planSlots !== -1 && preview ? Math.max(0, preview.counts.valid - planSlots) : 0;

  const readFile = useCallback(
    async (file: File) => {
      setReadError(null);
      setSheet(null);
      setFileName(file.name);
      const name = file.name.toLowerCase();
      try {
        if (name.endsWith('.csv')) {
          setSheet(parseCsv(await file.text()));
        } else if (name.endsWith('.xlsx')) {
          // Loaded on demand: the reader is only needed when someone imports.
          const { readSheet } = await import('read-excel-file/browser');
          setSheet(cellsToText((await readSheet(file)) as unknown[][]));
        } else {
          setReadError(t('chooseFile'));
        }
      } catch {
        setReadError(t('unreadable'));
      }
    },
    [t],
  );

  const overRows = preview?.rows.filter((r) => r.status === 'over_limit') ?? [];
  const errorRows = preview?.rows.filter((r) => r.status === 'error') ?? [];
  const totalCandidates = (preview?.counts.valid ?? 0) + overRows.length;

  const handleImport = async () => {
    if (!preview || preview.importable.length === 0 || importing) return;
    setImporting(true);
    try {
      const result = await importPrompts(
        brandId,
        preview.importable.map((r, idx) => ({
          idx,
          text: r.text,
          topic: null,
          platforms: defaults.platforms,
          models: defaults.models,
          regions: [defaultRegion],
        })),
      );
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      const imported = result.importedIdx.length;
      const notImported = totalCandidates - imported;
      const waiting = result.waitingIdx?.length ?? 0;
      if (showWaiting('import', imported - waiting, waiting)) {
        onImported();
        return;
      }
      toast.success(
        notImported > 0
          ? t('importedSome', { imported, notImported })
          : t('importedAll', { count: imported }),
        { description: result.analysisStarted ? t('analyzing') : t('nextRun') },
      );
      onImported();
    } catch {
      toast.error(t('failed'));
    } finally {
      setImporting(false);
    }
  };

  const linkClass =
    'inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground';

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>
          {t.rich('intro', {
            b: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
          })}
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void readFile(file);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
        )}
      >
        {fileName && !readError ? (
          <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
        ) : (
          <Upload className="h-6 w-6 text-muted-foreground" />
        )}
        <p className="font-medium">{fileName ?? t('drop')}</p>
        <p className="text-xs text-muted-foreground">
          {t('perRow', { max: formatNumber(MAX_IMPORT_ROWS) })}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => downloadCsv('prompts-template.csv', toCsv(TEMPLATE_ROWS, [TEMPLATE_HEADER]))}
        className={linkClass}
      >
        <Download className="h-3.5 w-3.5" />
        {t('template')}
      </button>

      {readError && <p className="text-xs text-red-600 dark:text-red-400">{readError}</p>}

      {preview && (
        <>
          <p className="text-sm">
            {t.rich('counts', {
              valid: preview.counts.valid,
              duplicates: preview.counts.duplicates,
              errors: preview.counts.errors,
              b: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
            {quota && quota.maxPrompts !== -1 && (
              <span className="text-muted-foreground">
                {' '}
                {t('inUse', { used: quota.used, max: quota.maxPrompts })}
              </span>
            )}
          </p>
          {preview.truncated > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {t('truncated', {
                max: formatNumber(MAX_IMPORT_ROWS),
                more: formatNumber(preview.truncated),
              })}
            </p>
          )}
          {preview.extraColumns && (
            <p className="text-xs text-muted-foreground">{t('extraColumns')}</p>
          )}

          {waitingRows > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <div className="space-y-2">
                <p className="text-amber-900 dark:text-amber-200">
                  {tWaiting('overNote', { count: waitingRows })}
                </p>
                <div className="flex flex-wrap gap-2">{limitActions}</div>
              </div>
            </div>
          )}

          {overRows.length > 0 && quota && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <div className="space-y-2">
                <p className="text-amber-900 dark:text-amber-200">
                  {preview.counts.valid === 0
                    ? t('noneImportable', {
                        plan: quota.planName,
                        max: quota.maxPrompts,
                        used: quota.used,
                      })
                    : t('someImportable', {
                        valid: preview.counts.valid,
                        total: totalCandidates,
                        plan: quota.planName,
                        max: quota.maxPrompts,
                        used: quota.used,
                        count: overRows.length,
                        row: overRows[0].row,
                      })}{' '}
                  {t('toAddMore', { starter: quota.planId === 'starter' ? 'yes' : 'no' })}
                </p>
                <div className="flex flex-wrap gap-2">{limitActions}</div>
              </div>
            </div>
          )}

          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-start text-muted-foreground">
                <tr>
                  <th className="w-12 px-2 py-1.5 font-medium">{t('head.row')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('head.prompt')}</th>
                  <th className="w-40 px-2 py-1.5 font-medium">{t('head.status')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className="border-t align-top">
                    <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{r.row}</td>
                    <td className="px-2 py-1.5 break-words">{r.text || '—'}</td>
                    <td className="px-2 py-1.5">
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', STATUS_BADGE[r.status].className)}
                      >
                        {t(`status.${r.status}`)}
                      </Badge>
                      {reasonKey(r) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {t(`reason.${reasonKey(r)}`, { max: MAX_PROMPT_LENGTH })}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-3">
              {overRows.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      'prompts-not-imported.csv',
                      toCsv(rowsForCsv(overRows, false), [TEMPLATE_HEADER]),
                    )
                  }
                  className={linkClass}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('downloadNotImported')}
                </button>
              )}
              {errorRows.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      'prompts-errors.csv',
                      toCsv(rowsForCsv(errorRows, true), [TEMPLATE_HEADER, 'reason']),
                    )
                  }
                  className={linkClass}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('downloadErrors')}
                </button>
              )}
            </div>
            <Button
              type="button"
              onClick={handleImport}
              disabled={importing || preview.counts.valid === 0}
            >
              {importing ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="me-2 h-4 w-4" />
              )}
              {t('importButton', { count: preview.counts.valid })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
