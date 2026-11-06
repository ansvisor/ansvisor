'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ActionPlay } from '@/lib/action-center/play';
import { pagePath } from '@/lib/content/overlap';

/**
 * "What to do for {an online store | a SaaS | an app | a travel brand}"
 * (AC-ACTION-PLAN spec §5, P-2): the page the action's prompts pick, with
 * the measured reasons behind it, then up to two more worth doing for the
 * same prompts. Start now (§10) sits under it: the play is what it writes.
 */
export function PlaySection({ play, children }: { play: ActionPlay; children?: ReactNode }) {
  const t = useTranslations('actionCenter.actionsPage.play');
  return (
    <section aria-label={t('title', { siteType: play.siteType })} className="space-y-3">
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          {t('title', { siteType: play.siteType })}
        </p>
        <p className="font-medium">{t(`plays.${play.id}`)}</p>
        {play.reasons.map((reason, i) => (
          <p key={i} className="text-xs text-muted-foreground">
            {reason.kind === 'category'
              ? t('categoryReason', {
                  category: reason.category,
                  page: pagePath(reason.page),
                  inStock: reason.inStock,
                })
              : t('reason', {
                  play: play.id,
                  prompts: reason.prompts,
                  of: reason.of,
                  share: reason.share,
                })}
          </p>
        ))}
      </div>
      {children}
      {play.supporting.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t('also')}</p>
          <ul className="space-y-0.5">
            {play.supporting.map((option) => (
              <li key={option.id} className="text-xs">
                {t('alsoLine', { name: t(`plays.${option.id}`), share: option.share })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
