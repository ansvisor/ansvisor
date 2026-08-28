'use client';

import { useTranslations } from 'next-intl';
import { Hourglass } from 'lucide-react';
import { ActionCenterTabs } from './action-center-tabs';

/**
 * Shared shell for the Action Center sections that exist in navigation but
 * not yet in function (Actions, Signals, History). Honest placeholder over a
 * dead tab: the route works, the nav highlights, and the body says exactly
 * where things stand.
 */
export function ComingSoonPage({ tab }: { tab: 'actions' | 'signals' | 'history' }) {
  const t = useTranslations('actionCenter');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t(`tabs.${tab}`)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(`pages.${tab}`)}</p>
      </div>
      <ActionCenterTabs />
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <Hourglass className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('comingSoon.title')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('comingSoon.description')}</p>
      </div>
    </div>
  );
}
