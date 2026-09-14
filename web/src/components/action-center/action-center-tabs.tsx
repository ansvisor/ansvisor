'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { getNewSignalCount } from '@/lib/actions/signals';
import { cn } from '@/lib/utils';

// History is deliberately absent: the route still answers, but a top-level
// tab that only ever says "coming soon" is a dead end for anyone who clicks
// it. It returns here when the page renders the action_events trail the
// action drawer already shows per action.
const TABS = [
  { key: 'kpis', href: '/dashboard/action-center/kpis' },
  { key: 'actions', href: '/dashboard/action-center/actions' },
  { key: 'signals', href: '/dashboard/action-center/signals' },
] as const;

/**
 * The Action Center's section nav: KPIs | Actions | Signals.
 * Route-backed rather than state-backed tabs so each section is linkable
 * and the browser back button works across them.
 */
export function ActionCenterTabs() {
  const pathname = usePathname();
  const t = useTranslations('actionCenter.tabs');

  // Untriaged-signal count on the Signals tab: information ("something new
  // is waiting"), not decoration. Best-effort — a failed count shows nothing.
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [newSignals, setNewSignals] = useState(0);
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    getNewSignalCount(brandId)
      .then((count) => {
        if (!cancelled) setNewSignals(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandId, pathname]);

  return (
    <nav className="flex gap-6 border-b" aria-label={t('label')}>
      {TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 pb-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab.key)}
            {tab.key === 'signals' && newSignals > 0 && (
              <span className="ml-1.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                {newSignals}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
