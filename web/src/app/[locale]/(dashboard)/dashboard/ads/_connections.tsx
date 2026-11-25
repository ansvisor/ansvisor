'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useUpgradeDialog } from '@/components/providers/upgrade-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import {
  AdsApiError,
  notifyAdsPlatform,
  readAdsAccounts,
  readAdsAnalytics,
  type AdsAccount,
  type AdsAnalytics,
  type AdsLaterPlatform,
} from '@/lib/ads/api';
import { useBrandStore } from '@/stores/use-brand-store';
import { ChatGptAdsAccounts } from './_chatgpt-ads';

/** Where Google Analytics is connected and managed, as Chat's Connections opens it. */
const INTEGRATIONS_GA = '/dashboard/settings/integrations#google-analytics';
const SOON = ['google'] as const;
// Microsoft waits for its API access (owner, 2026-11-21), so it comes later too.
const LATER: AdsLaterPlatform[] = ['microsoft', 'meta', 'linkedin'];
type PlatformId = 'chatgpt' | (typeof SOON)[number] | AdsLaterPlatform | 'analytics';

function Platform({ id, children }: { id: PlatformId; children: ReactNode }) {
  const t = useTranslations('ads.connections.platforms');
  return (
    <Card size="sm" data-slot="ads-connection" data-platform={id}>
      <CardContent className="flex h-full flex-col gap-3">
        <div>
          <p className="font-medium">{t(`${id}.name`)}</p>
          <p className="text-xs text-muted-foreground">{t(`${id}.note`)}</p>
        </div>
        <div className="mt-auto flex items-center justify-between gap-2">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Notify me (`conn.notify`): the server logs it once per person and
 * platform; then, or asked again, "We'll tell you". The demo brand and a
 * read-only workspace open the plan dialog, as their other writes do.
 */
function NotifyMe({ brandId, platform }: { brandId: string; platform: AdsLaterPlatform }) {
  const t = useTranslations('ads.connections');
  const upgrade = useUpgradeDialog();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const ask = async () => {
    setState('busy');
    try {
      const { logged } = await notifyAdsPlatform(brandId, platform);
      setState('done');
      if (logged) toast.success(t('notifiedToast', { name: t(`platforms.${platform}.name`) }));
    } catch (err) {
      setState('idle');
      const code = err instanceof AdsApiError ? err.code : null;
      if (code === 'demo_brand' || code === 'subscription_inactive') upgrade?.openUpgrade();
      else toast.error(t('notifyFailed'));
    }
  };
  return state === 'done' ? (
    <span className="flex items-center gap-1 text-sm">
      <Check aria-hidden className="size-4 text-green-600" />
      {t('notified')}
    </span>
  ) : (
    <Button
      size="sm"
      variant="outline"
      data-action="conn.notify"
      disabled={state === 'busy'}
      onClick={() => void ask()}
    >
      {t('notify')}
    </Button>
  );
}

/** Google Analytics' status from the one read of the brand's connections; Settings manages it. */
function Analytics({ brandId }: { brandId: string }) {
  const t = useTranslations('ads.connections');
  const [read, setRead] = useState<{ brandId: string; analytics: AdsAnalytics | null }>();
  useEffect(() => {
    let live = true;
    const done = (analytics: AdsAnalytics | null) => live && setRead({ brandId, analytics });
    readAdsAnalytics(brandId).then(done, () => done(null));
    return () => {
      live = false;
    };
  }, [brandId]);
  if (read?.brandId !== brandId) return <Skeleton className="h-7 w-full" />;
  const status = read.analytics?.status ?? 'unknown';
  const connect = status === 'not_connected';
  return (
    <>
      <Badge variant={status === 'connected' ? 'secondary' : 'outline'}>
        {t(`status.${status}`)}
      </Badge>
      <Link
        href={INTEGRATIONS_GA}
        data-action={connect ? 'conn.connect' : 'conn.manage'}
        className={buttonVariants({ variant: connect ? 'default' : 'outline', size: 'sm' })}
      >
        {t(connect ? 'connect' : 'manage')}
      </Link>
    </>
  );
}

/**
 * The brand's ad accounts, read once for the platforms' cards: undefined
 * while it reads, null when it failed. A card's change is kept as given.
 */
function useAdsAccounts(brandId: string | null) {
  const [read, setRead] = useState<{ brandId: string; accounts: AdsAccount[] | null }>();
  useEffect(() => {
    if (!brandId) return;
    let live = true;
    const done = (accounts: AdsAccount[] | null) => live && setRead({ brandId, accounts });
    readAdsAccounts(brandId).then(done, () => done(null));
    return () => {
      live = false;
    };
  }, [brandId]);
  const accounts = brandId && read?.brandId === brandId ? read.accounts : undefined;
  const change = (next: AdsAccount[]) => brandId && setRead({ brandId, accounts: next });
  return [accounts, change] as const;
}

/**
 * Ads' Connections (ADS-01 §3.5, mockup `#con`): ChatGPT Ads connects with
 * the customer's own Ads API key (Phase 1, C2); Google Ads comes soon;
 * Microsoft Advertising, Meta and LinkedIn later, with Notify me; Google
 * Analytics is the app's own, connected anywhere means connected here. Each
 * platform keeps its own billing: said, never shown.
 */
export function AdsConnections() {
  const t = useTranslations('ads.connections');
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [accounts, setAccounts] = useAdsAccounts(brandId);
  return (
    <div data-slot="ads-connections" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Platform id="chatgpt">
        {brandId &&
          (accounts === undefined ? (
            <Skeleton className="h-7 w-full" />
          ) : (
            <ChatGptAdsAccounts brandId={brandId} accounts={accounts} onChange={setAccounts} />
          ))}
      </Platform>
      {SOON.map((id) => (
        <Platform key={id} id={id}>
          <Badge variant="outline">{t('soon')}</Badge>
        </Platform>
      ))}
      {LATER.map((id) => (
        <Platform key={id} id={id}>
          <span className="text-sm text-muted-foreground">{t('later')}</span>
          {brandId && <NotifyMe brandId={brandId} platform={id} />}
        </Platform>
      ))}
      <Platform id="analytics">{brandId && <Analytics brandId={brandId} />}</Platform>
    </div>
  );
}
