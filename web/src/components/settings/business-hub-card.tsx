'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, Store } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';
import { useDemoBrand } from '@/components/providers/demo-brand-provider';
import { readBusinessHubSetup } from '@/lib/actions/business-hub-setup';
import { BUSINESS_HUB_URL } from '@/lib/business-hub/links';
import { useBrandStore } from '@/stores/use-brand-store';

/** Visibility's Business Hub card, its Enter numbers dialog open (?businessHub=enter). */
export const ENTER_NUMBERS_HREF = '/dashboard/insights?businessHub=enter';

/** The brand's setup action, as read for it: null while it is read. */
export interface BusinessHubSetup {
  /** The server's BUSINESS_HUB_ENABLED: off, the card isn't there. */
  enabled: boolean;
  setup: { actionHref: string | null; failed: boolean } | null;
}

/**
 * Whether ChatGPT Business Hub's card shows (BUSINESS_HUB_ENABLED, read on
 * the server), and the active brand's setup action. Until the server says
 * the flag is on, the card isn't there, with no skeleton; a read that fails
 * offers nothing. On a change of brand, the card stays and its setup action
 * is read again.
 */
export function useBusinessHubSetup(): BusinessHubSetup {
  const { activeBrandId } = useBrandStore();
  const [enabled, setEnabled] = useState(false);
  const [read, setRead] = useState<{
    brandId: string | null;
    setup: { actionHref: string | null; failed: boolean };
  } | null>(null);

  useEffect(() => {
    let live = true;
    const brandId = activeBrandId ?? null;
    void readBusinessHubSetup(brandId).then(
      (result) => {
        if (!live) return;
        setEnabled(result.enabled);
        if (result.enabled) {
          setRead({
            brandId,
            setup: { actionHref: result.actionHref, failed: result.failed },
          });
        }
      },
      () => {
        if (live) setRead({ brandId, setup: { actionHref: null, failed: true } });
      },
    );
    return () => {
      live = false;
    };
  }, [activeBrandId]);

  return {
    enabled,
    setup: read && read.brandId === (activeBrandId ?? null) ? read.setup : null,
  };
}

/**
 * Settings › Integrations › ChatGPT Business Hub (BUSINESS_HUB_ENABLED):
 * OpenAI's place to claim a business's profile in ChatGPT. It has no API, so
 * there is nothing to connect, and the card says so: its work is done where
 * it happens. Set up your profile opens the brand's setup action in the
 * Action Center; a brand without one (not eligible yet, or the demo brand)
 * gets Business Hub itself, in a new tab, with a line saying why. Enter
 * numbers opens Visibility's Business Hub card with its dialog. Both open
 * pages every member can use, so every role sees the same card.
 */
export function BusinessHubCard({ setup }: { setup: BusinessHubSetup['setup'] }) {
  const t = useTranslations('settings.businessHub');
  const { activeBrandId, brands } = useBrandStore();
  const { isDemo } = useDemoBrand();
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  const opensBusinessHub = setup !== null && !setup.actionHref;
  const why = !opensBusinessHub
    ? null
    : setup.failed
      ? t('unread')
      : isDemo
        ? t('demoNoAction')
        : t('noAction', { brand: brand?.name ?? '' });

  return (
    <div
      className="space-y-4 rounded-lg border bg-card p-4"
      data-integration="chatgpt-business-hub"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Store className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t('title')}</p>
            <Badge variant="outline" className="text-muted-foreground">
              {t('manual')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      {!brand ? (
        <p className="text-sm text-muted-foreground">{t('noBrand')}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {setup === null ? (
              <Skeleton className="h-7 w-36" />
            ) : setup.actionHref ? (
              <Link href={setup.actionHref} className={buttonVariants({ size: 'sm' })}>
                {t('setUp')}
              </Link>
            ) : (
              <a
                href={BUSINESS_HUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ size: 'sm' })}
              >
                {t('setUp')}
                <ArrowUpRight aria-hidden />
              </a>
            )}
            <Link
              href={ENTER_NUMBERS_HREF}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('enterNumbers')}
            </Link>
          </div>
          {why && <p className="text-xs text-muted-foreground">{why}</p>}
          <p className="text-xs text-muted-foreground">{t('apiNote')}</p>
        </div>
      )}
    </div>
  );
}
