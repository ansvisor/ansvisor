'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';

/**
 * The Action Center's own header:
 * "Action Center" and a line on the tab shown, with the AI usage and Ask Chat
 * every page's header has. Today and Agents use it; Actions, Signals and
 * History keep their own titles until they are restyled. `aside` sits at
 * the line's right: Today's "Since yesterday: … · … waiting for you".
 */
export function ActionCenterHeader({
  subtitle,
  aside,
}: {
  subtitle: ReactNode;
  aside?: ReactNode;
}) {
  const t = useTranslations('actionCenter.header');
  return (
    <HeaderWithAiUsage>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {aside && <p className="text-[13px] text-muted-foreground">{aside}</p>}
      </div>
    </HeaderWithAiUsage>
  );
}
