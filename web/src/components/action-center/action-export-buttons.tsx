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
  actionContextTags,
  actionEventText,
  actionGoal,
  actionTexts,
  taskText,
} from '@/lib/action-center/display';
import {
  actionCsv,
  actionExportFileName,
  actionMarkdown,
  actionWorkbook,
  buildActionExport,
  type ActionExport,
  type ExportFact,
} from '@/lib/action-center/export';
import { opportunityLists } from '@/lib/content/opportunity-lists';
import { priorityReasonText } from '@/lib/action-center/priority';
import { isKpiKey } from '@/lib/kpis/registry';
import { signalAffected, signalTexts } from '@/lib/signals/display';
import { SIGNAL_KINDS } from '@/lib/signals/registry';
import { viewerTimeZone } from '@/lib/time-zone';
import { isSuperseded } from './signal-table';

// Written out so Excel reads the CSV as UTF-8 and keeps Turkish characters.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const IMPROVE_STATES = ['not_mentioned', 'mentioned_late', 'not_cited', 'doing_well', 'no_runs'];

/** Saves a file the browser built, as the actions list's export does. */
function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoked once the download has started; at once, some browsers drop it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
}: {
  action: ActionItem;
  detail: ActionDetail | null;
}) {
  const t = useTranslations('actionCenter.actionsPage');
  const tExport = useTranslations('actionCenter.actionsPage.export');
  const tImprove = useTranslations('actionCenter.actionsPage.drawer.improve');
  const tOpportunity = useTranslations('actionCenter.actionsPage.drawer.opportunity');
  const tContent = useTranslations('content');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tRegistry = useTranslations('actionCenter.registry');
  const tTasks = useTranslations('actionCenter.actionTasks');
  const tTaskStatus = useTranslations('actionCenter.taskStatus');
  const tSignals = useTranslations('actionCenter.signalsPage');
  const tSignalTexts = useTranslations('actionCenter.signalTexts');
  const tSignalCategories = useTranslations('actionCenter.signalCategories');
  const tPriority = useTranslations('actionCenter.actionsPage.priority');
  const [isBusy, setIsBusy] = useState(false);
  // The Markdown Copy Data shows, and what to say once it is copied.
  const [preview, setPreview] = useState<{ text: string; copied: string } | null>(null);
  const [justCopied, setJustCopied] = useState(false);
  const previewRef = useRef<HTMLTextAreaElement>(null);

  /** What the Overview tab shows of where a person sent the action from. */
  const sentFrom = async (origin: string): Promise<ExportFact[]> => {
    const p = action.payload ?? {};
    if (action.kind === 'prompt_improve') {
      const platforms = Array.isArray(p.platforms)
        ? (p.platforms as { label?: unknown; state?: unknown }[]).filter(
            (x): x is { label: string; state: string } =>
              typeof x.label === 'string' &&
              typeof x.state === 'string' &&
              IMPROVE_STATES.includes(x.state),
          )
        : [];
      const facts: ExportFact[] = [{ label: tImprove('source'), value: tImprove('sourceValue') }];
      if (typeof p.promptText === 'string') {
        facts.push({ label: tImprove('prompt'), value: p.promptText });
      }
      if (platforms.length) {
        facts.push({
          label: tImprove('platforms'),
          value: platforms.map((x) => `${x.label} · ${tImprove(`states.${x.state}`)}`),
        });
      }
      if (typeof p.panelLink === 'string') {
        facts.push({ label: tImprove('openPanel'), value: `${origin}${p.panelLink}` });
      }
      return facts;
    }
    if (action.kind !== 'content_opportunity' || typeof p.opportunityId !== 'string') return [];

    const pageUrls = Array.isArray(p.pages)
      ? (p.pages as unknown[]).filter((u): u is string => typeof u === 'string')
      : [];
    try {
      const [opportunity, basket] = await Promise.all([
        getOpportunity(p.opportunityId),
        getOpportunityBasket(p.opportunityId),
      ]);
      const { pages, prompts, queries } = opportunityLists(
        opportunity,
        basket,
        p.assetKey ? pageUrls : undefined,
      );
      const brief = opportunity.brief;
      const facts: ExportFact[] = [
        { label: tOpportunity('title'), value: opportunity.title },
        { label: tOpportunity('open'), value: `${origin}/dashboard/content/${opportunity.id}` },
      ];
      if (opportunity.decision) {
        facts.push({
          label: tExport('decision'),
          value: tContent(`decision.${opportunity.decision}`),
        });
      }
      if (pages.length) {
        facts.push({ label: tExport('pages'), value: pages.map((page) => page.url) });
      }
      if (brief) {
        facts.push({
          label: tOpportunity('brief'),
          value: [
            `${brief.suggestedTitle} · ${brief.contentType.replace(/-/g, ' ')} · ${tOpportunity('words', { count: brief.targetWordCount })}`,
            ...brief.outline.map(
              (section, i) =>
                `${i + 1}. ${section.heading}${section.keyPoints.length ? `: ${section.keyPoints.join('; ')}` : ''}`,
            ),
          ],
        });
      }
      if (prompts.length) {
        facts.push({
          label: tOpportunity('prompts', { count: prompts.length }),
          value: prompts.map((prompt) => prompt.text),
        });
      }
      if (queries.length) {
        facts.push({
          label: tOpportunity('queries', { count: queries.length }),
          value: queries.map((query) => query.query),
        });
      }
      return facts;
    } catch {
      return [{ label: tOpportunity('title'), value: tOpportunity('unavailable') }];
    }
  };

  const build = async (): Promise<ActionExport | null> => {
    if (!detail) return null;
    const origin = window.location.origin;
    const texts = actionTexts(action, tTexts);
    const related: string[] = action.kpiKeys.filter(isKpiKey);
    return buildActionExport(
      action,
      detail,
      {
        title: texts.title,
        // A scored action always has a level: one read from its score if need be.
        priority:
          action.priorityScore !== null && action.priorityLevel !== null
            ? {
                label: t('export.priorityValue', {
                  score: action.priorityScore,
                  level: tPriority(`levels.${action.priorityLevel}`),
                }),
                why: action.priorityReason
                  ? priorityReasonText(action.priorityReason, tPriority)
                  : '',
              }
            : null,
        why: texts.description,
        goal: actionGoal(action.kind, tTexts, action.payload),
        category: tCategories(action.category),
        status: t(`status.${action.status}`),
        tags: actionContextTags(action, t),
        kpis: detail.kpis
          .filter((kpi) => related.includes(kpi.kpiKey) && isKpiKey(kpi.kpiKey))
          .map(
            (kpi) =>
              `${tRegistry(`${kpi.kpiKey}.name`)} (${t('drawer.kpiTarget', { target: kpi.target })})`,
          ),
        context: await sentFrom(origin),
        taskTitle: (task) => taskText(task, tTasks),
        taskStatus: (status) => tTaskStatus(status),
        signal: (signal) => {
          const affected = signalAffected(signal, tSignals);
          return {
            ...signalTexts(signal, tSignalTexts),
            type: `${tSignalCategories(signal.category)} · ${tSignals(`states.${SIGNAL_KINDS[signal.kind].stateKey}`)}`,
            entity: affected.detail ?? affected.label,
            category: tSignalCategories(signal.category),
            status: isSuperseded(signal)
              ? tSignals('superseded')
              : tSignals(`status.${signal.status}`),
            impact: tSignals(`impact.${signal.impact}`),
          };
        },
        event: (event) => actionEventText(event, t, tTasks),
        skipped: (reason) => tExport('skipped', { reason }),
        answerSource: tExport('answerSource'),
      },
      { origin, timeZone: viewerTimeZone() },
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

  /** Copy Data: the whole action, every tab, shown to copy in one click. */
  const showData = (data: ActionExport) => {
    setJustCopied(false);
    setPreview({
      text: actionMarkdown(data, tExport),
      copied: tExport('copied', {
        ref: data.ref,
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
    save(
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
