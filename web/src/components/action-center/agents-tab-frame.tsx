'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ActionCenterHeader } from './action-center-header';
import { ActionCenterTabs } from './action-center-tabs';

/**
 * Agent Center's pages as Action Center › Agents: the Action Center's header and
 * tabs above them, at their own addresses (/dashboard/agents and the pages
 * under it), so links, menu access and Chat's routes to them don't change.
 */
export function AgentsTabFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('actionCenter.header');
  return (
    <div className="space-y-6" data-frame="action-center">
      <ActionCenterHeader subtitle={t('agentsSubtitle')} />
      <ActionCenterTabs />
      <div>{children}</div>
    </div>
  );
}
