'use client';

import { Fragment, useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Link, useRouter } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { pct, scoreColor } from '@/components/audit/audit-report';
import type { AuditedPage, AuditedPageStatus, AuditRun } from '@/lib/actions/audits';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS_CLASS: Record<AuditedPageStatus, string> = {
  good: 'bg-green-600/10 text-green-700 dark:bg-green-500/15 dark:text-green-400',
  needs_work: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  improving: 'bg-muted text-muted-foreground',
  running: 'bg-muted text-muted-foreground',
  failed: 'bg-destructive/10 text-destructive',
};

/** A page's label: its path on the brand's primary host, else host and path. */
export function pageLabel(page: Pick<AuditedPage, 'host' | 'path'>, primaryHost: string | null) {
  if (!page.host || page.host === primaryHost) return page.path;
  return page.path === '/' ? page.host : `${page.host}${page.path}`;
}

/** A small line of a page's latest scores (0–1), oldest first. */
export function ScoreSparkline({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const width = 48;
  const height = 16;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const y = (p: number) =>
    max === min ? height / 2 : height - 1 - ((p - min) / (max - min)) * (height - 2);
  const coords = points
    .map((p, i) => `${((i / (points.length - 1)) * width).toFixed(1)},${y(p).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="shrink-0 text-muted-foreground"
    >
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusPill({ status }: { status: AuditedPageStatus }) {
  const t = useTranslations('audit.pages');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_CLASS[status],
      )}
    >
      {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
      {t(`statuses.${status}`)}
    </span>
  );
}

function HistoryRun({ run, onDelete }: { run: AuditRun; onDelete: (id: string) => void }) {
  const t = useTranslations('audit');
  return (
    <li className="flex items-center gap-3 px-3 py-1.5 text-sm">
      <span className="w-48 shrink-0 text-muted-foreground">{formatDateTime(run.createdAt)}</span>
      <span
        className={cn(
          'w-20 shrink-0 font-semibold tabular-nums',
          run.status === 'completed' ? scoreColor(run.totalScore) : 'text-muted-foreground',
        )}
      >
        {run.status === 'completed' ? (pct(run.totalScore) ?? '—') : t(`status.${run.status}`)}
      </span>
      <Link href={`/dashboard/audit/${run.id}`} className="text-primary hover:underline">
        {t('pages.viewReport')}
      </Link>
      <Dialog>
        <DialogTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={t('deleteAudit')}
            />
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteAudit')}</DialogTitle>
            <DialogDescription>{t('deleteConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
            <DialogClose render={<Button variant="destructive" onClick={() => onDelete(run.id)} />}>
              {t('deleteAudit')}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/**
 * The audited pages, one row per page: the row opens its latest report and
 * the arrow lists its earlier audits underneath. Pages not being audited can
 * be selected for the bulk bar (`toolbar`, shown above the rows).
 */
export function AuditPagesTable({
  pages,
  total,
  primaryHost,
  loadingMore,
  onLoadMore,
  onDeleteRun,
  selected,
  onSelect,
  headerAction,
  toolbar,
}: {
  pages: AuditedPage[];
  total: number;
  primaryHost: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
  onDeleteRun: (id: string) => void;
  /** Keys of the selected pages. */
  selected: Set<string>;
  onSelect: (keys: string[], on: boolean) => void;
  /** Beside the title, e.g. Export. */
  headerAction?: ReactNode;
  toolbar?: ReactNode;
}) {
  const t = useTranslations('audit');
  const router = useRouter();
  const idPrefix = useId();
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  // A page being audited can't be re-audited until its run ends.
  const selectable = pages.filter((p) => p.status !== 'running').map((p) => p.key);
  const ticked = selectable.filter((key) => selected.has(key)).length;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <CardTitle className="text-base">{t('pages.title')}</CardTitle>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {formatNumber(total)}
        </span>
        {headerAction && <div className="ml-auto">{headerAction}</div>}
      </CardHeader>
      <CardContent className="pt-0">
        {toolbar}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 pr-0">
                <Checkbox
                  aria-label={t('pages.selectAll')}
                  disabled={selectable.length === 0}
                  checked={
                    ticked === 0 ? false : ticked === selectable.length ? true : 'indeterminate'
                  }
                  onCheckedChange={(on) => onSelect(selectable, on === true)}
                />
              </TableHead>
              <TableHead className="w-9" />
              {/* The page column takes the room left, and long URLs truncate in it. */}
              <TableHead className="w-full">{t('pages.page')}</TableHead>
              <TableHead>{t('pages.score')}</TableHead>
              <TableHead className="text-right">{t('pages.issues')}</TableHead>
              <TableHead>{t('pages.status')}</TableHead>
              <TableHead>{t('pages.lastAudit')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((page, i) => {
              const label = pageLabel(page, primaryHost);
              const historyId = `${idPrefix}-history-${i}`;
              const expanded = open.has(page.key);
              return (
                <Fragment key={page.key}>
                  <TableRow
                    className="cursor-pointer"
                    data-state={selected.has(page.key) ? 'selected' : undefined}
                    onClick={() => router.push(`/dashboard/audit/${page.auditId}`)}
                  >
                    <TableCell className="w-8 pr-0">
                      <Checkbox
                        aria-label={t('pages.select', { page: label })}
                        disabled={page.status === 'running'}
                        checked={selected.has(page.key)}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={(on) => onSelect([page.key], on === true)}
                      />
                    </TableCell>
                    <TableCell className="w-9 pr-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-expanded={expanded}
                        aria-controls={historyId}
                        aria-label={t(expanded ? 'pages.hideHistory' : 'pages.showHistory', {
                          page: label,
                        })}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(page.key);
                        }}
                      >
                        <ChevronRight
                          className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
                        />
                      </Button>
                    </TableCell>
                    <TableCell className="max-w-0">
                      <Link
                        href={`/dashboard/audit/${page.auditId}`}
                        onClick={(e) => e.stopPropagation()}
                        title={page.url}
                        className="block truncate font-medium hover:underline"
                      >
                        {label}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn('w-7 font-semibold tabular-nums', scoreColor(page.score))}
                        >
                          {pct(page.score) ?? '—'}
                        </span>
                        <ScoreSparkline
                          points={page.trend}
                          label={t('pages.trend', {
                            scores: page.trend.map((s) => pct(s)).join(', '),
                          })}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {page.issues === null ? '—' : formatNumber(page.issues)}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={page.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(page.lastAuditedAt)}
                    </TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow id={historyId} className="hover:bg-transparent">
                      <TableCell colSpan={2} />
                      <TableCell colSpan={5} className="pt-0 whitespace-normal">
                        <ul className="divide-y rounded-md border">
                          {page.runs.map((run) => (
                            <HistoryRun key={run.id} run={run} onDelete={onDeleteRun} />
                          ))}
                        </ul>
                        {page.runCount > page.runs.length && (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {t('pages.moreRuns', { count: page.runCount - page.runs.length })}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        {pages.length < total && (
          <div className="flex justify-center pt-3">
            <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('loadMore')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
