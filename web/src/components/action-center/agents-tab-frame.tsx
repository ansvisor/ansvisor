'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';
import { ActionCenterTabs } from './action-center-tabs';

/**
 * Agent Center's pages as Action Center › Agents: the tab's own title, as
 * Actions, Signals and History show theirs (AC-50), and the Action Center's
 * tabs above them, at their own addresses (/dashboard/agents and the pages
 * under it), so links, menu access and Chat's routes to them don't change.
 */
export function AgentsTabFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('actionCenter.header');
  const tTabs = useTranslations('actionCenter.tabs');
  return (
    <div className="space-y-6" data-frame="action-center">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tTabs('agents')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('agentsSubtitle')}</p>
        </div>
      </HeaderWithAiUsage>
      <ActionCenterTabs />
      <div>{children}</div>
    </div>
  );
}
