'use client';

import { useCallback, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFirstRun } from '@/hooks/use-first-run';
import { getTodayStart, type TodayStart } from '@/lib/actions/today-start';
import { getTodayFirstDay } from '@/lib/actions/today-first-day';
import { getTodayEnded, getTodayLastWeek } from '@/lib/actions/today-week';
import { isMondayIn } from '@/lib/action-center/last-week';
import { useUpgradeDialog } from '@/components/providers/upgrade-gate';
import { finishOne } from '@/lib/action-center/waiting';
import { topicCardTime } from '@/lib/action-center/topic-card';
import type { FocusCard } from '@/lib/actions/today-focus';
import { viewerTimeZone } from '@/lib/time-zone';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { useChatPageContext } from '@/components/chat/panel/chat-panel-context';
import { actionCode } from '@/lib/action-center/action-ref';
import { actionTexts } from '@/lib/action-center/display';
import type { WaitingRow } from '@/lib/action-center/waiting';
import { viewRows, type ChatPageViewRow } from '@/lib/chat/page-view';
import { signalTexts } from '@/lib/signals/display';
import type { Signal } from '@/lib/signals/map';
import { signalCode } from '@/lib/signals/signal-code';
import { ActionCenterHeader } from './action-center-header';
import { ActionCenterTabs } from './action-center-tabs';
import { FirstDayView } from './today/first-day';
import { FocusSection } from './today/focus-section';
import { SetupSection } from './today/setup-section';
import { SinceSection } from './today/since-section';
import { TopicCard } from './today/topic-card';
import { WaitingSection } from './today/waiting-section';
import {
  EndedAside,
  EndedChatNote,
  LastWeekSection,
  TrialFoundSection,
  choosePlan,
  useEndedCells,
  usePausedSince,
} from './today/week-and-ended';
import {
  LoopStrip,
  ResultsValue,
  StandSection,
  useAnswersCell,
  type LoopCell,
} from './today/today-parts';
import { useTodayRead, useTodayVisit, type TodayVisitPart } from './today/use-today';

/**
 * Which Today the brand gets: read-only after the plan or trial ended, its
 * first day before its first run is stamped, else the normal day (with
 * Last week on the person's Monday). Undecided while the overview reads.
 */
type TodayMode = 'loading' | 'ended' | 'day1' | 'normal';

/** The parts a visit waits on before it counts as seen, by mode. */
const VISIT_PARTS: Record<TodayMode, readonly TodayVisitPart[]> = {
  loading: [],
  ended: ['focus'],
  day1: ['prompts'],
  normal: ['since', 'focus', 'waiting'],
};

/**
 * Today's reads when the call itself failed: every part failed, so each
 * part stays away, as when its own read fails.
 */
function startFailed(): TodayStart {
  const failed = Promise.reject(new Error('Today could not be read'));
  failed.catch(() => {});
  return {
    overview: failed,
    state: failed,
    focus: failed,
    changes: failed,
    waiting: failed,
    setup: failed,
    standing: failed,
  };
}

/** The summary row's grid: side by side where two fit, one under the other where not. */
const SUMMARY_ROW = 'grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]';

/**
 * Action Center › Today, the Action Center's first tab (mockup Main): the date, brand and when AI answers
 * last came in, with how many changes and things wait; the loop strip; a
 * summary row with Waiting for you and Where you stand side by side; then
 * Since yesterday and Today's focus across the page, with New area to
 * track and Finish setting up under them when they show. Ask Chat is the
 * header's, on every page. A brand's
 * first day, before its first run is stamped, asks the person to check the
 * prompts tracked for them instead (mockup Bugun-ilk-gun). On the person's
 * Monday, once the brand has a full week of runs, Last week takes the loop
 * strip's place (mockup Bugun-pazartesi). After the plan or trial ended,
 * it is read-only: what the trial found, the focus waiting for a plan, and
 * Choose a plan (mockup Bugun-bitmis); the global read-only band stays, and
 * Today adds only a note in its header. On the person's Monday, or once
 * today's focus is finished, "New area to track" may offer a topic to
 * track. The reads start together on the server in one call
 * (getTodayStart), since the browser runs Server Actions one at a time,
 * and each part shows as soon as its own read is in, so a slow or failed
 * read shows or hides only its part. Until the overview says which day it
 * is, the normal day's frame shows, each part at its final shape.
 */
export function TodayPage() {
  const t = useTranslations('actionCenter.today');
  const brandId = useBrandStore((s) => s.activeBrandId);
  const brandName = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId)?.name);
  const firstRun = useFirstRun();
  const upgrade = useUpgradeDialog();
  const ended = Boolean(upgrade?.isLocked && upgrade.reason === 'ended' && !upgrade.isDemo);
  const hidden = useHiddenMenuSections();
  const start = useTodayRead(
    brandId ? `${brandId}|${[...hidden].sort().join(',')}|${ended}` : null,
    () => getTodayStart(brandId!, viewerTimeZone(), [...hidden], ended).catch(startFailed),
  );
  const parts = start.status === 'ready' ? start.data : null;
  const overview = useTodayRead(parts?.overview ?? null, () => parts!.overview);
  const ready = overview.status === 'ready' ? overview.data : null;
  const mode: TodayMode = ended
    ? 'ended'
    : overview.status === 'loading'
      ? 'loading'
      : ready?.lastRunAt === null
        ? 'day1'
        : 'normal';
  const zone = ready?.zone ?? viewerTimeZone();
  const monday = mode === 'normal' && overview.status === 'ready' && isMondayIn(new Date(), zone);

  // Steps done, for today_viewed when it has read by then.
  const [setupDone, setSetupDone] = useState<number | null>(null);
  const personState = useTodayRead(parts?.state ?? null, () => parts!.state);
  const visit = useTodayVisit(brandId, personState, VISIT_PARTS[mode], () => ({
    state: mode === 'day1' || mode === 'ended' ? mode : monday ? 'monday' : 'normal',
    ...(setupDone === null ? {} : { setup_done: setupDone }),
  }));
  // The normal day's parts, once the overview says it is one.
  const day = mode === 'normal' ? parts : null;
  const standing = useTodayRead(day?.standing ?? null, () => day!.standing);
  const [firstDayVersion, setFirstDayVersion] = useState(0);
  const reloadFirstDay = useCallback(() => setFirstDayVersion((v) => v + 1), []);
  const firstDay = useTodayRead(
    mode === 'day1' ? brandId : null,
    () => getTodayFirstDay(brandId!),
    firstDayVersion,
  );

  const lastWeek = useTodayRead(monday ? brandId : null, () =>
    getTodayLastWeek(brandId!, viewerTimeZone()),
  );
  const week = lastWeek.status === 'ready' ? lastWeek.data : null;
  const endedRead = useTodayRead(mode === 'ended' ? brandId : null, () => getTodayEnded(brandId!));
  const endedCells = useEndedCells(endedRead.status === 'ready' ? endedRead.data : null);
  const pausedSince = usePausedSince(endedRead);
  const tEnded = useTranslations('actionCenter.today.ended');
  const tFocus = useTranslations('actionCenter.today.focus');
  const onChoosePlan = () => choosePlan(upgrade?.openUpgrade ?? (() => {}));
  const answers = useAnswersCell(
    overview.status === 'loading' ? undefined : (ready?.lastRunAt ?? null),
    zone,
    firstRun,
  );
  const tLoop = useTranslations('actionCenter.today.loop');

  // The header's line: what the parts that have read say, the others left out.
  const [since, setSince] = useState<{ title: string; count: number } | null>(null);
  const onSince = useCallback((summary: { title: string; count: number } | null) => {
    setSince(summary);
  }, []);
  const [waiting, setWaiting] = useState<number | null>(null);
  // Today's focus as read: null until it has, for New area to track's "focus finished".
  // Kept with its brand, so after a brand switch the last brand's cards never show.
  const [focusRead, setFocusRead] = useState<{ brandId: string; cards: FocusCard[] } | null>(null);
  const focusCards = brandId && focusRead?.brandId === brandId ? focusRead.cards : null;
  const onFocusCards = useCallback(
    (cards: FocusCard[]) => {
      if (brandId) setFocusRead({ brandId, cards });
    },
    [brandId],
  );
  // What Chat's side panel sees of Today (the owner's plan of 2026-11-16, step 9): each part's
  // rows once that part has read, in the page's order, by the code each shows (Waiting's
  // drafts by id), each with the part it is in; never read again for it.
  const [sinceRead, setSinceRead] = useState<Signal[] | null>(null);
  const [waitingRead, setWaitingRead] = useState<WaitingRow[] | null>(null);
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tSignalTexts = useTranslations('actionCenter.signalTexts');
  const tTabs = useTranslations('actionCenter.tabs');
  const tSince = useTranslations('actionCenter.today.since');
  const tWaiting = useTranslations('actionCenter.today.waiting');
  const inPart = (part: string, title: string) => `${part}: ${title}`;
  const chatRows: ChatPageViewRow[] = [
    ...viewRows(focusCards, (card) => ({
      ref: actionCode(card.action),
      label: inPart(tFocus('title'), actionTexts(card.action, tTexts).title),
    })),
    ...(mode === 'normal'
      ? [
          ...viewRows(sinceRead, (signal) => ({
            ref: signalCode(signal) ?? signal.id,
            label: inPart(tSince('title'), signalTexts(signal, tSignalTexts).title),
          })),
          ...viewRows(waitingRead, (row) =>
            row.type === 'due' || row.type === 'reminder'
              ? {
                  ref: actionCode(row.item.action),
                  label: inPart(tWaiting('title'), actionTexts(row.item.action, tTexts).title),
                }
              : row.type === 'drafts'
                ? { ref: row.draftId, label: inPart(tWaiting('title'), row.title) }
                : { ref: null, label: null },
          ),
        ]
      : []),
  ];
  useChatPageContext(
    brandId
      ? {
          pageName: tTabs('today'),
          view: chatRows.length > 0 ? { rows: chatRows.slice(0, 100) } : {},
        }
      : null,
  );

  // Today's count of changes and things waiting reads under the date line (AC-07).
  const summary =
    mode !== 'normal'
      ? null
      : [
          since ? t('summary.changes', since) : null,
          waiting !== null ? t('summary.waiting', { count: waiting }) : null,
        ]
          .filter(Boolean)
          .join(' · ') || null;
  const count = (value: number | null | undefined, key: 'tracked' | 'open' | 'doneWeek') =>
    value === null || value === undefined ? null : tLoop(key, { count: value });

  const prompts: LoopCell = { value: count(ready?.trackedPrompts, 'tracked') };
  const day1 = mode === 'day1';
  const cells: Record<'prompts' | 'answers' | 'actions' | 'done' | 'results', LoopCell> =
    mode === 'ended'
      ? endedCells
      : day1
        ? {
            prompts,
            answers,
            actions: { value: tLoop('tomorrow') },
            done: { value: null },
            results: { value: null },
          }
        : {
            prompts,
            answers,
            actions: {
              value: count(ready?.openActions, 'open'),
              // What the one open count holds (AC-01): "2 on hold · 5 yours".
              note: ready?.openBreakdown ? tLoop('openBreakdown', ready.openBreakdown) : null,
            },
            done: { value: count(ready?.doneThisWeek, 'doneWeek') },
            results: {
              value:
                standing.status === 'ready' && standing.data ? (
                  <ResultsValue standing={standing.data} />
                ) : null,
            },
          };

  const subtitle = day1 ? (
    <WelcomeLine
      brand={brandName ?? null}
      firstName={firstDay.status === 'ready' ? firstDay.data.firstName : null}
      engines={firstDay.status === 'ready' ? firstDay.data.engines : []}
    />
  ) : (
    <TodayLine
      zone={zone}
      brand={brandName ?? null}
      lastRunAt={ready?.lastRunAt}
      paused={mode === 'ended' ? pausedSince : null}
    />
  );

  return (
    <div className="space-y-6">
      <ActionCenterHeader
        subtitle={subtitle}
        note={summary}
        aside={mode === 'ended' ? tEnded('readOnly') : null}
      />
      <ActionCenterTabs />
      {week ? (
        <LastWeekSection week={week} />
      ) : (
        <LoopStrip
          current={mode === 'ended' ? null : day1 ? 'prompts' : 'actions'}
          here={day1}
          cells={cells}
        />
      )}
      {brandId && mode === 'ended' && (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-4">
              <TrialFoundSection load={endedRead} />
              <FocusSection
                brandId={brandId}
                read={parts?.focus ?? null}
                visit={visit}
                title={tEnded('focus.title')}
                sub={tEnded('focus.body')}
                onUpgrade={onChoosePlan}
              />
            </div>
            <div className="space-y-4">
              <EndedAside load={endedRead} onChoosePlan={onChoosePlan} />
            </div>
          </div>
          <EndedChatNote />
        </>
      )}
      {brandId && day1 && (
        <FirstDayView brandId={brandId} visit={visit} load={firstDay} reload={reloadFirstDay} />
      )}
      {brandId && (mode === 'normal' || mode === 'loading') && (
        <div key={brandId} className="space-y-4">
          <div data-today-row="summary" className={SUMMARY_ROW}>
            <WaitingSection
              brandId={brandId}
              read={day?.waiting ?? null}
              visit={visit}
              focus={finishOne(focusCards ?? [])}
              onSummary={setWaiting}
              onRows={setWaitingRead}
            />
            {!week && <StandSection load={standing} />}
          </div>
          <SinceSection
            read={day?.changes ?? null}
            visit={visit}
            zone={zone}
            standing={standing}
            onSummary={onSince}
            onSignals={setSinceRead}
          />
          <FocusSection
            brandId={brandId}
            read={day?.focus ?? null}
            visit={visit}
            onCards={onFocusCards}
            title={week ? tFocus('weekTitle') : undefined}
          />
          {topicCardTime(monday, focusCards) && <TopicCard brandId={brandId} />}
          <SetupSection
            brandId={brandId}
            read={day?.setup ?? null}
            brandName={brandName ?? null}
            visit={visit}
            onDone={setSetupDone}
          />
        </div>
      )}
    </div>
  );
}

/** "Tuesday, Nov 11 · Brewline Coffee · AI answers updated 1 hour ago", on the person's clock. */
function TodayLine({
  zone,
  brand,
  lastRunAt,
  paused = null,
}: {
  zone: string;
  brand: string | null;
  /** Undefined while it reads. */
  lastRunAt: string | null | undefined;
  /** After the plan ended: "tracking paused since Nov 14", in place of when answers came in. */
  paused?: string | null;
}) {
  const t = useTranslations('actionCenter.today');
  const format = useFormatter();
  const now = new Date();
  const parts = [
    format.dateTime(now, { weekday: 'long', month: 'short', day: 'numeric', timeZone: zone }),
    brand,
    paused
      ? paused
      : lastRunAt === undefined
        ? null
        : lastRunAt === null
          ? t('noAnswersYet')
          : t('updated', { ago: format.relativeTime(new Date(lastRunAt), now) }),
  ];
  return <>{parts.filter(Boolean).join(' · ')}</>;
}

/** "Welcome, Alex · Brewline Coffee · we're asking ChatGPT and Gemini your questions right now". */
function WelcomeLine({
  brand,
  firstName,
  engines,
}: {
  brand: string | null;
  firstName: string | null;
  engines: string[];
}) {
  const t = useTranslations('actionCenter.today.firstDay');
  const parts = [
    firstName ? t('welcomeName', { name: firstName }) : t('welcome'),
    brand,
    engines.length > 0
      ? t('asking', {
          engines: new Intl.ListFormat('en-US', { type: 'conjunction' }).format(engines),
        })
      : t('askingGeneric'),
  ];
  return <>{parts.filter(Boolean).join(' · ')}</>;
}
