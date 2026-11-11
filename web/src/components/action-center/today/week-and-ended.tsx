'use client';

import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { actionTexts } from '@/lib/action-center/display';
import type { NamedAction, TodayEnded, TodayLastWeek } from '@/lib/actions/today-week';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { Button } from '@/components/ui/button';
import { changeTone, TodaySection, TodaySkeleton, useScore, type LoopCell } from './today-parts';
import type { TodayLoad } from './use-today';

const REPORTS_HREF = '/dashboard/reports';

/** "espresso page, subscription FAQ": the actions' titles, as the Actions list names them. */
function useTitles() {
  const tTexts = useTranslations('actionCenter.actionTexts');
  return (actions: NamedAction[]) =>
    actions.map((action) => actionTexts(action, tTexts).title).join(', ');
}

/**
 * Monday's "Last week" on Action Center › Today (SIMPLE_NAV, mockup
 * Bugun-pazartesi), where the loop strip is on other days: visibility over
 * last week against the week before and the rank, the actions done, and the
 * results that came in, with the weekly report a click away.
 */
export function LastWeekSection({ week }: { week: TodayLastWeek }) {
  const t = useTranslations('actionCenter.today.lastWeek');
  const { score, change } = useScore();
  const titles = useTitles();
  const vis = week.visibility;
  return (
    <TodaySection part="week" title={t('title')} link={{ href: REPORTS_HREF, label: t('report') }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label={t('visibility')}
          value={
            vis ? (
              <>
                {score(vis.score)}{' '}
                {vis.change !== null && vis.change !== 0 && (
                  <span className={cn('text-sm font-semibold', changeTone(vis.change))}>
                    {change(vis.change)}
                  </span>
                )}
              </>
            ) : null
          }
          note={
            vis
              ? [
                  vis.change !== null ? t('from', { score: score(vis.score - vis.change) }) : null,
                  t('rank', { rank: vis.rank, count: vis.of }),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : null
          }
        />
        <Tile
          label={t('done')}
          value={week.done ? week.done.count : null}
          note={week.done && week.done.count > 0 ? titles(week.done.actions) : t('noneDone')}
        />
        <Tile
          label={t('results')}
          value={week.results ? t('improved', { count: week.results.count }) : null}
          note={
            week.results && week.results.count > 0 ? titles(week.results.actions) : t('noResults')
          }
        />
      </div>
    </TodaySection>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode | null;
  note: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-3.5 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-bold tracking-tight">{value ?? '—'}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/** The loop strip after the plan ended: what is kept, paused, waiting and done. */
export function useEndedCells(
  ended: TodayEnded | null,
): Record<'prompts' | 'answers' | 'actions' | 'done' | 'results', LoopCell> {
  const t = useTranslations('actionCenter.today.ended.loop');
  const format = useFormatter();
  const { score, change } = useScore();
  const at = ended?.lastRunAt ? new Date(ended.lastRunAt) : null;
  return {
    prompts: {
      value: typeof ended?.prompts === 'number' ? t('saved', { count: ended.prompts }) : null,
    },
    answers: {
      value: t('paused'),
      note: at
        ? t('lastOn', { date: format.dateTime(at, { month: 'short', day: 'numeric' }) })
        : null,
    },
    actions: {
      value: typeof ended?.open === 'number' ? t('waiting', { count: ended.open }) : null,
    },
    done: { value: typeof ended?.done === 'number' ? t('inTrial', { count: ended.done }) : null },
    results: ended?.trial
      ? {
          value: (
            <>
              {score(ended.trial.score)}{' '}
              {ended.trial.change !== null && ended.trial.change !== 0 && (
                <span className={cn('text-[13px] font-semibold', changeTone(ended.trial.change))}>
                  {change(ended.trial.change)}
                </span>
              )}
            </>
          ),
          note: ended.trial.change !== null ? t('overTrial') : null,
        }
      : { value: null },
  };
}

/** The header's "tracking paused since Nov 14". */
export function usePausedSince(ended: TodayLoad<TodayEnded>): string | null {
  const t = useTranslations('actionCenter.today.ended');
  const format = useFormatter();
  if (ended.status !== 'ready' || !ended.data.lastRunAt) return null;
  return t('pausedSince', {
    date: format.dateTime(new Date(ended.data.lastRunAt), { month: 'short', day: 'numeric' }),
  });
}

/**
 * "What your trial found" after the plan ended (mockup Bugun-bitmis): how
 * visibility moved over the trial and the rank, the results that came in,
 * and the gap to the leader with the actions ready to close it.
 */
export function TrialFoundSection({ load }: { load: TodayLoad<TodayEnded> }) {
  const t = useTranslations('actionCenter.today.ended.found');
  const { score } = useScore();
  const format = useFormatter();
  const titles = useTitles();
  if (load.status === 'failed') return null;
  const data = load.status === 'ready' ? load.data : null;
  const trial = data?.trial ?? null;
  const rows: { tag: 'up' | 'down' | 'done' | 'gap'; text: string }[] = [];
  if (trial) {
    const rank = t('rank', { rank: trial.rank, count: trial.of });
    if (trial.change === null || trial.change === 0) {
      rows.push({ tag: 'up', text: `${t('held', { score: score(trial.score) })} ${rank}` });
    } else {
      rows.push({
        tag: trial.change > 0 ? 'up' : 'down',
        text: `${t(trial.change > 0 ? 'rose' : 'fell', {
          from: score(trial.score - trial.change),
          to: score(trial.score),
        })} ${rank}`,
      });
    }
  }
  if (data?.improved && data.improved.count > 0) {
    rows.push({
      tag: 'done',
      text: t('improved', { count: data.improved.count, titles: titles(data.improved.actions) }),
    });
  }
  if (trial?.neighbour && !trial.neighbour.ahead) {
    rows.push({
      tag: 'gap',
      text: t('gap', {
        name: trial.neighbour.name,
        gap: format.number(trial.neighbour.gap, { maximumFractionDigits: 1 }),
        count: data?.open ?? 0,
      }),
    });
  }
  return (
    <TodaySection part="found" title={t('title')}>
      {!data ? (
        <TodaySkeleton lines={3} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('nothing')}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.tag} className="flex gap-3 border-t py-3 text-sm leading-relaxed">
              <span
                className={cn(
                  'inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-xs font-semibold',
                  row.tag === 'up' || row.tag === 'done'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : row.tag === 'down'
                      ? 'bg-orange-500/15 text-orange-800 dark:text-orange-300'
                      : 'border text-muted-foreground',
                )}
              >
                {t(`tag.${row.tag}`)}
              </span>
              <span>{row.text}</span>
            </li>
          ))}
        </ul>
      )}
    </TodaySection>
  );
}

/**
 * Beside it after the plan ended: what is saved for the person (drafts in
 * review, prompts and competitors kept), and what a plan brings back, with
 * Choose a plan. The Chat note goes at the bottom of the page.
 */
export function EndedAside({
  load,
  onChoosePlan,
}: {
  load: TodayLoad<TodayEnded>;
  onChoosePlan: () => void;
}) {
  const t = useTranslations('actionCenter.today.ended');
  const data = load.status === 'ready' ? load.data : null;
  return (
    <>
      {data && (
        <TodaySection part="saved" title={t('saved.title')}>
          <div className="space-y-1.5 text-sm">
            {data.drafts && data.drafts.count > 0 && (
              <p>
                {data.drafts.title
                  ? t('saved.drafts', { count: data.drafts.count, title: data.drafts.title })
                  : t('saved.draftsUntitled', { count: data.drafts.count })}
              </p>
            )}
            <p className="text-muted-foreground">
              {t('saved.kept', {
                prompts: data.prompts ?? 0,
                competitors: data.competitors ?? 0,
              })}
            </p>
          </div>
        </TodaySection>
      )}
      <TodaySection part="plan" title={t('plan.title')}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('plan.tracking')}</li>
          <li>{t('plan.waiting')}</li>
          <li>{t('plan.agents')}</li>
        </ul>
        <Button onClick={onChoosePlan} className="w-full" data-action="today.choosePlan">
          {t('plan.choose')}
        </Button>
      </TodaySection>
    </>
  );
}

/** At the bottom after the plan ended, with the new Chat on: what Chat can still do. */
export function EndedChatNote() {
  const t = useTranslations('actionCenter.today.ended');
  const chatOn = useChatAgentic();
  if (!chatOn) return null;
  return (
    <p className="rounded-xl border bg-card p-3.5 text-sm text-muted-foreground">{t('chatNote')}</p>
  );
}

/** Choose a plan from Today: the upgrade dialog, counted. */
export function choosePlan(openUpgrade: () => void) {
  track('today_choose_plan_clicked');
  openUpgrade();
}
