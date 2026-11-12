'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ACTION_CENTER_KPIS } from '@/lib/action-center/tabs';
import { cn } from '@/lib/utils';

/** History's own views, which switch in place on its page. */
export type HistoryOwnView = 'actions' | 'scorecard';

const HISTORY_HREF = '/dashboard/action-center/history';

const segment = (selected: boolean) =>
  cn(
    'px-3 py-1.5 text-xs font-medium transition-colors',
    selected ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted',
  );

/**
 * History's views: its actions and the scorecard of what each kind did,
 * switched in place on its page (`onPick`). With the simplified layout on
 * (SIMPLE_NAV, `kpis`), KPIs is the third, a link to its page, which keeps
 * its address but is no tab of its own any more; on that page (`current`
 * "kpis") the other two link back to History.
 */
export function HistoryViews({
  current,
  onPick,
  kpis = false,
}: {
  current: HistoryOwnView | 'kpis';
  onPick?: (view: HistoryOwnView) => void;
  kpis?: boolean;
}) {
  const t = useTranslations('actionCenter.historyPage');
  const own: HistoryOwnView[] = ['actions', 'scorecard'];
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border"
      {...(kpis ? { role: 'group', 'aria-label': t('view.label') } : {})}
    >
      {own.map((option) =>
        onPick ? (
          <button
            key={option}
            type="button"
            aria-pressed={current === option}
            onClick={() => onPick(option)}
            className={segment(current === option)}
          >
            {t(`view.${option}`)}
          </button>
        ) : (
          <Link
            key={option}
            href={option === 'actions' ? HISTORY_HREF : `${HISTORY_HREF}?view=${option}`}
            className={segment(false)}
          >
            {t(`view.${option}`)}
          </Link>
        ),
      )}
      {kpis &&
        (current === 'kpis' ? (
          <span aria-current="page" className={segment(true)}>
            {t('view.kpis')}
          </span>
        ) : (
          <Link href={ACTION_CENTER_KPIS} className={segment(false)}>
            {t('view.kpis')}
          </Link>
        ))}
    </div>
  );
}
