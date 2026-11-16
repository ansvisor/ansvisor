'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AdsApiError, type AdsDecision } from '@/lib/ads/api';

/** Why a half failed: the API's code ('failed' for anything else) and its `why`. */
export interface AdsFailure {
  code: string;
  why: string | null;
}

/**
 * One half of "Do both": the Earn card's task or the Pay card's drafts, with
 * its own idempotency key, so a retry after a failure never makes it twice.
 */
export interface AdsHalf<T> {
  done: T | null;
  busy: boolean;
  failed: AdsFailure | null;
  run: () => Promise<void>;
}

const IDLE = { done: null, busy: false, failed: null };

export function useAdsHalf<T>(call: (key: string) => Promise<T>, onFail?: () => void): AdsHalf<T> {
  const [key] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<Omit<AdsHalf<T>, 'run'>>(IDLE);
  const run = async () => {
    setState((s) => ({ ...s, busy: true }));
    try {
      setState({ done: await call(key), busy: false, failed: null });
    } catch (err) {
      const body = (err instanceof AdsApiError ? err.body : {}) as Partial<AdsFailure>;
      setState({
        done: null,
        busy: false,
        failed: { code: body.code ?? 'failed', why: body.why ?? null },
      });
      onFail?.();
    }
  };
  return { ...state, run };
}

/**
 * The drawer's primary button (ADS-01 §3.2, §9.4), for those who can write,
 * follows the decision: Earn adds the task to the Action Center, Pay creates
 * the ad drafts, Earn + pay does both, less a half already done. When one
 * half fails, it says which and retries only that one. Overlap has none
 * (paid isn't measured yet). Both halves are Ansvisor's own Ads routes.
 */
export function AdsDoBoth({
  decision,
  earn,
  pay,
}: {
  decision: AdsDecision;
  earn: { done: boolean; half: AdsHalf<unknown> };
  pay: { done: boolean; half: AdsHalf<unknown> };
}) {
  const t = useTranslations('ads.drawer.doBoth');
  const toEarn = (decision === 'earn' || decision === 'earn_pay') && !earn.done;
  const toPay = (decision === 'pay' || decision === 'earn_pay') && !pay.done;
  if (!toEarn && !toPay) return null;
  const kind = toEarn && toPay ? 'both' : toEarn ? 'earn' : 'pay';
  const failed = kind !== 'both' && (kind === 'earn' ? earn : pay).half.failed;

  return (
    // In the drawer's footer: the line above its buttons (out of the row while empty), the button last.
    <div data-slot="ads-do-both" className="contents">
      <p
        role="status"
        className="order-first basis-full text-xs text-muted-foreground empty:absolute"
      >
        {/* The other half of "Do both" is done: say which one failed. */}
        {failed && decision === 'earn_pay' && t(kind === 'earn' ? 'earnFailed' : 'payFailed')}
      </p>
      <Button
        data-action="ads.doBoth"
        data-kind={kind}
        disabled={earn.half.busy || pay.half.busy}
        onClick={() => void Promise.all([toEarn && earn.half.run(), toPay && pay.half.run()])}
      >
        {failed ? t(kind === 'earn' ? 'retryEarn' : 'retryPay') : t(kind)}
      </Button>
    </div>
  );
}
