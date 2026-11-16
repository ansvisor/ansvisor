'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { actionCodeNo } from '@/lib/action-center/action-ref';
import type { AdsActionRef, AdsOpportunity, sendAdsEarn } from '@/lib/ads/api';
import { cn } from '@/lib/utils';
import type { AdsHalf } from './_do-both';

/** "/small-teams" for a page's address; its host for the home page. */
function pageLabel(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    return pathname.length > 1 ? pathname.replace(/\/$/, '') : hostname;
  } catch {
    return url;
  }
}

/**
 * The drawer's Earn card (ADS-01 §3.2, mockup), for Earn and Earn + pay: what
 * to fix, in a line, from the row's reasons and the prompt's target page, and
 * Send to Action Center (`ads.earnTask`), which the server makes one action
 * of, once per key. Where an active action already covers the prompt, or once
 * sent, it opens that action. The button is there only for those who can
 * change the decision (`canSend`), as the decision's own menu. Sending is
 * "Do both"'s Earn half (`half`), which the drawer's primary button shares.
 */
export function AdsEarnCard({
  row,
  earn,
  canSend,
  half,
}: {
  row: AdsOpportunity;
  earn: { page: string | null; action: AdsActionRef | null };
  canSend: boolean;
  half: AdsHalf<Awaited<ReturnType<typeof sendAdsEarn>>>;
}) {
  const t = useTranslations('ads.drawer.earn');
  const sent = half.done;
  if (row.decision !== 'earn' && row.decision !== 'earn_pay') return null;

  const why = row.reasons.some((r) => r.code === 'rival_leads')
    ? 'rival'
    : row.weCited || row.leader === 'us'
      ? 'protect'
      : 'open';
  const action = sent?.action ?? earn.action;

  return (
    <section data-slot="ads-earn" className="mt-5 space-y-2 rounded-xl border p-3">
      <h3 className="font-semibold">{t('title')}</h3>
      <p className="text-muted-foreground">
        {t('fix', {
          page: earn.page ? pageLabel(earn.page) : 'none',
          why,
          name: row.leaderName ?? 'none',
        })}
      </p>
      {action ? (
        <Link
          href={`/dashboard/action-center/actions?action=${action.id}`}
          data-action="ads.openAction"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          {t(sent && !sent.covered ? 'sent' : 'open', {
            no: actionCodeNo({ actionNo: action.no, brandNo: action.brandNo }),
          })}
        </Link>
      ) : (
        canSend && (
          <Button
            size="sm"
            variant="outline"
            data-action="ads.earnTask"
            disabled={half.busy}
            onClick={() => void half.run()}
          >
            {t('send')}
          </Button>
        )
      )}
    </section>
  );
}
