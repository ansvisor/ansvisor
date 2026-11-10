'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Crown, Loader2, Plug, TrendingUp } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CHOOSE_PLAN_HREF } from '@/components/providers/upgrade-gate';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useUserRole } from '@/hooks/use-user-role';
import { formatNumber } from '@/lib/format';
import { formatRelative } from '@/lib/format-relative';
import { getPlatformName } from '@/lib/traffic-platforms';
import { getTrafficAiPipeline } from '@/lib/traffic-reads';
import type { TrafficAiPipeline, TrafficDateWindow } from '@/lib/actions/traffic';
import { cn } from '@/lib/utils';
import { useRangeReady } from './_range-ready';

/**
 * AI Traffic › AI-sourced pipeline (#2140, 00520): which HubSpot contacts,
 * deals and revenue came from AI answers, by AI engine and landing page,
 * from the brand's HubSpot account as the daily sync reads it. Growth and
 * above: below, a locked teaser. Until HubSpot is connected, with consent
 * to mark contacts, and read once, the section says what's missing.
 *
 * Ansvisor's own figures are the contacts it marked in HubSpot. HubSpot's
 * own "AI Referrals" contacts on the brand's domains are a line of their own
 * (owner, 2026-11-10). A deal counts once, in full, credited to its earliest
 * AI contact; won revenue by close date, open pipeline now, unweighted.
 */

/** Where the HubSpot card is, for a section that needs it. */
export const HUBSPOT_SETTINGS_PATH = '/dashboard/settings/integrations#hubspot';

/** An amount in the HubSpot account's currency, whole; without one, as a number. */
export function money(amount: number, currency: string | null): string {
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      // A currency code Intl doesn't know: the number alone.
    }
  }
  return formatNumber(Math.round(amount));
}

/** A landing page as the AI Traffic tables show one: its path. */
export function pathOf(page: string): string {
  try {
    return new URL(page).pathname;
  } catch {
    return page;
  }
}

/** The change against the period before, or null when there is none to show. */
export function changeOf(current: number, previous: number | null) {
  if (previous === null) return null;
  if (previous === 0) return current > 0 ? ({ kind: 'new' } as const) : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { kind: 'same' } as const;
  return { kind: pct > 0 ? 'up' : 'down', pct: Math.abs(pct) } as const;
}

function Change({ current, previous }: { current: number; previous: number | null }) {
  const t = useTranslations('traffic.aiPipeline.change');
  const change = changeOf(current, previous);
  if (!change) return null;
  return (
    <span
      className={cn(
        change.kind === 'up' && 'text-emerald-600 dark:text-emerald-400',
        change.kind === 'down' && 'text-red-600 dark:text-red-400',
      )}
    >
      {change.kind === 'up' || change.kind === 'down'
        ? t(change.kind, { pct: change.pct })
        : t(change.kind)}
    </span>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

/** What the section shows in place of its figures, with what to do. */
function State({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-[120px] flex-col items-start justify-center gap-1.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </div>
        <p className="max-w-[520px] text-xs text-muted-foreground">{body}</p>
        {action}
      </CardContent>
    </Card>
  );
}

const linkButton = (variant: 'default' | 'outline') =>
  cn(buttonVariants({ variant, size: 'sm' }), 'mt-1 h-7 text-xs');

export function AiPipelineSection({
  brandId,
  brandName,
  dateWindow,
  rangeLabel,
}: {
  brandId: string;
  brandName: string;
  dateWindow: TrafficDateWindow;
  /** The page's own words for the range, e.g. "last 7 days". */
  rangeLabel: string;
}) {
  const t = useTranslations('traffic.aiPipeline');
  const tCommon = useTranslations('common');
  const { canUse, requiredPlanFor } = useFeatureGate();
  const { canManage, canAdmin } = useUserRole();
  const allowed = canUse('crm_integrations');
  const key = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}`;
  // The result carries the range it answers, as the other sections' do.
  const [loaded, setLoaded] = useState<{
    key: string;
    result: TrafficAiPipeline | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    getTrafficAiPipeline(brandId, dateWindow)
      .then((result) => {
        if (!cancelled) setLoaded({ key, result, failed: false });
      })
      .catch((err) => {
        // Best effort: the rest of the page doesn't depend on this section.
        console.error('Failed to load the AI-sourced pipeline:', err);
        if (!cancelled) setLoaded({ key, result: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, key, allowed]);
  useRangeReady('aiPipeline', !allowed || loaded?.key === key);

  const current = loaded?.key === key ? loaded : null;
  const result = current?.result ?? null;

  let body: ReactNode;
  if (!allowed) {
    const plan = requiredPlanFor('crm_integrations');
    body = (
      <State
        icon={<Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
        title={t('states.lockedTitle', { plan })}
        body={t('states.lockedBody')}
        action={
          canAdmin ? (
            <Link href={CHOOSE_PLAN_HREF} className={linkButton('default')}>
              {t('states.upgrade')}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">{t('states.askAdmin')}</p>
          )
        }
      />
    );
  } else if (!current) {
    body = <Skeleton className="h-28 w-full" />;
  } else if (!result) {
    body = <p className="text-sm text-muted-foreground">{t('states.failed')}</p>;
  } else if (!result.connected) {
    body = (
      <State
        icon={<Plug className="h-4 w-4 text-muted-foreground" />}
        title={t('states.notConnectedTitle')}
        body={t('states.notConnectedBody', { brand: brandName })}
        action={
          canManage ? (
            <Link href={HUBSPOT_SETTINGS_PATH} className={linkButton('outline')}>
              {t('states.connect')}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">{t('states.notConnectedMember')}</p>
          )
        }
      />
    );
  } else if (!result.contactsConsent) {
    body = (
      <State
        icon={<Plug className="h-4 w-4 text-muted-foreground" />}
        title={t('states.noConsentTitle')}
        body={t('states.noConsentBody')}
        action={
          <Link href={HUBSPOT_SETTINGS_PATH} className={linkButton('outline')}>
            {t('states.openSettings')}
          </Link>
        }
      />
    );
  } else if (!result.syncedAt) {
    body = (
      <State
        icon={<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        title={t('states.firstSyncTitle')}
        body={t('states.firstSyncBody')}
      />
    );
  } else {
    body = <Figures result={result} />;
  }

  return (
    <section className="space-y-3" aria-labelledby="ai-pipeline-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="ai-pipeline-title" className="flex items-center gap-2 text-base font-semibold">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          {t('title')}
        </h2>
        <span className="whitespace-nowrap rounded-md border px-1.5 text-[11px] font-medium leading-4 text-muted-foreground">
          {t('needs')}
        </span>
        <span className="text-xs text-muted-foreground">{t('subtitle')}</span>
        <Badge variant="outline" className="ml-auto text-xs">
          {rangeLabel}
        </Badge>
      </div>
      {body}
      {result?.syncedAt && result.connected && result.contactsConsent && (
        <p className="text-xs text-muted-foreground">
          {result.syncError
            ? t('states.syncFailed')
            : t('synced', { when: formatRelative(result.syncedAt, tCommon) })}
        </p>
      )}
    </section>
  );
}

function Figures({ result }: { result: TrafficAiPipeline }) {
  const t = useTranslations('traffic.aiPipeline');
  const { totals, currency } = result;
  const native = result.hubspotNative;
  const num = (n: number) => <span className="tabular-nums">{formatNumber(n)}</span>;
  const nothing =
    totals.contacts === 0 &&
    totals.deals === 0 &&
    totals.wonDeals === 0 &&
    totals.openDeals === 0 &&
    native.contacts === 0 &&
    native.deals === 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label={t('kpis.contacts')}
          value={formatNumber(totals.contacts)}
          sub={<Change current={totals.contacts} previous={totals.contactsPrev} />}
        />
        <Kpi
          label={t('kpis.deals')}
          value={formatNumber(totals.deals)}
          sub={t('dealsSub', { won: totals.wonDeals, open: totals.openDeals })}
        />
        <Kpi
          label={t('kpis.openPipeline')}
          value={money(totals.openPipeline, currency)}
          sub={t('openSub', { count: totals.openDeals })}
        />
        <Kpi
          label={t('kpis.wonRevenue')}
          value={money(totals.wonRevenue, currency)}
          sub={
            <>
              <Change current={totals.wonRevenue} previous={totals.wonRevenuePrev} />{' '}
              {t('wonSub', { count: totals.wonDeals })}
            </>
          }
        />
      </div>

      {native.contacts > 0 && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t('native', {
            contacts: native.contacts,
            deals: native.deals,
            revenue: money(native.wonRevenue, currency),
          })}
        </p>
      )}

      {nothing ? (
        <p className="text-sm text-muted-foreground">{t('states.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('byEngine')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {result.byEngine.length === 0 ? (
                <p className="px-6 pb-4 text-sm text-muted-foreground">{t('emptyTable')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">{t('columns.engine')}</TableHead>
                      <TableHead className="text-right">{t('columns.contacts')}</TableHead>
                      <TableHead className="text-right">{t('columns.deals')}</TableHead>
                      <TableHead className="text-right">{t('columns.wonRevenue')}</TableHead>
                      <TableHead className="pr-6 text-right">{t('columns.openPipeline')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.byEngine.map((row) => (
                      <TableRow key={row.source} className="hover:bg-muted/50">
                        <TableCell className="pl-6 text-sm font-medium">
                          {getPlatformName(row.source)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">
                          {num(row.contacts)}
                        </TableCell>
                        <TableCell className="text-right text-sm">{num(row.deals)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {row.wonRevenue ? money(row.wonRevenue, currency) : '—'}
                        </TableCell>
                        <TableCell className="pr-6 text-right text-sm tabular-nums">
                          {row.openPipeline ? money(row.openPipeline, currency) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{t('byPage')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {result.byPage.length === 0 ? (
                <p className="px-6 pb-4 text-sm text-muted-foreground">{t('emptyTable')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">{t('columns.page')}</TableHead>
                      <TableHead className="text-right">{t('columns.contacts')}</TableHead>
                      <TableHead className="text-right">{t('columns.deals')}</TableHead>
                      <TableHead className="text-right">{t('columns.wonRevenue')}</TableHead>
                      <TableHead className="pr-6">{t('columns.topEngine')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.byPage.map((row) => (
                      <TableRow key={row.page} className="hover:bg-muted/50">
                        <TableCell className="max-w-[260px] pl-6">
                          <span
                            className="line-clamp-1 font-mono text-xs text-muted-foreground"
                            title={row.page}
                          >
                            {pathOf(row.page)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold">
                          {num(row.contacts)}
                        </TableCell>
                        <TableCell className="text-right text-sm">{num(row.deals)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {row.wonRevenue ? money(row.wonRevenue, currency) : '—'}
                        </TableCell>
                        <TableCell className="pr-6 text-sm">
                          {row.topSource ? getPlatformName(row.topSource) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('legend')}</p>
    </div>
  );
}
