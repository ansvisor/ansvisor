'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Bot, User } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DRAFT_METHOD_BADGE, DRAFT_STATUS_BADGE } from '@/components/content/draft-badges';
import { contentEditorPath, isPageType } from '@/lib/content/drafts';
import { platformNames } from '@/lib/content/impact';
import { pagePath } from '@/lib/content/overlap';
import type { PlanAction, PlanPeriod, PlanRow, PlanWhy } from '@/lib/content/plan';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Create blue, Optimize amber (as the drafts' method), Protect green. */
export const PLAN_ACTION_BADGE: Record<PlanAction, string> = {
  create: DRAFT_METHOD_BADGE.create,
  optimize: DRAFT_METHOD_BADGE.optimize,
  protect: DRAFT_STATUS_BADGE.ready,
};

/**
 * The Plan's priority list (CE-014): rank, the page (a new one, or the
 * brand's own), the action, why for the period with where it comes from,
 * who is on it, and the button that starts it — or opens its draft.
 */
export function PlanTable({
  rows,
  days,
  onStart,
}: {
  rows: PlanRow[];
  days: PlanPeriod;
  onStart: (row: PlanRow) => void;
}) {
  const t = useTranslations('contentEditor.plan');
  const tTypes = useTranslations('contentEditor.pageTypes');

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 pl-6">#</TableHead>
          <TableHead>{t('columns.page')}</TableHead>
          <TableHead>{t('columns.action')}</TableHead>
          <TableHead>{t('columns.why', { days })}</TableHead>
          {/* Wide windows only: the row's button says the same once a draft exists. */}
          <TableHead className="hidden xl:table-cell">{t('columns.who')}</TableHead>
          <TableHead className="pr-6">
            <span className="sr-only">{t('columns.start')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={row.key}>
            <TableCell className="pl-6 tabular-nums text-muted-foreground">{i + 1}</TableCell>
            <TableCell className="max-w-[260px]">
              <p className="truncate font-medium" title={row.title}>
                {row.title}
              </p>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {isPageType(row.pageType) && (
                  <Badge variant="outline" className="shrink-0 font-normal">
                    {tTypes(row.pageType)}
                  </Badge>
                )}
                <span className="truncate" title={row.page ?? undefined}>
                  {row.page ? pagePath(row.page) : t('newPage')}
                </span>
              </p>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className={PLAN_ACTION_BADGE[row.action]}>
                {t(`actions.${row.action}`)}
              </Badge>
            </TableCell>
            <TableCell className="min-w-[200px] max-w-[320px] whitespace-normal">
              <WhyText why={row.why} />
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {t(`sources.${row.source}`)}
              </span>
            </TableCell>
            <TableCell className="hidden text-muted-foreground xl:table-cell">
              {row.draft ? (
                <span className="inline-flex items-center gap-1.5">
                  {row.draft.author === 'agent' ? (
                    <Bot aria-hidden className="h-3.5 w-3.5" />
                  ) : (
                    <User aria-hidden className="h-3.5 w-3.5" />
                  )}
                  {row.draft.author === 'agent'
                    ? t('who.agent')
                    : row.draft.isMine
                      ? t('who.you')
                      : t('who.team')}
                </span>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell className="pr-6 text-right">
              {row.draft ? (
                <Link
                  href={contentEditorPath(row.draft.id)}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                >
                  {t('openDraft')}
                </Link>
              ) : (
                <Button
                  size="sm"
                  variant={row.action === 'protect' ? 'outline' : 'default'}
                  onClick={() => onStart(row)}
                >
                  {t(`start.${row.action}`)}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function WhyText({ why }: { why: PlanWhy }) {
  const t = useTranslations('contentEditor.plan.why');
  const format = useFormatter();
  switch (why.kind) {
    case 'competitors':
      return (
        <span>
          {why.visibility === null
            ? t('competitors', { names: format.list(why.names) })
            : t('competitorsVisibility', {
                names: format.list(why.names),
                visibility: formatNumber(why.visibility),
              })}
        </span>
      );
    case 'opportunity':
      return <span>{t('opportunity', { count: why.prompts })}</span>;
    case 'citationsDown':
      return (
        <span>
          <span className="font-medium text-red-600 dark:text-red-400">
            {t('citationsDown', { pct: why.pct })}
          </span>
          {why.platforms.length > 0 &&
            ` ${t('on', { platforms: format.list(platformNames(why.platforms)) })}`}
        </span>
      );
    case 'top':
      return (
        <span>
          {t('top', {
            citations: why.citations,
            citationsText: formatNumber(why.citations),
            visits: why.aiVisits,
            visitsText: formatNumber(why.aiVisits),
          })}
        </span>
      );
  }
}
