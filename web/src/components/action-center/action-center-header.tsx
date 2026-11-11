'use client';

import { useTranslations } from 'next-intl';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';

/**
 * The Action Center's own header with the simplified layout on (SIMPLE_NAV):
 * "Action Center" and a line on the tab shown, with the AI usage and Ask Chat
 * every page's header has. Today and Agents use it; Actions, Signals and
 * History keep their own titles until they are restyled.
 */
export function ActionCenterHeader({ subtitle }: { subtitle: string }) {
  const t = useTranslations('actionCenter.header');
  return (
    <HeaderWithAiUsage>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </HeaderWithAiUsage>
  );
}
