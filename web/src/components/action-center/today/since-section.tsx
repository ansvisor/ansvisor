'use client';

import { useEffect } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { dayIn, nextDay } from '@/lib/time-zone';
import { signalTexts } from '@/lib/signals/display';
import type { Signal } from '@/lib/signals/map';
import type { TodayStanding } from '@/lib/action-center/focus';
import {
  asSentence,
  changeDirection,
  largestRivalMove,
  type ChangeDirection,
} from '@/lib/action-center/since';
import { getTodayChanges } from '@/lib/actions/today-changes';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { actionHref } from './focus-section';
import { TodaySection, TodaySkeleton, useScore } from './today-parts';
import { useTodayRead, type TodayLoad, type TodayVisit } from './use-today';

const SIGNALS_HREF = '/dashboard/action-center/signals';

const PILL: Record<ChangeDirection, string> = {
  up: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  down: 'bg-orange-500/15 text-orange-800 dark:text-orange-300',
  rival: 'border text-muted-foreground',
};

/** "Since yesterday", or "Since Friday" when the window starts before yesterday. */
export function useSinceTitle() {
  const t = useTranslations('actionCenter.today.since');
  const format = useFormatter();
  return (since: string, zone: string) => {
    const today = dayIn(Date.now(), zone);
    const start = dayIn(since, zone);
    return nextDay(start) >= today
      ? t('title')
      : t('titleDay', {
          day: format.dateTime(new Date(since), { weekday: 'long', timeZone: zone }),
        });
  };
}

/**
 * Since yesterday on Action Center › Today: the 3–5 biggest
 * changes the nightly checks found since the person's last look (Up, Down,
 * Rival), each with a link to the action it added; on a quiet day, that
 * nothing big changed, with the score from Where you stand's read. Signals
 * whose section is off the person's menu aren't listed. Reads once the
 * visit knows the last one, and stays away when the read fails.
 */
export function SinceSection({
  brandId,
  visit,
  zone,
  standing,
  onSummary,
}: {
  brandId: string;
  visit: TodayVisit;
  zone: string;
  standing: TodayLoad<TodayStanding | null>;
  /** What the header's line says: the window's title and how many changes. */
  onSummary: (summary: { title: string; count: number } | null) => void;
}) {
  const t = useTranslations('actionCenter.today.since');
  const tToday = useTranslations('actionCenter.today');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const hidden = useHiddenMenuSections();
  const titleOf = useSinceTitle();
  const seenAt = visit.seenAt;
  const hiddenKey = [...hidden].sort().join(',');
  const load = useTodayRead(seenAt === undefined ? null : `${brandId}|${hiddenKey}`, () =>
    getTodayChanges(brandId, seenAt ?? null, [...hidden]),
  );

  const { settle } = visit;
  const settled = load.status === 'loading' ? null : load.status;
  const count = load.status === 'ready' ? load.data.total : null;
  const title = load.status === 'ready' ? titleOf(load.data.since, zone) : t('title');
  useEffect(() => {
    if (settled) settle('since', count);
  }, [settled, count, settle]);
  useEffect(() => {
    onSummary(count === null ? null : { title, count });
  }, [count, title, onSummary]);

  if (load.status === 'failed') return null;
  const clicked = (signal: Signal | null, target: 'action' | 'signals') =>
    track('today_since_clicked', {
      ...(signal ? { kind: signal.kind, direction: changeDirection(signal) } : {}),
      target,
    });
  const quiet = load.status === 'ready' && load.data.items.length === 0;

  return (
    <TodaySection
      part="since"
      title={title}
      link={
        quiet
          ? undefined
          : {
              href: SIGNALS_HREF,
              label: tToday('allSignals'),
              onClick: () => clicked(null, 'signals'),
            }
      }
    >
      {load.status === 'loading' ? (
        <TodaySkeleton />
      ) : quiet ? (
        <QuietDay
          standing={standing}
          small={load.data.small}
          onSignals={() => clicked(null, 'signals')}
        />
      ) : (
        <ul>
          {load.data.items.map((signal) => {
            const direction = changeDirection(signal);
            const line = signalTexts(signal, tTexts).title;
            return (
              <li
                key={signal.id}
                data-signal-id={signal.id}
                className="flex gap-3 border-t py-3 text-sm leading-relaxed"
              >
                <span
                  className={cn(
                    'inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-xs font-semibold',
                    PILL[direction],
                  )}
                >
                  {t(`direction.${direction}`)}
                </span>
                <span>
                  {signal.actionId ? asSentence(line) : line}
                  {signal.actionId && (
                    <>
                      {' '}
                      {t.rich('actionAdded', {
                        link: (chunks) => (
                          <Link
                            href={actionHref(signal.actionId!)}
                            onClick={() => clicked(signal, 'action')}
                            className="underline underline-offset-2"
                          >
                            {chunks}
                          </Link>
                        ),
                      })}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </TodaySection>
  );
}

/**
 * A quiet day: no big change, the score held (or moved a little), and no
 * competitor moved more than a point, from Where you stand's read; then
 * when the next update comes, and where the small moves are.
 */
function QuietDay({
  standing,
  small,
  onSignals,
}: {
  standing: TodayLoad<TodayStanding | null>;
  small: number;
  onSignals: () => void;
}) {
  const t = useTranslations('actionCenter.today.since.quiet');
  const { score, change } = useScore();
  const data = standing.status === 'ready' ? standing.data : null;
  const calm = data ? largestRivalMove(data.competitors) <= 1 : false;
  const line = !data
    ? t('none')
    : data.change === null || Math.abs(data.change) < 0.5
      ? t(calm ? 'heldCalm' : 'held', { score: score(data.score) })
      : t(calm ? 'movedCalm' : 'moved', { score: score(data.score), change: change(data.change) });
  return (
    <div className="space-y-1.5 text-sm">
      <p>{line}</p>
      <p className="text-muted-foreground">
        {t('next')}
        {small > 0 && (
          <>
            {' '}
            {t.rich('small', {
              link: (chunks) => (
                <Link
                  href={SIGNALS_HREF}
                  onClick={onSignals}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {chunks}
                </Link>
              ),
            })}
          </>
        )}
      </p>
    </div>
  );
}
