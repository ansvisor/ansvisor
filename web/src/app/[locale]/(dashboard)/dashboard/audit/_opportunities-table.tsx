'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Loader2, Pin } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
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
import { pct } from '@/components/audit/audit-report';
import type { AuditOpportunity, ExcludedPage, OpportunityReason } from '@/lib/actions/audits';
import { formatMonthDay, formatNumber } from '@/lib/format';

/** Rows shown at first, and added by Show more. */
export const OPPORTUNITIES_STEP = 50;

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/** Why a page is listed, as the mockup's chips: "No AI traffic", "Top 5% by revenue"… */
function ReasonChips({ row }: { row: AuditOpportunity }) {
  const t = useTranslations('audit.opportunities.reasons');
  const chip = (reason: OpportunityReason) => {
    switch (reason.type) {
      case 'no_ai_traffic':
        return [
          <Chip key="ai">{t('noAiTraffic')}</Chip>,
          <Chip key="value">
            {t('topValue', {
              share: Math.max(1, Math.round(100 - reason.percentile)),
              signal: t(`signals.${reason.signal}`),
            })}
          </Chip>,
          reason.citationState === 'targeted_not_cited' && (
            <Chip key="cited">{t('targetedNotCited')}</Chip>
          ),
        ];
      case 'never_audited':
        return <Chip key="never">{t('neverAudited')}</Chip>;
      case 'stale_audit':
        return <Chip key="stale">{t('staleAudit', { days: reason.days })}</Chip>;
    }
  };
  return (
    <div className="flex flex-wrap gap-1">
      {row.pinned && (
        <Chip>
          <Pin className="h-3 w-3" />
          {t('pinned')}
        </Chip>
      )}
      {row.reasons.flatMap(chip)}
    </div>
  );
}

function ExcludedList({
  excluded,
  onRestore,
}: {
  excluded: ExcludedPage[];
  onRestore: (urls: string[]) => void;
}) {
  const t = useTranslations('audit.opportunities');
  const [open, setOpen] = useState(false);
  if (excluded.length === 0) return null;
  return (
    <div className="pt-3 text-xs text-muted-foreground">
      <span>{t('excluded', { count: excluded.length })}</span>
      {' · '}
      <button
        type="button"
        className="font-medium text-foreground hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t('hideExcluded') : t('showExcluded')}
      </button>
      {open && (
        <ul className="mt-2 divide-y rounded-md border">
          {excluded.map((page) => (
            <li key={page.key} className="flex items-center gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-foreground" title={page.url}>
                {page.path}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onRestore([page.url])}
              >
                {t('restore')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The Opportunities inbox (SA-004): the brand's pages worth auditing, each
 * with why, pinned pages first. Pages not being audited can be selected for
 * the bulk bar (`toolbar`): Audit selected, Pin, Exclude.
 */
export function OpportunitiesTable({
  opportunities,
  excluded,
  staleDays,
  selected,
  onSelect,
  onRestore,
  toolbar,
}: {
  opportunities: AuditOpportunity[];
  excluded: ExcludedPage[];
  staleDays: number;
  selected: Set<string>;
  onSelect: (keys: string[], on: boolean) => void;
  onRestore: (urls: string[]) => void;
  toolbar?: ReactNode;
}) {
  const t = useTranslations('audit.opportunities');
  const [shown, setShown] = useState(OPPORTUNITIES_STEP);
  const rows = opportunities.slice(0, shown);
  const selectable = rows.filter((r) => !r.running).map((r) => r.key);
  const ticked = selectable.filter((key) => selected.has(key)).length;

  return (
    <Card>
      <CardContent className="py-4">
        {opportunities.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('empty', { days: staleDays })}
          </p>
        ) : (
          <>
            {toolbar}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pr-0">
                    <Checkbox
                      aria-label={t('selectAll')}
                      disabled={selectable.length === 0}
                      checked={
                        ticked === 0 ? false : ticked === selectable.length ? true : 'indeterminate'
                      }
                      onCheckedChange={(on) => onSelect(selectable, on === true)}
                    />
                  </TableHead>
                  {/* The page column takes the room left, and long paths truncate in it. */}
                  <TableHead className="w-full">{t('page')}</TableHead>
                  <TableHead>{t('why')}</TableHead>
                  <TableHead className="text-right">{t('aiVisits')}</TableHead>
                  <TableHead>{t('lastAudit')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.key}
                    data-state={selected.has(row.key) ? 'selected' : undefined}
                  >
                    <TableCell className="w-8 pr-0">
                      <Checkbox
                        aria-label={t('select', { page: row.path })}
                        disabled={row.running}
                        checked={selected.has(row.key)}
                        onCheckedChange={(on) => onSelect([row.key], on === true)}
                      />
                    </TableCell>
                    <TableCell className="max-w-0">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={row.title ?? row.url}
                        className="group inline-flex max-w-full items-center gap-1 font-medium hover:underline"
                      >
                        <span className="truncate">{row.path}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </a>
                    </TableCell>
                    {/* Wide enough for a row of chips; more wrap onto a second line. */}
                    <TableCell className="min-w-[18rem] whitespace-normal">
                      <ReasonChips row={row} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.aiVisits === null ? '—' : formatNumber(row.aiVisits)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.running ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t('running')}
                        </span>
                      ) : row.lastAudit ? (
                        <Link
                          href={`/dashboard/audit/${row.lastAudit.auditId}`}
                          className="hover:underline"
                        >
                          {t('lastAuditValue', {
                            date: formatMonthDay(row.lastAudit.at),
                            score: pct(row.lastAudit.score) ?? '—',
                          })}
                        </Link>
                      ) : (
                        t('never')
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {opportunities.length > shown && (
              <div className="flex justify-center pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShown((n) => n + OPPORTUNITIES_STEP)}
                >
                  {t('showMore')}
                </Button>
              </div>
            )}
          </>
        )}
        <ExcludedList excluded={excluded} onRestore={onRestore} />
      </CardContent>
    </Card>
  );
}
