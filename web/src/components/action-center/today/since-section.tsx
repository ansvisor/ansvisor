'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { dayIn, nextDay } from '@/lib/time-zone';
import { signalTexts } from '@/lib/signals/display';
import type { Signal } from '@/lib/signals/map';
import type { TodayStanding } from '@/lib/action-center/focus';
import { ChevronDown } from 'lucide-react';
import {
  GROUP_TITLE_KINDS,
  asSentence,
  changeDirection,
  groupChanges,
  largestRivalMove,
  type ChangeDirection,
  type ChangeGroup,
} from '@/lib/action-center/since';
import type { TodayChanges } from '@/lib/actions/today-changes';
import { Skeleton } from '@/components/ui/skeleton';
import { actionHref } from './focus-section';
import { TodaySection, useScore } from './today-parts';
import { useTodayPart, type TodayLoad, type TodayVisit } from './use-today';

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
 * whose section is off the person's menu aren't listed. Read with Today's
 * other parts from the person's last visit (getTodayStart), and stays away
 * when the read fails.
 */
export function SinceSection({
  read,
  visit,
  zone,
  standing,
  onSummary,
  onSignals,
}: {
  /** The changes' read, started with Today's others; null until the day is known. */
  read: Promise<TodayChanges | null> | null;
  visit: TodayVisit;
  zone: string;
  standing: TodayLoad<TodayStanding | null>;
  /** What the header's line says: the window's title and how many changes. */
  onSummary: (summary: { title: string; count: number } | null) => void;
  /** The changes listed, once read (null till then): Chat's side panel sees them. */
  onSignals?: (signals: Signal[] | null) => void;
}) {
  const t = useTranslations('actionCenter.today.since');
  const tToday = useTranslations('actionCenter.today');
  const titleOf = useSinceTitle();
  const load = useTodayPart(read);

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
  const items = load.status === 'ready' ? load.data.items : null;
  useEffect(() => {
    onSignals?.(items);
  }, [items, onSignals]);

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
        <SinceSkeleton />
      ) : quiet ? (
        <QuietDay
          standing={standing}
          small={load.data.small}
          onSignals={() => clicked(null, 'signals')}
        />
      ) : (
        <ul>
          {groupChanges(load.data.items).map((group) => (
            <ChangeRow key={group.kind} group={group} onAction={clicked} />
          ))}
        </ul>
      )}
    </TodaySection>
  );
}

/** A link over its whole row (AC-06): the row is the link's box, the text stays as it reads. */
const ROW_LINK = 'underline underline-offset-2 after:absolute after:inset-0';

/**
 * One row of Since yesterday. A lone change reads as before, its "An action
 * was added" opening its action from anywhere on the row. Several changes of
 * one kind read as one line ("5 rivals are mentioned far more than you · 1
 * action"), with the action one link opens or, past one, each change's own
 * under Show all.
 */
function ChangeRow({
  group,
  onAction,
}: {
  group: ChangeGroup;
  onAction: (signal: Signal, target: 'action') => void;
}) {
  const t = useTranslations('actionCenter.today.since');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const [open, setOpen] = useState(false);
  const [lead] = group.signals;
  const direction = changeDirection(lead);
  const pill = (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-xs font-semibold',
        PILL[direction],
      )}
    >
      {t(`direction.${direction}`)}
    </span>
  );
  const actionLink = (signal: Signal, className: string) =>
    t.rich('actionAdded', {
      link: (chunks) => (
        <Link
          href={actionHref(signal.actionId!)}
          onClick={() => onAction(signal, 'action')}
          className={className}
        >
          {chunks}
        </Link>
      ),
    });

  if (group.signals.length === 1) {
    const line = signalTexts(lead, tTexts).title;
    return (
      <li
        data-signal-id={lead.id}
        className={cn(
          'relative flex gap-3 border-t py-3 text-sm leading-relaxed',
          lead.actionId && 'rounded-sm hover:bg-muted/40',
        )}
      >
        {pill}
        <span>
          {lead.actionId ? asSentence(line) : line}
          {lead.actionId && <> {actionLink(lead, ROW_LINK)}</>}
        </span>
      </li>
    );
  }

  const count = group.signals.length;
  const title = GROUP_TITLE_KINDS.includes(group.kind)
    ? t(`group.${group.kind}`, { count })
    : t('group.other', { title: signalTexts(lead, tTexts).title, more: count - 1 });
  const single = group.actionIds.length === 1 ? group.signals.find((s) => s.actionId) : undefined;
  const listId = `since-group-${group.kind}`;
  return (
    <li data-signal-group={group.kind} className="border-t py-3 text-sm leading-relaxed">
      <div className={cn('relative flex gap-3', single && 'rounded-sm hover:bg-muted/40')}>
        {pill}
        <span className="min-w-0 flex-1">
          {title}
          {group.actionIds.length > 0 && (
            <>
              {' · '}
              {single ? (
                <Link
                  href={actionHref(single.actionId!)}
                  onClick={() => onAction(single, 'action')}
                  className={ROW_LINK}
                >
                  {t('groupActions', { count: 1 })}
                </Link>
              ) : (
                t('groupActions', { count: group.actionIds.length })
              )}
            </>
          )}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="relative z-10 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {open ? t('hideGroup') : t('showGroup', { count })}
          <ChevronDown
            aria-hidden="true"
            className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>
      {open && (
        <ul id={listId} className="mt-2 space-y-1.5 border-s ps-3 text-muted-foreground">
          {group.signals.map((signal) => (
            <li key={signal.id} data-signal-id={signal.id}>
              {signal.actionId
                ? asSentence(signalTexts(signal, tTexts).title)
                : signalTexts(signal, tTexts).title}
              {signal.actionId && (
                <> {actionLink(signal, 'underline underline-offset-2 hover:text-foreground')}</>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Since yesterday reading: three rows shaped as its changes, a pill and a line each. */
export function SinceSkeleton() {
  return (
    <ul aria-hidden="true" data-skeleton="since">
      {[0, 1, 2].map((row) => (
        <li key={row} className="flex items-center gap-3 border-t py-3">
          <Skeleton className="h-[22px] w-12 shrink-0 rounded-full" />
          <Skeleton className="h-[22px] flex-1" />
        </li>
      ))}
    </ul>
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
