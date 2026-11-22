'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { CHOOSE_PLAN_HREF, useUpgradeDialog } from '@/components/providers/upgrade-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CONTACT_SALES_URL, PLANS } from '@/config/plans';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { Link } from '@/i18n/navigation';
import { readAdsCampaigns, type AdsCampaign, type AdsCampaigns } from '@/lib/ads/api';
import type { AdsPeriod, AdsTab } from '@/lib/ads/tabs';
import { useBrandStore } from '@/stores/use-brand-store';

const COLUMNS = [
  'campaign',
  'channel',
  'status',
  'spend',
  'clicks',
  'cpc',
  'conversions',
  'costPerConversion',
] as const;
/** Columns that hold numbers, aligned to the end. */
const NUMERIC = new Set<string>(['spend', 'clicks', 'cpc', 'conversions', 'costPerConversion']);
const SAFETY = ['click', 'agents', 'cap', 'billing'] as const;

/**
 * "Your plan" (ADS-01 §3.4, §8): on Growth, read-only, with Compare plans
 * and Add Ads add-on; on Enterprise (and self-hosted), one line and no
 * upsell. Compare plans opens the plan dialog while the workspace is
 * read-only or on the demo brand, and otherwise Billing's plans, as Chat's
 * does: the dialog says the plan ended. The add-on has no price yet (owner,
 * 2026-11-11), so it opens the contact form Enterprise and add-ons are
 * asked for by (CONTACT_SALES_URL).
 */
function PlanStrip() {
  const t = useTranslations('ads.campaigns');
  const { planId, planName, isCloud } = useFeatureGate();
  const upgrade = useUpgradeDialog();
  const full = !isCloud || planId === 'enterprise';
  const outline = buttonVariants({ variant: 'outline', size: 'sm' });
  return (
    <div
      data-slot="ads-plan"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm"
    >
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('yourPlan')}
      </span>
      <b>{planName}</b>
      <span className="text-muted-foreground">
        {full ? t('full') : t('readOnly', { plan: PLANS.enterprise.name })}
      </span>
      {!full && (
        <span className="ms-auto flex gap-2">
          {upgrade?.isLocked ? (
            <Button
              variant="outline"
              size="sm"
              data-action="plan.compare"
              onClick={() => upgrade.openUpgrade()}
            >
              {t('compare')}
            </Button>
          ) : (
            <Link href={CHOOSE_PLAN_HREF} data-action="plan.compare" className={outline}>
              {t('compare')}
            </Link>
          )}
          <a
            href={CONTACT_SALES_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t('addonHint')}
            data-action="plan.addAdsAddon"
            className={buttonVariants({ size: 'sm' })}
          >
            {t('addon')}
            <ExternalLink aria-hidden />
          </a>
        </span>
      )}
    </div>
  );
}

/** The brand's campaigns over the period: undefined while read, null when the read failed. */
function useCampaigns(brandId: string | null, period: AdsPeriod) {
  const [read, setRead] = useState<{ key: string; data: AdsCampaigns | null }>();
  const key = `${brandId}|${period}`;
  useEffect(() => {
    if (!brandId) return;
    let live = true;
    const done = (data: AdsCampaigns | null) => live && setRead({ key, data });
    readAdsCampaigns(brandId, period).then(done, () => done(null));
    return () => {
      live = false;
    };
  }, [brandId, period, key]);
  return read?.key === key ? read.data : undefined;
}

/** One message across the table, with an optional action under it. */
function TableNote({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={COLUMNS.length} className="py-10 text-center whitespace-normal">
        <p className="font-medium">{title}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {children && <div className="mt-3">{children}</div>}
      </TableCell>
    </TableRow>
  );
}

/** A campaign's row: its numbers in its account's currency. */
function CampaignRow({ campaign, account }: { campaign: AdsCampaign; account: string | null }) {
  const t = useTranslations('ads.campaigns');
  const format = useFormatter();
  const money = (value: number | null) =>
    value === null
      ? '—'
      : campaign.currencyCode
        ? format.number(value, { style: 'currency', currency: campaign.currencyCode })
        : format.number(value, { maximumFractionDigits: 2 });
  return (
    <TableRow data-slot="ads-campaign">
      <TableCell className="max-w-64">
        <p className="truncate font-medium">{campaign.name ?? campaign.campaignId}</p>
        {account && <p className="truncate text-xs text-muted-foreground">{account}</p>}
      </TableCell>
      <TableCell>{t(`channels.${campaign.platform}`)}</TableCell>
      <TableCell>
        {campaign.status ? (
          <Badge variant={campaign.status === 'active' ? 'secondary' : 'outline'}>
            {t(`statuses.${campaign.status}`)}
          </Badge>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(campaign.spend)}</TableCell>
      <TableCell className="text-end tabular-nums">{format.number(campaign.clicks)}</TableCell>
      <TableCell className="text-end tabular-nums">{money(campaign.cpc)}</TableCell>
      <TableCell className="text-end tabular-nums">
        {format.number(campaign.conversions, { maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell className="text-end tabular-nums">{money(campaign.costPerConversion)}</TableCell>
    </TableRow>
  );
}

/**
 * Ads' Campaigns (ADS-01 §3.4, mockup `#cmp`; Phase 1, P1): the plan strip,
 * each campaign of the brand's connected ad accounts over the period, from
 * the daily sync, Google Ads and ChatGPT Ads in one table, and the Safety
 * rules as text. With no account connected, the table says how to connect
 * one. Read only: nothing here spends or changes an ad account.
 */
export function AdsCampaigns({
  period,
  onOpenTab,
}: {
  period: AdsPeriod;
  onOpenTab: (tab: AdsTab) => void;
}) {
  const t = useTranslations('ads.campaigns');
  const brandId = useBrandStore((s) => s.activeBrandId);
  const read = useCampaigns(brandId, period);
  const accountName = new Map(
    (read?.accounts ?? []).map((a) => [a.id, a.name ?? a.externalId] as const),
  );
  const attention = (read?.accounts ?? []).filter((a) => a.status !== 'active').length;
  const connections = (
    <Button
      variant="outline"
      size="sm"
      data-action="cmp.connections"
      onClick={() => onOpenTab('con')}
    >
      {t('openConnections')}
    </Button>
  );

  let body: ReactNode;
  if (read === undefined) {
    body = (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={COLUMNS.length}>
          <Skeleton className="h-24 w-full" />
        </TableCell>
      </TableRow>
    );
  } else if (read === null) {
    body = <TableNote title={t('failed')} />;
  } else if (!read.accounts.length) {
    body = (
      <TableNote title={t('empty')} note={t('emptyNote')}>
        {connections}
      </TableNote>
    );
  } else if (!read.campaigns.length) {
    const neverRead = read.accounts.every((a) => !a.lastSyncedAt);
    body = <TableNote title={neverRead ? t('firstRead') : t('noneInPeriod')} />;
  } else {
    body = read.campaigns.map((campaign) => (
      <CampaignRow
        key={`${campaign.accountId}|${campaign.campaignId}`}
        campaign={campaign}
        account={accountName.get(campaign.accountId) ?? null}
      />
    ));
  }

  return (
    <div data-slot="ads-campaigns" className="space-y-3">
      <PlanStrip />
      {attention > 0 && (
        <div
          data-slot="ads-campaigns-attention"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          <span>{t('attention', { count: attention })}</span>
          <span className="ms-auto">{connections}</span>
        </div>
      )}
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHead key={column} className={NUMERIC.has(column) ? 'text-end' : undefined}>
                  {t(`columns.${column}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>{body}</TableBody>
        </Table>
      </div>
      {!!read?.campaigns.length && (
        <p className="text-xs text-muted-foreground">{t('currencyNote')}</p>
      )}
      <Card size="sm" data-slot="ads-safety">
        <CardHeader>
          <CardTitle>{t('safety.title')}</CardTitle>
          <CardDescription>{t('safety.note')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {SAFETY.map((rule) => (
              <li key={rule}>{t(`safety.${rule}`)}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
