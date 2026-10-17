'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, FileDown, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ActionDetail, ActionItem } from '@/lib/actions/action-center';
import { getOpportunity, getOpportunityBasket } from '@/lib/actions/content';
import {
  BYTE_ORDER_MARK,
  actionCsv,
  actionExportFileName,
  actionMarkdown,
  actionWorkbook,
  type ActionExport,
} from '@/lib/action-center/export';
import {
  EXPORT_NAMESPACES,
  labelActionExport,
  sentFromOpportunityId,
  type ExportTranslators,
  type SentFromOpportunity,
} from '@/lib/action-center/export-labels';
import { viewerTimeZone } from '@/lib/time-zone';
import { affectedCounts, type Affected } from '@/lib/action-center/affected';
import type { ActionStory } from '@/lib/action-center/story';
import { saveBlob } from '@/lib/download';

/**
 * Copy all, Export CSV and Export Excel for one action (AC-005): what every
 * tab of the drawer shows, to take into a doc, a ticket or a spreadsheet.
 * Disabled until the drawer has loaded the action's detail. Copy Data opens the
 * whole action as Markdown: select any part to copy it, or copy it all with
 * the icon.
 */
export function ActionExportButtons({
  action,
  detail,
  affected = null,
  volumes = null,
  story = null,
}: {
  action: ActionItem;
  detail: ActionDetail | null;
  /** The Affected tab's list and its prompts' demand, as the drawer shows them (AC-003). */
  affected?: Affected | null;
  volumes?: Map<string, number> | null;
  /** Why and Goal as the drawer words them, from the action's data (AC-003). */
  story?: ActionStory | null;
}) {
  const tExport = useTranslations('actionCenter.actionsPage.export');
  // Every label the export reads, from the same namespaces the API uses.
  const t: ExportTranslators = {
    page: useTranslations(EXPORT_NAMESPACES.page),
    export: tExport,
    improve: useTranslations(EXPORT_NAMESPACES.improve),
    opportunity: useTranslations(EXPORT_NAMESPACES.opportunity),
    content: useTranslations(EXPORT_NAMESPACES.content),
    texts: useTranslations(EXPORT_NAMESPACES.texts),
    categories: useTranslations(EXPORT_NAMESPACES.categories),
    registry: useTranslations(EXPORT_NAMESPACES.registry),
    tasks: useTranslations(EXPORT_NAMESPACES.tasks),
    taskStatus: useTranslations(EXPORT_NAMESPACES.taskStatus),
    taskTypes: useTranslations(EXPORT_NAMESPACES.taskTypes),
    signals: useTranslations(EXPORT_NAMESPACES.signals),
    signalTexts: useTranslations(EXPORT_NAMESPACES.signalTexts),
    signalCategories: useTranslations(EXPORT_NAMESPACES.signalCategories),
    priority: useTranslations(EXPORT_NAMESPACES.priority),
    affected: useTranslations(EXPORT_NAMESPACES.affected),
  };
  const [isBusy, setIsBusy] = useState(false);
  // The Markdown Copy Data shows, and what to say once it is copied.
  const [preview, setPreview] = useState<{ text: string; copied: string } | null>(null);
  const [justCopied, setJustCopied] = useState(false);
  const previewRef = useRef<HTMLTextAreaElement>(null);

  /** A Content action's opportunity and basket, as the Overview tab reads them. */
  const readSentFrom = async (): Promise<SentFromOpportunity | null> => {
    const id = sentFromOpportunityId(action);
    if (!id) return null;
    try {
      const [opportunity, basket] = await Promise.all([
        getOpportunity(id),
        getOpportunityBasket(id),
      ]);
      return { opportunity, basket };
    } catch {
      return 'unavailable';
    }
  };

  const build = async (): Promise<ActionExport | null> => {
    if (!detail) return null;
    return labelActionExport(
      {
        action,
        detail,
        affected,
        volumes,
        story,
        sentFrom: await readSentFrom(),
        origin: window.location.origin,
        timeZone: viewerTimeZone(),
      },
      t,
    );
  };

  /** Builds the export once, holding the buttons while it runs. */
  const run = async (fn: (data: ActionExport) => Promise<void> | void) => {
    setIsBusy(true);
    try {
      const data = await build();
      if (data) await fn(data);
    } catch {
      toast.error(tExport('exportFailed'));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Copy Data: the whole action, every tab, shown to copy in one click. Once
   * copied it says what went: "7 prompts, 6 tasks, 87 signals", or the pages
   * for an action about pages.
   */
  const showData = (data: ActionExport) => {
    const counts = affected ? affectedCounts(affected) : { prompts: 0, pages: 0 };
    const entity = counts.prompts ? 'prompts' : counts.pages ? 'pages' : 'none';
    setJustCopied(false);
    setPreview({
      text: actionMarkdown(data, tExport),
      copied: tExport('copied', {
        ref: data.ref,
        entity,
        affected: entity === 'pages' ? counts.pages : counts.prompts,
        tasks: data.tasks.length,
        signals: data.signals.length,
      }),
    });
  };

  /**
   * The dialog's Copy: the clipboard, or the browser's copy command on the
   * selected text where the clipboard API is not allowed (an insecure page,
   * an embedded browser).
   */
  const copyAll = async () => {
    if (!preview) return;
    previewRef.current?.select();
    let done = false;
    try {
      await navigator.clipboard.writeText(preview.text);
      done = true;
    } catch {
      try {
        done = document.execCommand('copy');
      } catch {
        done = false;
      }
    }
    if (!done) {
      toast.error(tExport('preview.failed'));
      return;
    }
    toast.success(preview.copied);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 2000);
  };

  const downloadCsv = (data: ActionExport) =>
    saveBlob(
      new Blob([BYTE_ORDER_MARK, actionCsv(data)], { type: 'text/csv;charset=utf-8;' }),
      actionExportFileName(data, 'csv'),
    );

  const downloadExcel = async (data: ActionExport) => {
    // Loaded on demand: the writer is only needed when someone asks for a file.
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    await writeXlsxFile(actionWorkbook(data, tExport)).toFile(actionExportFileName(data, 'xlsx'));
  };

  const disabled = !detail || isBusy;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void run(showData)}>
          <Copy className="h-4 w-4" />
          {tExport('copyAll')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => void run(downloadCsv)}
        >
          <FileDown className="h-4 w-4" />
          {tExport('csv')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => void run(downloadExcel)}
        >
          <FileSpreadsheet className="h-4 w-4" />
          {tExport('excel')}
        </Button>
      </div>
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl" initialFocus={previewRef}>
          <DialogHeader>
            <DialogTitle>{tExport('copyAll')}</DialogTitle>
          </DialogHeader>
          {/* Select any part to copy it, or copy it all with the icon. */}
          <div className="relative">
            <textarea
              ref={previewRef}
              readOnly
              aria-label={tExport('copyAll')}
              value={preview?.text ?? ''}
              className="h-80 w-full resize-none rounded-md border bg-muted/40 p-3 pr-12 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={justCopied ? tExport('preview.copied') : tExport('preview.copy')}
              title={justCopied ? tExport('preview.copied') : tExport('preview.copy')}
              onClick={() => void copyAll()}
              className="absolute top-2 right-2 h-8 w-8 bg-background/80"
            >
              {justCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
