'use client';

import { useCallback, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFirstRun } from '@/hooks/use-first-run';
import { getTodayOverview, getTodayStanding } from '@/lib/actions/today';
import { finishOne } from '@/lib/action-center/waiting';
import type { FocusCard } from '@/lib/actions/today-focus';
import { viewerTimeZone } from '@/lib/time-zone';
import { ActionCenterHeader } from './action-center-header';
import { ActionCenterTabs } from './action-center-tabs';
import { FocusSection } from './today/focus-section';
import { SetupSection } from './today/setup-section';
import { SinceSection } from './today/since-section';
import { WaitingSection } from './today/waiting-section';
import {
  AskChatBox,
  LoopStrip,
  ResultsValue,
  StandSection,
  useAnswersCell,
} from './today/today-parts';
import { useTodayRead, useTodayVisit, type TodayVisitPart } from './today/use-today';

/** The parts a visit waits on before it counts as seen. */
const VISIT_PARTS: readonly TodayVisitPart[] = ['since', 'focus', 'waiting'];

/**
 * Action Center › Today (SIMPLE_NAV), the page everyone lands on with the
 * simplified layout on (mockup Main): the date, brand and when AI answers
 * last came in, with how many changes and things wait; the loop strip; then
 * Since yesterday and Today's focus, with Waiting for you, Finish setting
 * up and Where you stand beside them; and Ask Chat at the bottom. Each part
 * reads on its own, so a slow or failed read shows or hides only its part.
 */
export function TodayPage() {
  const t = useTranslations('actionCenter.today');
  const brandId = useBrandStore((s) => s.activeBrandId);
  const brandName = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId)?.name);
  const firstRun = useFirstRun();
  // Steps done, for today_viewed when it has read by then.
  const [setupDone, setSetupDone] = useState<number | null>(null);
  const visit = useTodayVisit(brandId, VISIT_PARTS, () =>
    setupDone === null ? {} : { setup_done: setupDone },
  );
  const overview = useTodayRead(brandId, () => getTodayOverview(brandId!, viewerTimeZone()));
  const standing = useTodayRead(brandId, () => getTodayStanding(brandId!));

  const ready = overview.status === 'ready' ? overview.data : null;
  const zone = ready?.zone ?? viewerTimeZone();
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
  const [focusCards, setFocusCards] = useState<FocusCard[]>([]);
  const summary =
    [
      since ? t('summary.changes', since) : null,
      waiting !== null ? t('summary.waiting', { count: waiting }) : null,
    ]
      .filter(Boolean)
      .join(' · ') || null;
  const count = (value: number | null | undefined, key: 'tracked' | 'open' | 'doneWeek') =>
    value === null || value === undefined ? null : tLoop(key, { count: value });

  return (
    <div className="space-y-6">
      <ActionCenterHeader
        subtitle={<TodayLine zone={zone} brand={brandName ?? null} lastRunAt={ready?.lastRunAt} />}
        aside={summary}
      />
      <ActionCenterTabs />
      <LoopStrip
        current="actions"
        cells={{
          prompts: { value: count(ready?.trackedPrompts, 'tracked') },
          answers,
          actions: { value: count(ready?.openActions, 'open') },
          done: { value: count(ready?.doneThisWeek, 'doneWeek') },
          results: {
            value:
              standing.status === 'ready' && standing.data ? (
                <ResultsValue standing={standing.data} />
              ) : null,
          },
        }}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {brandId && (
            <SinceSection
              brandId={brandId}
              visit={visit}
              zone={zone}
              standing={standing}
              onSummary={onSince}
            />
          )}
          {brandId && <FocusSection brandId={brandId} visit={visit} onCards={setFocusCards} />}
        </div>
        <div className="space-y-4">
          {brandId && (
            <WaitingSection
              brandId={brandId}
              visit={visit}
              focus={finishOne(focusCards)}
              onSummary={setWaiting}
            />
          )}
          {brandId && (
            <SetupSection
              brandId={brandId}
              brandName={brandName ?? null}
              visit={visit}
              onDone={setSetupDone}
            />
          )}
          <StandSection load={standing} />
        </div>
      </div>
      <AskChatBox />
    </div>
  );
}

/** "Tuesday, Nov 11 · Brewline Coffee · AI answers updated 1 hour ago", on the person's clock. */
function TodayLine({
  zone,
  brand,
  lastRunAt,
}: {
  zone: string;
  brand: string | null;
  /** Undefined while it reads. */
  lastRunAt: string | null | undefined;
}) {
  const t = useTranslations('actionCenter.today');
  const format = useFormatter();
  const now = new Date();
  const parts = [
    format.dateTime(now, { weekday: 'long', month: 'short', day: 'numeric', timeZone: zone }),
    brand,
    lastRunAt === undefined
      ? null
      : lastRunAt === null
        ? t('noAnswersYet')
        : t('updated', { ago: format.relativeTime(new Date(lastRunAt), now) }),
  ];
  return <>{parts.filter(Boolean).join(' · ')}</>;
}
