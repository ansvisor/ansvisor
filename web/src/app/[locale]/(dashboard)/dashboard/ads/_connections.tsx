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
  readAdsAnalytics,
  type AdsAnalytics,
  type AdsLaterPlatform,
} from '@/lib/ads/api';
import { useBrandStore } from '@/stores/use-brand-store';

/** Where Google Analytics is connected and managed, as Chat's Connections opens it. */
const INTEGRATIONS_GA = '/dashboard/settings/integrations#google-analytics';
const SOON = ['chatgpt', 'google', 'microsoft'] as const;
const LATER: AdsLaterPlatform[] = ['meta', 'linkedin'];
type PlatformId = (typeof SOON)[number] | AdsLaterPlatform | 'analytics';

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
 * Ads' Connections (ADS-01 §3.5, mockup `#con`): no ad account connects in
 * this preview. ChatGPT Ads, Google Ads and Microsoft Advertising come soon,
 * Meta and LinkedIn later, with Notify me; Google Analytics is the app's
 * own, connected anywhere means connected here. Each platform keeps its own
 * billing: said, never shown.
 */
export function AdsConnections() {
  const t = useTranslations('ads.connections');
  const brandId = useBrandStore((s) => s.activeBrandId);
  return (
    <div data-slot="ads-connections" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
