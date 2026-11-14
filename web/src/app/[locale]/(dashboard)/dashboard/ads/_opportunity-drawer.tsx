'use client';

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { readAdsOpportunity, type AdsOpportunity, type AdsOpportunityDetail } from '@/lib/ads/api';
import type { AdsPeriod } from '@/lib/ads/tabs';
import { formatDate } from '@/lib/format';
import { regionLabel } from '@/lib/region';

/**
 * An opportunity's drawer (ADS-01 §3.2, mockup): the row's decision at the
 * top, then "What AI answers today", the latest answer on each platform.
 * Answer text is the AI's, not ours: shown as quoted plain text only. It
 * closes with ✕, the overlay or Esc (`drawer.close`), and gives focus back
 * to the row's Open.
 */
export function AdsOpportunityDrawer({
  row,
  open,
  brandId,
  period,
  decision,
  finalFocus,
  onClose,
}: {
  row: AdsOpportunity;
  open: boolean;
  brandId: string;
  period: AdsPeriod;
  /** The row's decision, as the table shows it. */
  decision: ReactNode;
  finalFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useTranslations('ads.drawer');
  const tRows = useTranslations('ads.opportunities');
  const { promptId } = row;
  const key = `${brandId}/${promptId}/${period}`;
  const [read, setRead] = useState<{ key: string; detail: AdsOpportunityDetail | null } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let live = true;
    const done = (detail: AdsOpportunityDetail | null) => {
      if (live) setRead({ key, detail });
    };
    readAdsOpportunity(brandId, promptId, period).then(done, () => done(null));
    return () => {
      live = false;
    };
  }, [open, brandId, promptId, period, key]);

  const detail = read?.key === key ? read.detail : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop
          data-action="drawer.close"
          className="fixed inset-0 z-50 bg-black/20 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0"
        />
        <Dialog.Popup
          data-slot="ads-drawer"
          finalFocus={finalFocus}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l bg-card text-sm shadow-lg duration-200 data-closed:animate-out data-closed:slide-out-to-right-10 data-open:animate-in data-open:slide-in-from-right-10"
        >
          <div className="flex items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Dialog.Title className="text-base font-semibold">{row.text}</Dialog.Title>
              {decision}
            </div>
            <Dialog.Close
              data-action="drawer.close"
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
              <span className="sr-only">{t('close')}</span>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-5">
            <h3 className="mt-5 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('answers')}
            </h3>
            {detail === undefined ? (
              <Skeleton className="h-32 w-full rounded-xl" />
            ) : detail === null ? (
              <p role="alert" className="text-muted-foreground">
                {t('failed')}
              </p>
            ) : detail.answers.length === 0 ? (
              <p className="text-muted-foreground">{t('noAnswers')}</p>
            ) : (
              <ul className="space-y-3">
                {detail.answers.map((a) => (
                  <li key={a.platform} data-slot="ads-answer" className="space-y-1.5">
                    <p className="text-xs font-medium">
                      {t('answerOn', {
                        platform: PLATFORM_LABELS[a.platform] ?? a.platform,
                        region: a.region ? regionLabel(a.region) : 'none',
                        date: formatDate(a.at),
                      })}
                    </p>
                    {/* The AI's words, as data: React text, never HTML or markdown. */}
                    <blockquote className="rounded-xl border bg-muted/40 p-3 leading-relaxed">
                      {a.excerpt}
                    </blockquote>
                    <p className="text-xs text-muted-foreground">
                      {tRows('you', { at: String(a.mentionPosition ?? 'none'), cited: 'false' })}
                      {a.competitors.length > 0 &&
                        ` · ${t('named', { names: a.competitors.map((c) => c.name).join(', ') })}`}
                    </p>
                    {a.domains.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t('cites', { domains: a.domains.join(', ') })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {/* Sponsored units show here once PR 16/17 store them; never before, never estimated. */}
            {/* The Earn and Pay cards (PR 10–12) go here. */}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
