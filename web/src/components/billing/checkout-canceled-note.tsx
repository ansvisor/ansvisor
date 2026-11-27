'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { CHECKOUT_CANCELED_PARAM, CHECKOUT_CANCELED_VALUE } from '@/lib/billing/checkout-canceled';

/**
 * Whether the page was reached back from a Stripe Checkout left without
 * paying. Read once after mount (no server/client mismatch), and the mark is
 * taken off the address, so a reload doesn't say it again.
 */
export function useCheckoutCanceled(): boolean {
  const [canceled, setCanceled] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search ?? '');
    if (params.get(CHECKOUT_CANCELED_PARAM) !== CHECKOUT_CANCELED_VALUE) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setCanceled(true);
    params.delete(CHECKOUT_CANCELED_PARAM);
    const search = params.toString();
    const { pathname, hash } = window.location;
    try {
      window.history.replaceState(
        window.history.state,
        '',
        `${pathname}${search ? `?${search}` : ''}${hash}`,
      );
    } catch {
      // The note still shows; only a reload would say it again.
    }
  }, []);
  return canceled;
}

/**
 * Said once, back from a checkout left without paying: nothing was charged,
 * and what to do next (try again; on the plan step, the demo needs no card).
 */
export function CheckoutCanceledNote({ demo = false }: { demo?: boolean }) {
  const t = useTranslations('planOffer.checkoutCanceled');
  const canceled = useCheckoutCanceled();
  if (!canceled) return null;
  return (
    <div
      role="status"
      data-slot="checkout-canceled"
      className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p>
        <span className="font-medium">{t('title')}</span> {demo ? t('bodyDemo') : t('body')}
      </p>
    </div>
  );
}
