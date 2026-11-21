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
 * History's views: KPIs first, a link to its own page (which keeps its
 * address but is no tab of its own), then its actions and the scorecard of
 * what each kind did, switched in place on History's page (`onPick`). On the
 * KPIs page (`current` "kpis") the other two link back to History.
 */
export function HistoryViews({
  current,
  onPick,
}: {
  current: HistoryOwnView | 'kpis';
  onPick?: (view: HistoryOwnView) => void;
}) {
  const t = useTranslations('actionCenter.historyPage');
  const own: HistoryOwnView[] = ['actions', 'scorecard'];
  return (
    <div className="space-y-2">
      <div
        className="inline-flex overflow-hidden rounded-md border"
        role="group"
        aria-label={t('view.label')}
      >
        {/* KPIs first (owner, 2026-11-21). */}
        {current === 'kpis' ? (
          <span aria-current="page" className={segment(true)}>
            {t('view.kpis')}
          </span>
        ) : (
          <Link href={ACTION_CENTER_KPIS} className={segment(false)}>
            {t('view.kpis')}
          </Link>
        )}
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
      </div>
      {/* What the picked view shows, so Past actions and Results by kind read apart. */}
      <p data-slot="history-view-hint" className="text-sm text-muted-foreground">
        {t(`view.${current}Hint`)}
      </p>
    </div>
  );
}
