'use client';

import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ActionItem } from '@/lib/actions/action-center';
import { actionTexts, taskText } from '@/lib/action-center/display';
import { priorityReasonText } from '@/lib/action-center/priority';
import { nextSteps, todayRows, type TodayItem, type TodayRead } from '@/lib/action-center/today';
import type { GettingStartedStep } from '@/lib/getting-started/steps';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Today (AC-011, ROADMAP mockup screen 3): up to three things to do today
 * at the top of Action Center › Actions, then the Next 7 and what was done
 * this week. While Getting started runs and has steps ready, the card lists
 * its next three instead, and nothing under it.
 *
 * The order is the server's, as the Inbox's daily suggestion ranks; who
 * does each item is read from its assignee and first step, never chosen
 * here. Each item opens its action, where the work starts.
 */
export function TodayCard({
  read,
  loading,
  actions,
  steps,
  onOpenAction,
  onOpenStep,
  gear = null,
}: {
  /** Null while it loads, or when it couldn't be read: the card then stays away. */
  read: TodayRead | null;
  loading: boolean;
  /** The page's list, whose copy of an item's action is the latest when it holds one. */
  actions: ActionItem[];
  /** Getting started's steps while it runs; null otherwise. */
  steps: GettingStartedStep[] | null;
  onOpenAction: (id: string) => void;
  onOpenStep: (step: GettingStartedStep) => void;
  /** The Agent work gear (mockup screen 3), at the header's right. */
  gear?: React.ReactNode;
}) {
  const t = useTranslations('actionCenter.actionsPage.today');
  const tStarted = useTranslations('actionCenter.gettingStarted');

  const ready = steps ? nextSteps(steps) : [];
  if (ready.length > 0) {
    return (
      <section aria-label={t('title')} className="rounded-xl border border-foreground/70 px-4 py-1">
        <TodayHeader
          title={t('title')}
          sub={t('stepsSubtitle', { count: ready.length })}
          action={gear}
        />
        <ol>
          {ready.map((step, index) => (
            <TodayRow
              key={step.key}
              number={index + 1}
              title={tStarted(`steps.${step.key}.title`)}
              onOpen={() => onOpenStep(step)}
              openLabel={t('open')}
              lines={[tStarted(`steps.${step.key}.summary`)]}
            />
          ))}
        </ol>
      </section>
    );
  }

  if (!read) {
    if (!loading) return null;
    return (
      <section aria-label={t('title')} className="space-y-2 rounded-xl border px-4 py-3">
        <Skeleton className="h-5 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </section>
    );
  }

  return <TodayActions read={read} actions={actions} onOpenAction={onOpenAction} gear={gear} />;
}

function TodayActions({
  read,
  actions,
  onOpenAction,
  gear,
}: {
  read: TodayRead;
  actions: ActionItem[];
  onOpenAction: (id: string) => void;
  gear: React.ReactNode;
}) {
  const t = useTranslations('actionCenter.actionsPage.today');
  const tPage = useTranslations('actionCenter.actionsPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tTasks = useTranslations('actionCenter.actionTasks');
  const tPriority = useTranslations('actionCenter.actionsPage.priority');
  const tCategories = useTranslations('actionCenter.actionCategories');

  const today = todayRows(read.today, actions);
  const next = todayRows(read.next, actions);

  const stepLine = (item: TodayItem) => {
    if (!item.firstStep) return t('noStep');
    const step = taskText(item.firstStep, tTasks);
    if (!step) return t('noStep');
    return item.firstStep.url
      ? t('firstStepOn', { step, page: item.firstStep.url })
      : t('firstStep', { step });
  };

  return (
    <div className="space-y-3">
      <section aria-label={t('title')} className="rounded-xl border border-foreground/70 px-4 py-1">
        <TodayHeader
          title={t('title')}
          sub={today.length > 0 ? t('subtitle', { count: today.length }) : null}
          hint={t('rankHint')}
          action={gear}
        />
        {today.length === 0 ? (
          <p className="border-t py-3 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ol>
            {today.map(({ item, action }, index) => {
              const texts = actionTexts(action, tTexts);
              const why = action.priorityReason
                ? priorityReasonText(action.priorityReason, tPriority)
                : texts.description;
              return (
                <TodayRow
                  key={item.id}
                  number={index + 1}
                  title={texts.title}
                  onOpen={() => onOpenAction(item.id)}
                  openLabel={t('open')}
                  lines={[why, stepLine(item)]}
                  note={item.suggested ? t('suggested') : null}
                  who={{ label: t(`who.${item.who}`), hint: t(`whoHint.${item.who}`) }}
                />
              );
            })}
          </ol>
        )}
      </section>

      {(next.length > 0 || read.doneThisWeek > 0) && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('next', { count: next.length })}
            </p>
            <Link
              href="/dashboard/action-center/history"
              title={t('doneThisWeekHint')}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {t('doneThisWeek', { count: read.doneThisWeek })}
            </Link>
          </div>
          {next.length > 0 && (
            <div className="overflow-hidden rounded-xl border text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_7rem_4.5rem] gap-3 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>{t('columns.action')}</span>
                <span>{t('columns.category')}</span>
                <span className="text-right">{t('columns.priority')}</span>
              </div>
              {next.map(({ item, action }) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenAction(item.id)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_7rem_4.5rem] gap-3 border-t px-4 py-2 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="truncate">{actionTexts(action, tTexts).title}</span>
                  <span className="truncate text-muted-foreground">
                    {tCategories(action.category)}
                  </span>
                  <span
                    className="text-right tabular-nums"
                    title={
                      action.priorityLevel ? tPage(`priority.levels.${action.priorityLevel}`) : ''
                    }
                  >
                    {action.priorityScore ?? '—'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TodayHeader({
  title,
  sub,
  hint,
  action = null,
}: {
  title: string;
  sub: string | null;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      {hint && (
        <span title={hint} aria-label={hint} className="self-center text-muted-foreground">
          <Info className="h-3.5 w-3.5" />
        </span>
      )}
      {action}
    </div>
  );
}

function TodayRow({
  number,
  title,
  lines,
  note = null,
  who,
  onOpen,
  openLabel,
}: {
  number: number;
  title: string;
  lines: string[];
  note?: string | null;
  who?: { label: string; hint: string };
  onOpen: () => void;
  openLabel: string;
}) {
  return (
    <li className="flex flex-col gap-2 border-t py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
          {number}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <button
            type="button"
            onClick={onOpen}
            className="text-left text-sm font-medium hover:underline"
          >
            {title}
          </button>
          {lines
            .filter((line) => line)
            .map((line, i) => (
              <p key={i} className="break-words text-xs text-muted-foreground">
                {line}
              </p>
            ))}
          {note && <p className="text-[11px] text-muted-foreground/80">{note}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-9 sm:pl-0">
        {who && (
          <span title={who.hint} className="rounded-md border px-2 py-0.5 text-xs font-medium">
            {who.label}
          </span>
        )}
        <Button size="sm" onClick={onOpen}>
          {openLabel}
        </Button>
      </div>
    </li>
  );
}
