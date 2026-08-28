'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'kpis', href: '/dashboard/action-center/kpis' },
  { key: 'actions', href: '/dashboard/action-center/actions' },
  { key: 'signals', href: '/dashboard/action-center/signals' },
  { key: 'history', href: '/dashboard/action-center/history' },
] as const;

/**
 * The Action Center's section nav: KPIs | Actions | Signals | History.
 * Route-backed rather than state-backed tabs so each section is linkable
 * and the browser back button works across them.
 */
export function ActionCenterTabs() {
  const pathname = usePathname();
  const t = useTranslations('actionCenter.tabs');

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
          </Link>
        );
      })}
    </nav>
  );
}
