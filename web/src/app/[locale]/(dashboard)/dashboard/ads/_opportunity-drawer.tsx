'use client';

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import {
  createAdsDrafts,
  readAdsOpportunity,
  sendAdsEarn,
  type AdsOpportunity,
  type AdsOpportunityDetail,
  type AdsReason,
} from '@/lib/ads/api';
import type { AdsPeriod } from '@/lib/ads/tabs';
import { formatDate, formatNumber } from '@/lib/format';
import { regionLabel } from '@/lib/region';
import { AdsDoBoth, useAdsHalf } from './_do-both';
import { AdsEarnCard } from './_earn-card';
import { AdsCopyBrief, AdsExportOne } from './_export';
import { AdsPayCard } from './_pay-card';

const num = (v: unknown) => (typeof v === 'number' ? formatNumber(v) : '');

/** A section's small heading, as the mockup's. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-5 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

/**
 * An opportunity's drawer (ADS-01 §3.2, mockup): the row's decision and why
 * at the top, then "What AI answers today", the latest answer on each
 * platform, with its fan-outs and keyword seeds, the Earn and Pay cards,
 * and the footer: "Copy as campaign brief", Export this prompt and "Do
 * both". Answer text is the AI's, not ours: shown as quoted plain text
 * only. It closes with ✕, the overlay or Esc (`drawer.close`), and gives
 * focus back to the row's Open. The table keys it by prompt.
 */
export function AdsOpportunityDrawer({
  row,
  open,
  brandId,
  period,
  decision,
  canSend,
  finalFocus,
  onClose,
}: {
  row: AdsOpportunity;
  open: boolean;
  brandId: string;
  period: AdsPeriod;
  /** The row's decision, as the table shows it. */
  decision: ReactNode;
  /** Whether the person can send the fix and create drafts: as they can change the decision. */
  canSend: boolean;
  finalFocus: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useTranslations('ads.drawer');
  const tRows = useTranslations('ads.opportunities');
  const { promptId } = row;
  const earn = useAdsHalf(
    (k) => sendAdsEarn(brandId, promptId, k),
    () => toast.error(t('earn.failed')),
  );
  const pay = useAdsHalf((k) => createAdsDrafts(brandId, promptId, k));
  const key = `${brandId}/${promptId}/${period}`;
  const created = pay.done !== null;
  const [read, setRead] = useState<{ key: string; detail: AdsOpportunityDetail | null } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    let live = true;
    const done = (detail: AdsOpportunityDetail | null) => {
      if (live) setRead({ key, detail });
    };
    // Read again once drafts are made, for the facts they rest on (the
    // brief's), keeping the first read if that fails.
    readAdsOpportunity(brandId, promptId, period).then(done, () => !created && done(null));
    return () => {
      live = false;
    };
  }, [open, brandId, promptId, period, key, created]);

  const reason = (r: AdsReason) =>
    t.has(`reasons.${r.code}`)
      ? t(`reasons.${r.code}`, {
          position: typeof r.position === 'number' ? String(r.position) : 'none',
          name: row.leaderName ?? tRows('leaderRival'),
          volume: num(r.volume),
          threshold: num(r.threshold),
        })
      : null;
  const reasons = (row.reasons ?? []).map(reason).filter((r) => r !== null);
  const detail = read?.key === key ? read.detail : undefined;
  const drafts = pay.done?.drafts ?? detail?.drafts ?? [];

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
          className="fixed inset-y-0 end-0 z-50 flex w-full max-w-[560px] flex-col border-s bg-card text-sm shadow-lg duration-200 data-closed:animate-out data-closed:slide-out-to-right-10 data-open:animate-in data-open:slide-in-from-right-10"
        >
          <div className="flex items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Dialog.Title className="text-base font-semibold">{row.text}</Dialog.Title>
              {decision}
              {reasons.length > 0 && (
                <ul aria-label={t('why')} className="space-y-0.5 text-xs text-muted-foreground">
                  {reasons.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              )}
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
            <Heading>{t('answers')}</Heading>
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

            {detail && detail.fanOuts.length > 0 && (
              <>
                <Heading>{t('fanOuts')}</Heading>
                <ul className="flex flex-wrap gap-1.5" data-slot="ads-fanouts">
                  {detail.fanOuts.map((f) => (
                    <li key={f.query} className="rounded-full border px-2.5 py-0.5 text-xs">
                      {f.query}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {detail && detail.keywords.length > 0 && (
              <>
                <Heading>{t('keywords')}</Heading>
                <ul className="flex flex-wrap gap-1.5" data-slot="ads-keywords">
                  {detail.keywords.map((k) => (
                    <li key={k} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">
                      {k}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {detail && (
              <>
                <AdsEarnCard row={row} earn={detail.earn} canSend={canSend} half={earn} />
                <AdsPayCard
                  row={row}
                  brandId={brandId}
                  drafts={drafts}
                  canCreate={canSend}
                  half={pay}
                  onLeave={onClose}
                />
              </>
            )}
          </div>
          {detail && (
            <div
              data-slot="ads-drawer-footer"
              className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3"
            >
              <AdsCopyBrief row={row} detail={detail} reasons={reasons} drafts={drafts} />
              {canSend && <AdsExportOne brandId={brandId} promptId={promptId} period={period} />}
              {canSend && (
                <AdsDoBoth
                  decision={row.decision}
                  earn={{ done: !!(earn.done?.action ?? detail.earn.action), half: earn }}
                  pay={{ done: drafts.length > 0, half: pay }}
                />
              )}
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
