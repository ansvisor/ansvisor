'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { dayIn } from '@/lib/time-zone';
import type { TodayStanding } from '@/lib/action-center/focus';
import type { FirstRun } from '@/hooks/use-first-run';
import { useChatPanel } from '@/components/chat/panel/chat-panel-context';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { TodayLoad } from './use-today';

/**
 * Today's parts that read nothing of their own (SIMPLE_NAV): the frame each
 * part sits in, the loop strip, Where you stand and the Ask Chat box. The
 * page reads, and hands each its answer.
 */

/** A part of Today, named for screen readers by its title. */
export function TodaySection({
  part,
  title,
  link,
  aside,
  sub,
  dashed = false,
  children,
}: {
  part: string;
  title: ReactNode;
  link?: { href: string; label: string };
  aside?: ReactNode;
  sub?: ReactNode;
  dashed?: boolean;
  children?: ReactNode;
}) {
  const titleId = `today-${part}-title`;
  return (
    <section
      aria-labelledby={titleId}
      data-today-part={part}
      className={cn('space-y-3 rounded-xl border p-5', dashed ? 'border-dashed' : 'bg-card')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {aside}
          {link && (
            <Link
              href={link.href}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {link.label}
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/** A part loading: a few grey lines in its frame. */
export function TodaySkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** A score as Today shows it: one decimal. */
export function useScore() {
  const format = useFormatter();
  return {
    score: (value: number) =>
      format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    change: (value: number) =>
      format.number(value, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        signDisplay: 'exceptZero',
      }),
  };
}

/** Green up, orange down, muted for none. */
export function changeTone(change: number): string {
  if (change > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (change < 0) return 'text-orange-700 dark:text-orange-300';
  return 'text-muted-foreground';
}

export type LoopStep = 'prompts' | 'answers' | 'actions' | 'done' | 'results';

/** A loop strip cell: its step's name, and what it says now (null: nothing to say). */
export interface LoopCell {
  value: ReactNode | null;
  note?: ReactNode;
  /** A first run's progress, as a bar under the value. */
  progress?: { current: number; total: number } | null;
}

/**
 * The loop strip (Prompts → AI answers → Actions → Done → Results): where
 * the brand's daily loop stands, the step to act on outlined.
 */
export function LoopStrip({
  cells,
  current,
  here = false,
}: {
  cells: Record<LoopStep, LoopCell>;
  current: LoopStep | null;
  /** Name the current step as "you are here" (a brand's first day). */
  here?: boolean;
}) {
  const t = useTranslations('actionCenter.today.loop');
  const steps: LoopStep[] = ['prompts', 'answers', 'actions', 'done', 'results'];
  return (
    <ol aria-label={t('label')} className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {steps.map((step, index) => {
        const cell = cells[step];
        const isCurrent = step === current;
        return (
          <li
            key={step}
            data-loop-step={step}
            aria-current={isCurrent ? 'step' : undefined}
            className={cn(
              'flex flex-col gap-1 rounded-xl bg-card px-3.5 py-3',
              isCurrent ? 'border-2 border-foreground px-[13px] py-[11px]' : 'border',
            )}
          >
            <span className={cn('text-xs', isCurrent ? 'font-semibold' : 'text-muted-foreground')}>
              {t('step', { number: index + 1, name: t(`steps.${step}`) })}
              {isCurrent && here && ` · ${t('here')}`}
            </span>
            <span className="text-sm font-semibold">{cell.value ?? t('none')}</span>
            {cell.progress && cell.progress.total > 0 && (
              <span className="block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span
                  className="block h-1 bg-foreground"
                  style={{
                    width: `${Math.min(100, Math.round((cell.progress.current / cell.progress.total) * 100))}%`,
                  }}
                />
              </span>
            )}
            {cell.note && <span className="text-xs text-muted-foreground">{cell.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** What the AI answers cell says: a first run's progress, else when the last run came in. */
export function useAnswersCell(
  lastRunAt: string | null | undefined,
  zone: string,
  firstRun: FirstRun | null,
): LoopCell {
  const t = useTranslations('actionCenter.today.loop');
  const format = useFormatter();
  if (firstRun?.progress) {
    return {
      value: t('answersIn', firstRun.progress),
      progress: firstRun.progress,
    };
  }
  if (firstRun) return { value: t('starting') };
  if (lastRunAt === undefined) return { value: null };
  if (lastRunAt === null) return { value: t('notYet') };
  const now = new Date();
  return {
    value:
      dayIn(lastRunAt, zone) === dayIn(now.getTime(), zone)
        ? t('updatedToday')
        : t('updatedAgo', { ago: format.relativeTime(new Date(lastRunAt), now) }),
  };
}

/** The Results cell: the score and its change since the run before. */
export function ResultsValue({ standing }: { standing: TodayStanding }) {
  const t = useTranslations('actionCenter.today.loop');
  const { score, change } = useScore();
  return (
    <>
      {score(standing.score)}{' '}
      {standing.change !== null && (
        <span className={cn('text-[13px] font-semibold', changeTone(standing.change))}>
          {standing.change === 0 ? t('noChange') : change(standing.change)}
        </span>
      )}
    </>
  );
}

/**
 * Where you stand: the score, its change since yesterday, the brand's rank
 * among the brands its answers name, and the gap to the next one. Away
 * while it reads nothing: before the first run, or when the read failed.
 */
export function StandSection({ load }: { load: TodayLoad<TodayStanding | null> }) {
  const t = useTranslations('actionCenter.today.stand');
  const { score, change } = useScore();
  const format = useFormatter();
  if (load.status === 'failed' || (load.status === 'ready' && !load.data)) return null;
  return (
    <TodaySection part="stand" title={t('title')}>
      {load.status === 'loading' ? (
        <TodaySkeleton lines={2} />
      ) : (
        load.data && (
          <div className="space-y-2">
            <p className="text-3xl font-bold tracking-tight">
              {score(load.data.score)}{' '}
              {load.data.change !== null && (
                <span className={cn('text-sm font-semibold', changeTone(load.data.change))}>
                  {load.data.change === 0
                    ? t('noChange')
                    : t('change', { change: change(load.data.change) })}
                </span>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {load.data.neighbour === null
                ? t('alone')
                : t(load.data.neighbour.ahead ? 'ahead' : 'behind', {
                    rank: load.data.rank,
                    count: load.data.of,
                    gap: format.number(load.data.neighbour.gap, { maximumFractionDigits: 1 }),
                    name: load.data.neighbour.name,
                  })}
            </p>
          </div>
        )
      )}
    </TodaySection>
  );
}

/**
 * Ask Chat at the bottom of Today: with the new Chat on and its side panel
 * on this page, the question goes into the panel's box and the panel opens;
 * the person sends it there. Otherwise nothing.
 */
export function AskChatBox({ placeholder }: { placeholder?: string }) {
  const t = useTranslations('actionCenter.today.ask');
  const panel = useChatPanel();
  const chatOn = useChatAgentic();
  const [text, setText] = useState('');
  if (!chatOn || !panel?.available) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim();
    if (!question) return;
    panel.fill(question);
    if (!panel.open) panel.toggle();
    setText('');
  };
  return (
    <form
      aria-label={t('label')}
      onSubmit={submit}
      className="flex gap-2 rounded-xl border bg-card p-3.5"
    >
      <label htmlFor="today-ask" className="sr-only">
        {t('label')}
      </label>
      <input
        id="today-ask"
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder ?? t('placeholder')}
        className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" className="h-11 px-5">
        {t('button')}
      </Button>
    </form>
  );
}
