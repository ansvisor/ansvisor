'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { CHOOSE_PLAN_HREF, useUpgradeDialog } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

const COLUMNS = ['campaign', 'channel', 'status', 'spend', 'signups', 'cost'] as const;
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

/**
 * Ads' Campaigns (ADS-01 §3.4, mockup `#cmp`) before any ad account can be
 * connected: the plan strip, the table's columns with no rows, and the
 * Safety rules as text. Nothing here spends or reaches an ad account.
 */
export function AdsCampaigns() {
  const t = useTranslations('ads.campaigns');
  return (
    <div data-slot="ads-campaigns" className="space-y-3">
      <PlanStrip />
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHead key={column}>{t(`columns.${column}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={COLUMNS.length} className="py-10 text-center">
                <p className="font-medium">{t('empty')}</p>
                <p className="text-xs text-muted-foreground">{t('emptyNote')}</p>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
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
