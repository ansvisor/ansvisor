'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { sendAdsEarn, type AdsActionRef, type AdsOpportunity } from '@/lib/ads/api';
import { cn } from '@/lib/utils';

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
 * change the decision (`canSend`), as the decision's own menu.
 */
export function AdsEarnCard({
  row,
  brandId,
  earn,
  canSend,
}: {
  row: AdsOpportunity;
  brandId: string;
  earn: { page: string | null; action: AdsActionRef | null };
  canSend: boolean;
}) {
  const t = useTranslations('ads.drawer.earn');
  // One key per card: a retry after a failure can't make a second action.
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ action: AdsActionRef; covered: boolean } | null>(null);
  if (row.decision !== 'earn' && row.decision !== 'earn_pay') return null;

  const why = row.reasons.some((r) => r.code === 'rival_leads')
    ? 'rival'
    : row.weCited || row.leader === 'us'
      ? 'protect'
      : 'open';
  const action = sent?.action ?? earn.action;
  const send = async () => {
    setBusy(true);
    try {
      const res = await sendAdsEarn(brandId, row.promptId, key);
      setSent({ action: res.action, covered: res.covered });
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  };

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
          {t(sent && !sent.covered ? 'sent' : 'open', { no: String(action.no) })}
        </Link>
      ) : (
        canSend && (
          <Button
            size="sm"
            variant="outline"
            data-action="ads.earnTask"
            disabled={busy}
            onClick={() => void send()}
          >
            {t('send')}
          </Button>
        )
      )}
    </section>
  );
}
