'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { actionGoal, actionTexts } from '@/lib/action-center/display';
import type { ActionHistoryItem } from '@/lib/action-center/history';
import { UNCOUNTED_TASK_STATUSES } from '@/lib/action-center/registry';
import { ImpactDots } from './signal-table';
import { ActionIcon } from './action-table';
import { HistoryStatusBadge } from './history-table';
import { cn } from '@/lib/utils';

/**
 * One metric an action moved, as before → after.
 *
 * Both halves are shown rather than only the delta: a jump of seven means
 * something different at a base of ten than at a base of a thousand, and the
 * reader deciding whether the work paid off needs the base.
 */
function ResultMetricCard({
  label,
  before,
  after,
  delta,
  unit,
}: {
  label: string;
  before: number;
  after: number;
  delta: number;
  unit: string;
}) {
  const suffix = unit === 'percent' ? '%' : '';
  const rose = delta > 0;
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          rose ? 'text-emerald-600 dark:text-emerald-400' : delta < 0 ? 'text-red-500' : '',
        )}
      >
        {rose ? '↑' : delta < 0 ? '↓' : ''}
        {Math.abs(delta)}
        {suffix}
      </p>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {before}
        {suffix} → {after}
        {suffix}
      </p>
    </div>
  );
}

/**
 * What an action was, what opened it, what was carried out, and what it
 * achieved — in that order, because the last one is the question the tab is
 * for and the rest is the evidence behind it.
 */
export function HistoryDrawer({
  item,
  onOpenChange,
}: {
  item: ActionHistoryItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('actionCenter.historyPage');
  const tActions = useTranslations('actionCenter.actionsPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tTypes = useTranslations('actionCenter.actionCategories');
  const tTasks = useTranslations('actionCenter.actionTasks');
  const tTaskStatus = useTranslations('actionCenter.taskStatus');
  const tSources = useTranslations('actionCenter.signalsPage.sources');
  const tRegistry = useTranslations('actionCenter.registry');
  const tAffected = useTranslations('actionCenter.historyPage.affected');
  const router = useRouter();

  if (!item) return null;

  const texts = actionTexts(
    { kind: item.kind, payload: item.payload } as Parameters<typeof actionTexts>[0],
    tTexts,
  );
  const date = item.completedAt ?? item.createdAt;
  const measured = item.results.length > 0;
  const completedTasks = item.tasks.filter((task) => task.status === 'completed').length;
  const countedTasks = item.tasks.filter(
    (task) => !UNCOUNTED_TASK_STATUSES.includes(task.status),
  ).length;

  return (
    <Sheet open={Boolean(item)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="text-[10px]">
              {tTypes(item.type)}
            </Badge>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ImpactDots impact={item.impact} />
              {tActions(`impact.${item.impact}`)}
            </span>
            <HistoryStatusBadge status={item.status} />
            <span className="ml-auto text-muted-foreground">AC-{item.actionNo}</span>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <ActionIcon
                kind={item.kind}
                category={item.type}
                className="h-4 w-4 text-muted-foreground"
              />
            </div>
            <div className="min-w-0">
              <SheetTitle>{texts.title}</SheetTitle>
              <SheetDescription>
                {new Date(date).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {item.sources.length > 0 && (
                  <> · {item.sources.map((source) => tSources(source)).join(' · ')}</>
                )}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm">
          <section>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.goal')}</p>
            <p className="mt-1">{actionGoal(item.kind, tTexts)}</p>
          </section>

          <Separator />

          <section>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.whatHappened')}</p>
            <p className="mt-1">{texts.description}</p>
            {item.triggerSignals.length > 0 && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('drawer.triggeredBy', { count: item.triggerSignals.length })}
              </p>
            )}
          </section>

          <Separator />

          <section>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.result')}</p>
            {!measured && (
              // The honest state, and the reason for it. Everything above this
              // line is recorded; the effect is not, because nothing re-reads
              // these metrics after an action closes.
              <p className="mt-1 text-xs text-muted-foreground">
                {t(`outcomeExplain.${item.outcome}`)}
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {item.results.map((metric) => (
                <ResultMetricCard
                  key={metric.id}
                  label={tRegistry(`${metric.metric}.name`)}
                  before={metric.before ?? 0}
                  after={metric.after ?? 0}
                  delta={metric.delta ?? 0}
                  unit={metric.unit}
                />
              ))}
              <div className="rounded-md border p-3">
                <p className="text-[11px] text-muted-foreground">{t('drawer.timeToClose')}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {item.timeToCloseDays != null
                    ? t('drawer.days', { n: item.timeToCloseDays })
                    : '—'}
                </p>
                <p className="text-[11px] text-muted-foreground">{t('drawer.fromStart')}</p>
              </div>
            </div>
          </section>

          <Separator />

          <section>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.affected')}</p>
            {item.affected.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.affected.map((entity) => (
                  <Badge key={entity.id} variant="outline" className="text-[10px]">
                    {entity.count != null
                      ? tAffected(entity.type, { count: entity.count })
                      : entity.name}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t('drawer.noAffected')}</p>
            )}
          </section>

          <Separator />

          <section>
            <p className="text-xs font-medium text-muted-foreground">
              {t('drawer.tasks', { completed: completedTasks, total: countedTasks })}
            </p>
            {item.tasks.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {item.tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        task.status === 'completed' ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                      )}
                    />
                    <span
                      className={cn(
                        'min-w-0 flex-1',
                        (task.status === 'completed' ||
                          UNCOUNTED_TASK_STATUSES.includes(task.status)) &&
                          'text-muted-foreground line-through',
                      )}
                    >
                      {/* A user-written title arrives verbatim; a generated task
                          arrives as its template key and is resolved here. */}
                      {tTasks.has(task.title) ? tTasks(task.title) : task.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {tTaskStatus(task.status)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t('drawer.noTasks')}</p>
            )}
          </section>
        </div>

        <div className="border-t px-6 py-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => router.push(`/dashboard/action-center/actions?action=${item.id}`)}
          >
            {t('drawer.viewAction')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
