'use client';

/**
 * Merging duplicate competitors (00543) on the Competitors page: the Merge
 * dialog (pick the ones that are one company, then the one to keep), the
 * Merged competitors list with Unmerge, the "may be the same company" hint
 * and a kept competitor's other names. A merged competitor's name and domain
 * count for the kept one from the merge on; numbers from before the merge
 * aren't combined.
 */

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, Globe, Loader2, Merge, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { mergeCompetitors, unmergeCompetitor } from '@/lib/actions/competitor';
import { useServerErrorText } from '@/hooks/use-server-error';
import type { CompetitorAlias, MergedCompetitor } from '@/lib/competitor-merge';
import { getFaviconUrl } from '@/lib/favicon';
import { cn } from '@/lib/utils';
import type { Competitor } from '@/types';

function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
      {domain && !failed ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={getFaviconUrl(domain)}
          alt=""
          className="h-4 w-4 rounded-sm"
          onError={() => setFailed(true)}
        />
      ) : (
        <Globe className="h-4 w-4 text-muted-foreground" />
      )}
    </span>
  );
}

/**
 * The Merge dialog. Mounted fresh each time it opens (the page keys it), with
 * the competitors to start from ticked: the "may be the same company" pair,
 * or none.
 */
export function MergeCompetitorsDialog({
  brandId,
  competitors,
  initialIds,
  open,
  onOpenChange,
  onMerged,
}: {
  brandId: string;
  competitors: readonly Competitor[];
  initialIds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a merge that changed something: the kept one and the ones merged now. */
  onMerged: (keptId: string, mergedIds: string[]) => void;
}) {
  const t = useTranslations('competitors.merge');
  const common = useTranslations('competitors');
  const serverError = useServerErrorText();
  const format = useFormatter();
  const groupName = useId();
  const [selected, setSelected] = useState<string[]>(() =>
    initialIds.filter((id) => competitors.some((c) => c.id === id)),
  );
  const [keptId, setKeptId] = useState<string | null>(() => selected[0] ?? null);
  const [saving, setSaving] = useState(false);

  const picked = competitors.filter((c) => selected.includes(c.id));
  const kept = picked.find((c) => c.id === keptId) ?? null;
  const others = picked.filter((c) => c.id !== kept?.id);
  const ready = picked.length >= 2 && kept !== null;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = on ? [...prev, id] : prev.filter((x) => x !== id);
      if (!on && keptId === id) setKeptId(next[0] ?? null);
      if (on && keptId === null) setKeptId(id);
      return next;
    });
  }

  async function submit() {
    if (!ready || !kept) return;
    setSaving(true);
    try {
      const result = await mergeCompetitors(
        brandId,
        kept.id,
        others.map((c) => c.id),
      );
      if (!result.ok) {
        toast.error(
          // Admins and Managers may merge: the generic "Ask an Admin" would be wrong here.
          result.reason === 'forbidden_role'
            ? common('forbiddenRole')
            : serverError({ code: result.reason }, result.message || t('error')),
        );
        return;
      }
      if (result.merged.length > 0) toast.success(t('success', { kept: kept.name }));
      if (result.already.length > 0) {
        toast.info(
          t('already', {
            names: format.list(result.already.map((a) => a.name)),
            count: result.already.length,
          }),
        );
      }
      onMerged(
        kept.id,
        result.merged.map((m) => m.id),
      );
      onOpenChange(false);
    } catch {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <ul className="max-h-72 space-y-1 overflow-y-auto pe-1" aria-label={t('pickLabel')}>
          {competitors.map((c) => {
            const on = selected.includes(c.id);
            const checkboxId = `${groupName}-pick-${c.id}`;
            return (
              <li
                key={c.id}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2',
                  on && 'border-primary/40 bg-primary/5',
                )}
              >
                <Checkbox
                  id={checkboxId}
                  checked={on}
                  onCheckedChange={(value) => toggle(c.id, value === true)}
                  disabled={saving}
                />
                <Favicon domain={c.domain} />
                <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.domain || '—'}
                  </span>
                </label>
                {on && (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
                    <input
                      type="radio"
                      name={groupName}
                      className="h-3.5 w-3.5 accent-primary"
                      checked={keptId === c.id}
                      onChange={() => setKeptId(c.id)}
                      disabled={saving}
                    />
                    {keptId === c.id ? t('kept') : t('keep')}
                  </label>
                )}
              </li>
            );
          })}
        </ul>

        {ready && kept ? (
          <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm" role="status">
            <p className="font-medium">
              {t('summary', {
                others: format.list(others.map((c) => c.name)),
                kept: kept.name,
              })}
            </p>
            <ul className="list-disc space-y-1 ps-5 text-xs text-muted-foreground">
              <li>{t('summaryCount', { kept: kept.name })}</li>
              <li>{t('summaryKeeps', { kept: kept.name })}</li>
              <li className="font-medium text-foreground">{t('summaryHistory')}</li>
              <li>{t('summaryUndo')}</li>
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {picked.length < 2 ? t('pickMore') : t('pickKept')}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {common('cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={!ready || saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
            {t('action', { count: Math.max(others.length, 1) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A kept competitor's other names, under its domain on its card. */
export function CompetitorAliases({
  name,
  aliases,
  className,
}: {
  name: string;
  aliases: readonly CompetitorAlias[] | undefined;
  className?: string;
}) {
  const t = useTranslations('competitors.merge');
  if (!aliases || aliases.length === 0) return null;
  const names = aliases.map((a) => (a.domain ? `${a.name} (${a.domain})` : a.name)).join(', ');
  return (
    <span
      className={cn('block truncate text-[11px] text-muted-foreground', className)}
      title={names}
      aria-label={`${t('aliasesLabel', { name })}: ${names}`}
    >
      {t('aliases', { names })}
    </span>
  );
}

/** "These may be the same company: A and B." with Merge… and Not now. */
export function DuplicateHint({
  a,
  b,
  onMerge,
  onDismiss,
}: {
  a: string;
  b: string;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('competitors.duplicateHint');
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs"
      role="note"
    >
      <Merge className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">{t('text', { a, b })}</span>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onMerge}>
        {t('merge')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground"
        aria-label={t('dismiss')}
        title={t('dismiss')}
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/**
 * The brand's merged competitors, under the list: what was merged into
 * what, when and by whom, with Unmerge for admins and managers (absent
 * `onUnmerge`). Folded until opened.
 */
export function MergedCompetitorsSection({
  merged,
  onUnmerge,
}: {
  merged: readonly MergedCompetitor[];
  onUnmerge?: (competitor: MergedCompetitor) => void;
}) {
  const t = useTranslations('competitors.merged');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (merged.length === 0) return null;

  return (
    <section className="border-t pt-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-start text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((on) => !on)}
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
        {t('title')}
        <span className="tabular-nums">({merged.length})</span>
      </button>
      {open && (
        <div id={panelId} className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">{t('description')}</p>
          <ul className="space-y-1.5">
            {merged.map((m) => {
              const date = format.dateTime(new Date(m.mergedAt), { dateStyle: 'medium' });
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2"
                >
                  <Favicon domain={m.domain} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      <span className="font-medium">{m.name}</span>
                      {m.domain && (
                        <span className="text-muted-foreground"> · {m.domain}</span>
                      )}{' '}
                      <span className="text-muted-foreground">
                        {m.mergedIntoName
                          ? t('into', { kept: m.mergedIntoName })
                          : t('intoUnknown')}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {m.mergedBy
                        ? t('meta', { date, name: m.mergedBy })
                        : t('metaNoName', { date })}
                    </p>
                  </div>
                  {onUnmerge && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      aria-label={t('unmergeFor', { name: m.name })}
                      onClick={() => onUnmerge(m)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      {t('unmerge')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Unmerge's confirmation: what comes back, and what stays with the kept one. */
export function UnmergeCompetitorDialog({
  brandId,
  competitor,
  onOpenChange,
  onUnmerged,
}: {
  brandId: string;
  competitor: MergedCompetitor | null;
  onOpenChange: (open: boolean) => void;
  onUnmerged: (competitorId: string) => void;
}) {
  const t = useTranslations('competitors.unmerge');
  const common = useTranslations('competitors');
  const serverError = useServerErrorText();
  const merged = useTranslations('competitors.merged');
  const [saving, setSaving] = useState(false);
  const name = competitor?.name ?? '';
  const kept = competitor?.mergedIntoName || merged('anotherCompetitor');

  async function confirm() {
    if (!competitor) return;
    setSaving(true);
    try {
      const result = await unmergeCompetitor(brandId, competitor.id);
      if (!result.ok) {
        toast.error(
          // Admins and Managers may merge: the generic "Ask an Admin" would be wrong here.
          result.reason === 'forbidden_role'
            ? common('forbiddenRole')
            : serverError({ code: result.reason }, result.message || t('error')),
        );
        return;
      }
      toast.success(result.unmerged ? t('success', { name }) : t('notMerged', { name }));
      onUnmerged(competitor.id);
      onOpenChange(false);
    } catch {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={competitor !== null} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" />
            {t('title', { name })}
          </DialogTitle>
          <DialogDescription>{t('description', { name, kept })}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {common('cancel')}
          </Button>
          <Button type="button" onClick={confirm} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            {t('action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
