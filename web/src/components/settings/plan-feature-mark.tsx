'use client';

import { useTranslations } from 'next-intl';

/**
 * "+ add-ons" beside a plan card's line that the plan can grow (00546):
 * Growth's brands, prompts and AI usage, bought on Billing's add-ons card.
 * The hover says how.
 */
export function ExpandableMark() {
  const t = useTranslations('settings.planCards');
  return (
    <span
      title={t('expandableHint')}
      data-slot="expandable-mark"
      className="ms-1.5 inline-flex cursor-help items-center rounded-full border px-1.5 py-px align-middle text-[10px] font-medium whitespace-nowrap text-muted-foreground"
    >
      {t('expandable')}
    </span>
  );
}
