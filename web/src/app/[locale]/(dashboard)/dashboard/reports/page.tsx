'use client';

import { useState, useEffect, useCallback } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useServerErrorText } from '@/hooks/use-server-error';
import { toast } from 'sonner';
import { useBrandStore } from '@/stores/use-brand-store';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useUserRole } from '@/hooks/use-user-role';
import {
  createReport,
  getReport,
  getReports,
  deleteReport,
  renameReport,
  type ReportListItem,
} from '@/lib/actions/reports';
import { getReportBranding } from '@/lib/actions/white-label';
import { brandHasShipped } from '@/lib/actions/impact-report';
import { saveReportPdf } from './_save-pdf';
import { useChatPageContext } from '@/components/chat/panel/chat-panel-context';
import { viewRows } from '@/lib/chat/page-view';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { REPORT_TEMPLATE_TITLES } from '@/lib/reports/template-titles';
import { samePeriodReport } from '@/lib/reports/same-period';
import {
  Check,
  Crown,
  FileBarChart,
  FileDown,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  REPORT_TEMPLATES,
  ALL_REPORT_SECTIONS,
  type ReportSection,
  type ReportTemplateId,
} from '@/lib/reports/templates';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';

type DatePreset = '7d' | '30d' | '90d' | 'custom';

const KNOWN_TEMPLATE_IDS = new Set<string>(REPORT_TEMPLATES.map((tpl) => tpl.id));

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

export default function ReportsPage() {
  const t = useTranslations('reports');
  const chatAgentic = useChatAgentic();
  const tc = useTranslations('common');
  // A read-only workspace (plan not active): Generate report and Delete open
  // the upgrade dialog instead; reading and downloading reports stay open.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const serverError = useServerErrorText();
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const brands = useBrandStore((s) => s.brands);

  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  // Renaming is an Admin's or a Manager's, as the server checks (RP-11).
  const { canManage } = useUserRole();
  // Rename (UX audit RP-11): the report, and the title being typed.
  const [renaming, setRenaming] = useState<ReportListItem | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  const [template, setTemplate] = useState<ReportTemplateId>('executive_summary');
  const [preset, setPreset] = useState<DatePreset>('30d');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [reportTitle, setReportTitle] = useState('');
  // A report with the same template and days, found on Generate (RP-11).
  const [duplicate, setDuplicate] = useState<ReportListItem | null>(null);
  // US-1.1: the dialog can generate for any brand, defaulting to the active one.
  const [reportBrandId, setReportBrandId] = useState<string | null>(activeBrandId);
  // US-1.3: templates only pre-select; the user adjusts the module set freely.
  const [sections, setSections] = useState<Set<ReportSection>>(
    () => new Set(REPORT_TEMPLATES.find((tpl) => tpl.id === 'executive_summary')!.sections),
  );

  // What Ansvisor did for you shows once the brand has shipped something:
  // before, the report is empty. Shown only on a yes, so it never flashes.
  const [shipped, setShipped] = useState<{ brandId: string; yes: boolean } | null>(null);
  useEffect(() => {
    if (!chatAgentic || !activeBrandId) return;
    let current = true;
    brandHasShipped(activeBrandId)
      .then((yes) => {
        if (current) setShipped({ brandId: activeBrandId, yes });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [chatAgentic, activeBrandId]);
  const showImpact = chatAgentic && shipped?.brandId === activeBrandId && shipped.yes;

  const reportBrand = brands.find((b) => b.id === (reportBrandId ?? activeBrandId));
  // Shopping is brand-pref-gated: hidden here exactly like the sidebar hides
  // the Shopping nav item (and the server refuses to gather it regardless).
  const pickableSections = ALL_REPORT_SECTIONS.filter(
    (s) => s !== 'shoppingVisibility' || reportBrand?.shoppingModeEnabled,
  );
  // HubSpot's AI-sourced pipeline (#2140) comes with the plan's
  // crm_integrations: below it, shown off with the plan it needs.
  const { canUse, requiredPlanFor } = useFeatureGate();
  const lockedSection = (s: ReportSection) => s === 'aiPipeline' && !canUse('crm_integrations');

  const selectTemplate = (id: ReportTemplateId) => {
    setTemplate(id);
    setDuplicate(null);
    // Templates carry a sensible default window (weekly → 7d) and a default
    // module set; the user can still override both below.
    const def = REPORT_TEMPLATES.find((tpl) => tpl.id === id);
    if (def) {
      setPreset(def.defaultPreset);
      setSections(new Set(def.sections));
    }
  };

  const toggleSection = (s: ReportSection) => {
    setSections((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const openDialog = guard(
    () => {
      setReportBrandId(activeBrandId);
      setDuplicate(null);
      setDialogOpen(true);
    },
    { action: tActions('generateReports') },
  );

  const load = useCallback(async () => {
    if (!activeBrandId) return;
    setLoading(true);
    try {
      setReports(await getReports(activeBrandId));
    } catch (err) {
      console.error('Failed to load reports:', err);
      toast.error(serverError(err, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, t, serverError]);

  useEffect(() => {
    load();
  }, [load]);

  // Chat's side panel sees the page (the owner's plan of 2026-11-16, step 9): once read, the
  // saved reports listed by id, each with its title and the days it covers, and how many.
  useChatPageContext(
    activeBrandId
      ? {
          pageName: t('title'),
          view: loading
            ? {}
            : {
                rows: viewRows(reports, (report) => ({
                  ref: report.id,
                  label: `${report.title} (${report.dateFrom.slice(0, 10)} – ${report.dateTo.slice(0, 10)})`,
                })),
                total: reports.length,
              },
        }
      : null,
  );

  /**
   * Generate; a report of the same template and days on this brand asks
   * first, "Same period as an existing report. Open it?" (UX audit RP-11),
   * unless `anyway`.
   */
  const handleGenerate = async (anyway = false) => {
    const targetBrandId = reportBrandId ?? activeBrandId;
    if (!targetBrandId) return;
    const { dateFrom, dateTo } = getDateRange(preset, customRange);
    if (!dateFrom || !dateTo) {
      toast.error(t('selectDates'));
      return;
    }
    if (sections.size === 0) {
      toast.error(t('selectSections'));
      return;
    }
    const same =
      targetBrandId === activeBrandId
        ? samePeriodReport(reports, { template, dateFrom, dateTo })
        : null;
    if (same && !anyway) {
      setDuplicate(same);
      return;
    }
    setDuplicate(null);
    setGenerating(true);
    try {
      const { id } = await createReport(targetBrandId, {
        dateFrom,
        dateTo,
        title: reportTitle || undefined,
        template,
        sections: pickableSections.filter((s) => sections.has(s) && !lockedSection(s)),
      });
      toast.success(t('generated'));
      setDialogOpen(false);
      router.push(`/dashboard/reports/${id}`);
    } catch (err) {
      console.error('Report generation error:', err);
      toast.error(serverError(err, t('generateFailed')));
    } finally {
      setGenerating(false);
    }
  };

  const handleRename = async () => {
    if (!renaming || savingTitle) return;
    const title = newTitle.replace(/\s+/g, ' ').trim();
    if (!title || title === renaming.title) {
      setRenaming(null);
      return;
    }
    setSavingTitle(true);
    try {
      if (!(await renameReport(renaming.id, title))) throw new Error('not renamed');
      setReports((prev) => prev.map((r) => (r.id === renaming.id ? { ...r, title } : r)));
      setRenaming(null);
      toast.success(t('rename.done'));
    } catch (err) {
      console.error('Report rename error:', err);
      toast.error(t('rename.failed'));
    } finally {
      setSavingTitle(false);
    }
  };

  // Share and Download in the row's menu (UX audit RP-09). The link opens the
  // report for anyone in the workspace; reports have no public link.
  const handleCopyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/dashboard/reports/${id}`);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(t('copyLinkFailed'));
    }
  };

  // The same PDF as the report's page: the saved report and the white label
  // kit are read first, and a kit that couldn't be read makes no PDF.
  const handleDownload = async (item: ReportListItem) => {
    setDownloadingId(item.id);
    try {
      const [report, branding] = await Promise.all([
        getReport(item.id),
        getReportBranding(item.brandId).catch(() => ({ ok: false }) as const),
      ]);
      if (!report) {
        toast.error(t('notFound'));
        return;
      }
      if (!branding.ok) {
        toast.error(t('brandingFailed'));
        return;
      }
      await saveReportPdf(report, branding.branding);
    } catch (err) {
      console.error('PDF download error:', err);
      toast.error(t('downloadFailed'));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      setPendingConfirm(null);
    } catch (err) {
      console.error('Report delete error:', err);
      toast.error(serverError(err, t('deleteFailed')));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground">{t('description')}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* What Ansvisor did for you (CHAT-22 §2 item 5): with the new Chat on, once the brand has shipped. */}
            {showImpact && (
              <Link
                href="/dashboard/reports/impact"
                data-action="reports.openImpact"
                className={buttonVariants({ variant: 'outline' })}
              >
                {t('impactLink')}
              </Link>
            )}
            <Button className="gap-2" onClick={openDialog} disabled={!activeBrandId}>
              <Plus className="h-4 w-4" />
              {t('generateReport')}
            </Button>
          </div>
        </div>
      </HeaderWithAiUsage>

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
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.title')}</TableHead>
                    <TableHead>{t('columns.period')}</TableHead>
                    <TableHead>{t('columns.created')}</TableHead>
                    <TableHead className="w-[140px] text-end">{t('columns.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>
                        <span className="font-medium">{report.title}</span>
                        {/* The template's name under a title of the person's own;
                            a default title already is it. */}
                        {KNOWN_TEMPLATE_IDS.has(report.template) &&
                          report.title !==
                            REPORT_TEMPLATE_TITLES[report.template as ReportTemplateId] &&
                          t.has(`templates.${report.template}.name`) && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {t(`templates.${report.template}.name`)}
                            </span>
                          )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(report.dateFrom)} — {formatDate(report.dateTo)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(report.createdAt)}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/dashboard/reports/${report.id}`)}
                          >
                            {tc('view')}
                          </Button>
                          {/* Delete sits in the row's menu, away from View, and asks
                              first (UX audit RP-10). */}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                              disabled={deletingId === report.id || downloadingId === report.id}
                              aria-label={t('rowMenuLabel', { title: report.title })}
                            >
                              {deletingId === report.id || downloadingId === report.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="h-4 w-4" />
                              )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {canManage && (
                                <DropdownMenuItem
                                  data-action="reports.rename"
                                  onClick={guard(
                                    () => {
                                      setNewTitle(report.title);
                                      setRenaming(report);
                                    },
                                    { action: tActions('renameReports') },
                                  )}
                                >
                                  <Pencil className="h-4 w-4" />
                                  {t('rename.item')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                data-action="reports.copyLink"
                                onClick={() => void handleCopyLink(report.id)}
                              >
                                <Link2 className="h-4 w-4" />
                                {t('copyLink')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                data-action="reports.downloadPdf"
                                onClick={() => void handleDownload(report)}
                              >
                                <FileDown className="h-4 w-4" />
                                {t('downloadPDF')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={guard(() => setPendingConfirm(report.id), {
                                  action: tActions('deleteReports'),
                                })}
                              >
                                <Trash2 className="h-4 w-4" />
                                {t('deleteTitle')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Dialog
                open={renaming !== null}
                onOpenChange={(v) => !v && !savingTitle && setRenaming(null)}
              >
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t('rename.title')}</DialogTitle>
                    <DialogDescription>{t('rename.description')}</DialogDescription>
                  </DialogHeader>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRename();
                    }}
                    className="space-y-4"
                  >
                    <Input
                      autoFocus
                      aria-label={t('rename.label')}
                      data-action="reports.renameTitle"
                      value={newTitle}
                      maxLength={200}
                      onChange={(e) => setNewTitle(e.target.value)}
                      disabled={savingTitle}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setRenaming(null)}
                        disabled={savingTitle}
                      >
                        {tc('cancel')}
                      </Button>
                      <Button
                        type="submit"
                        data-action="reports.saveTitle"
                        disabled={savingTitle || !newTitle.trim()}
                      >
                        {savingTitle && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                        {t('rename.save')}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              <Dialog
                open={pendingConfirm !== null}
                onOpenChange={(v) => !v && setPendingConfirm(null)}
              >
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{t('deleteTitle')}</DialogTitle>
                    <DialogDescription>{t('deleteConfirm')}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>{tc('cancel')}</DialogClose>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deletingId === pendingConfirm}
                      onClick={(e) => {
                        e.stopPropagation();

                        if (pendingConfirm === null) {
                          return;
                        }

                        void handleDelete(pendingConfirm);
                      }}
                    >
                      {deletingId === pendingConfirm && (
                        <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      )}
                      {tc('delete')}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => !generating && setDialogOpen(open)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('templateLabel')}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {REPORT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => selectTemplate(tpl.id)}
                    disabled={generating}
                    className={cn(
                      // Top-aligned, the cards' text starts on one line (UX audit RP-13).
                      'flex h-full flex-col justify-start rounded-lg border p-3 text-start transition-colors',
                      template === tpl.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/40',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {t.has(`templates.${tpl.id}.name`) ? t(`templates.${tpl.id}.name`) : tpl.id}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t(`presets.${tpl.defaultPreset}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.has(`templates.${tpl.id}.description`) &&
                        t(`templates.${tpl.id}.description`)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tpl.sections.map((s) => (
                        <span
                          key={s}
                          className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {t(`sections.${s}`)}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* The range the template set, right under it, to change (RP-13). */}
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('dateRange')}</p>
              <p className="text-xs text-muted-foreground">{t('dateRangeHint')}</p>
              <div className="flex gap-1">
                {(['7d', '30d', '90d', 'custom'] as DatePreset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setPreset(p);
                      setDuplicate(null);
                    }}
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
                  <DatePicker
                    aria-label={tc('from')}
                    value={customRange.from || null}
                    onChange={(day) => setCustomRange((r) => ({ ...r, from: day ?? '' }))}
                    disabled={generating}
                    className="h-9 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">—</span>
                  <DatePicker
                    aria-label={tc('to')}
                    value={customRange.to || null}
                    onChange={(day) => setCustomRange((r) => ({ ...r, to: day ?? '' }))}
                    disabled={generating}
                    className="h-9 text-sm"
                  />
                </div>
              )}
            </div>

            {brands.length > 1 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('brandLabel')}</p>
                <Select value={reportBrandId ?? ''} onValueChange={(v) => v && setReportBrandId(v)}>
                  <SelectTrigger className="w-full" disabled={generating}>
                    <SelectValue>
                      {(v: string) => brands.find((b) => b.id === v)?.name ?? t('brandLabel')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('sectionsLabel')}</p>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {pickableSections.map((s) => {
                  const locked = lockedSection(s);
                  const on = sections.has(s) && !locked;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSection(s)}
                      disabled={generating || locked}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-start text-xs transition-colors',
                        on
                          ? 'border-primary bg-primary/5'
                          : 'border-border text-muted-foreground hover:border-muted-foreground/40',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                          on
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-muted-foreground/30',
                        )}
                      >
                        {on && <Check className="h-2.5 w-2.5" />}
                      </span>
                      {t(`sections.${s}`)}
                      {locked && (
                        <span className="ms-auto inline-flex items-center gap-0.5 rounded border px-1 text-[10px] font-medium">
                          <Crown aria-hidden className="h-2.5 w-2.5" />
                          {requiredPlanFor('crm_integrations')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('reportTitleLabel')}</p>
              <Input
                placeholder={t('reportTitlePlaceholder')}
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                disabled={generating}
              />
            </div>
          </div>

          {duplicate && (
            <div
              role="status"
              data-slot="report-duplicate"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <span className="min-w-0 flex-1">
                {t('duplicate.line', { title: duplicate.title })}
              </span>
              <button
                type="button"
                data-action="reports.openDuplicate"
                onClick={() => router.push(`/dashboard/reports/${duplicate.id}`)}
                className="font-medium underline underline-offset-2"
              >
                {t('duplicate.open')}
              </button>
              <button
                type="button"
                data-action="reports.generateAnyway"
                onClick={() => void handleGenerate(true)}
                className="font-medium underline underline-offset-2"
              >
                {t('duplicate.anyway')}
              </button>
            </div>
          )}

          {/* Always in view, the dialog scrolling above it (RP-13). */}
          <DialogFooter className="sticky -bottom-4 z-10 bg-card">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={generating}>
              {tc('cancel')}
            </Button>
            <Button onClick={() => void handleGenerate()} disabled={generating} className="gap-2">
              {generating && <Loader2 className="h-4 w-4 animate-spin" />}
              {generating ? t('generating') : t('generateReport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
