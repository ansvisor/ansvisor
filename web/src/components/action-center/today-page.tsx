'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { useUserRole } from '@/hooks/use-user-role';
import { getTaskReviewCount } from '@/lib/actions/action-task-reviews';
import { REVIEW_TAB } from '@/lib/action-center/tabs';
import { ActionCenterHeader } from './action-center-header';
import { ActionCenterTabs } from './action-center-tabs';

/** Today's parts, in the mockup's two columns: what changed and what to do, then what waits. */
const MAIN = ['since', 'focus'] as const;
const ASIDE = ['waiting', 'setup', 'stand'] as const;
type TodayPart = (typeof MAIN)[number] | (typeof ASIDE)[number];

/** Where a part's "All …" link goes: the full list behind it. */
const LINKS: Partial<Record<TodayPart, { href: string; label: 'allSignals' | 'allActions' }>> = {
  since: { href: '/dashboard/action-center/signals', label: 'allSignals' },
  focus: { href: '/dashboard/action-center/actions', label: 'allActions' },
};

/**
 * Action Center › Today (SIMPLE_NAV), the page everyone lands on with the
 * simplified layout on: the Action Center's header and tabs, then its parts,
 * which arrive one by one (Since yesterday, Today's focus, Waiting for you,
 * Finish setting up, Where you stand). Until each is built it says what it
 * will show, under a note that Today is in preview. Admins and managers
 * already find Needs review under Waiting for you: it is no tab any more.
 */
export function TodayPage() {
  const t = useTranslations('actionCenter.today');
  return (
    <div className="space-y-6">
      <ActionCenterHeader subtitle={t('subtitle')} />
      <ActionCenterTabs />
      <p
        role="note"
        className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground"
      >
        {t('preview')}
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {MAIN.map((part) => (
            <TodaySection key={part} part={part} />
          ))}
        </div>
        <div className="space-y-6">
          {ASIDE.map((part) => (
            <TodaySection key={part} part={part} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TodaySection({ part }: { part: TodayPart }) {
  const t = useTranslations('actionCenter.today');
  const link = LINKS[part];
  const titleId = `today-${part}-title`;
  return (
    <section
      aria-labelledby={titleId}
      data-today-part={part}
      className="rounded-xl border bg-card p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold">
          {t(`sections.${part}.title`)}
        </h2>
        {link && (
          <Link
            href={link.href}
            className="shrink-0 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t(link.label)}
          </Link>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t(`sections.${part}.body`)}</p>
      {part === 'waiting' && <NeedsReviewLink />}
    </section>
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
      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
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
