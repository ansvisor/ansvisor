'use client';

import { ListChecks, ReceiptText, SearchCheck, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** The four reasons, in the order the cards show them. */
export const WHY_ANSVISOR = ['answers', 'actions', 'price', 'results'] as const;

const ICONS = {
  answers: SearchCheck,
  actions: ListChecks,
  price: ReceiptText,
  results: TrendingUp,
} as const;

/**
 * "Why Ansvisor" on the first screen, How do you want to start?: the four
 * things buyers asked about (trust in the data, actions, price, results), one
 * short line each, compact so the plans still fit a 1024×768 screen.
 */
export function WhyAnsvisor({ className }: { className?: string }) {
  const t = useTranslations('planOffer.why');
  return (
    <ul
      data-slot="why-ansvisor"
      aria-label={t('label')}
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}
    >
      {WHY_ANSVISOR.map((key) => {
        const Icon = ICONS[key];
        return (
          <li key={key} className="rounded-lg border bg-card px-3 py-2 text-start">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {t(`${key}.title`)}
            </div>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{t(`${key}.body`)}</p>
          </li>
        );
      })}
    </ul>
  );
}
