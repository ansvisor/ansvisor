'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { useUserRole } from '@/hooks/use-user-role';
import { useFirstRun } from '@/hooks/use-first-run';
import { getTaskReviewCount } from '@/lib/actions/action-task-reviews';
import { getTodayOverview, getTodayStanding } from '@/lib/actions/today';
import { REVIEW_TAB } from '@/lib/action-center/tabs';
import { viewerTimeZone } from '@/lib/time-zone';
import { ActionCenterHeader } from './action-center-header';
import { ActionCenterTabs } from './action-center-tabs';
import { FocusSection } from './today/focus-section';
import { SinceSection } from './today/since-section';
import {
  AskChatBox,
  LoopStrip,
  ResultsValue,
  StandSection,
  TodaySection,
  useAnswersCell,
} from './today/today-parts';
import { useTodayRead, useTodayVisit, type TodayVisitPart } from './today/use-today';

/** The parts a visit waits on before it counts as seen. */
const VISIT_PARTS: readonly TodayVisitPart[] = ['since', 'focus'];

/**
 * Action Center › Today (SIMPLE_NAV), the page everyone lands on with the
 * simplified layout on (mockup Main): the date, brand and when AI answers
 * last came in; the loop strip; then Since yesterday and Today's focus, with
 * Waiting for you, Finish setting up and Where you stand beside them; and
 * Ask Chat at the bottom. Each part reads on its own, so a slow or failed
 * read shows or hides only its part. The parts still being built say what
 * they will show, under a note that Today is in preview.
 */
export function TodayPage() {
  const t = useTranslations('actionCenter.today');
  const brandId = useBrandStore((s) => s.activeBrandId);
  const brandName = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId)?.name);
  const firstRun = useFirstRun();
  const visit = useTodayVisit(brandId, VISIT_PARTS);
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
  const summary = since ? t('summary.changes', since) : null;
  const count = (value: number | null | undefined, key: 'tracked' | 'open' | 'doneWeek') =>
    value === null || value === undefined ? null : tLoop(key, { count: value });

  return (
    <div className="space-y-6">
      <ActionCenterHeader
        subtitle={<TodayLine zone={zone} brand={brandName ?? null} lastRunAt={ready?.lastRunAt} />}
        aside={summary}
      />
      <ActionCenterTabs />
      <p
        role="note"
        className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground"
      >
        {t('preview')}
      </p>
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
          {brandId && <FocusSection brandId={brandId} visit={visit} />}
        </div>
        <div className="space-y-4">
          <Placeholder part="waiting">
            <NeedsReviewLink />
          </Placeholder>
          <Placeholder part="setup" />
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

/** A part still being built: what it will show. */
function Placeholder({
  part,
  children,
}: {
  part: 'waiting' | 'setup';
  children?: React.ReactNode;
}) {
  const t = useTranslations('actionCenter.today');
  return (
    <TodaySection part={part} title={t(`sections.${part}.title`)} dashed={part === 'setup'}>
      <p className="text-sm text-muted-foreground">{t(`sections.${part}.body`)}</p>
      {children}
    </TodaySection>
  );
}

/**
 * Needs review, for admins and managers: no tab with the simplified layout,
 * so Waiting for you links to its page, with how many tasks wait.
 */
function NeedsReviewLink() {
  const t = useTranslations('actionCenter.today');
  const { canManage } = useUserRole();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [waiting, setWaiting] = useState<{ brandId: string; count: number } | null>(null);
  useEffect(() => {
    if (!brandId || !canManage) return;
    let cancelled = false;
    getTaskReviewCount(brandId)
      .then((count) => !cancelled && setWaiting({ brandId, count }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandId, canManage]);
  if (!canManage) return null;
  const count = waiting && waiting.brandId === brandId ? waiting.count : 0;
  return (
    <Link
      href={REVIEW_TAB.href}
      data-action="today.needsReview"
      className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
    >
      {t('needsReview')}
      {count > 0 && (
        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
          {count}
        </span>
      )}
    </Link>
  );
}
