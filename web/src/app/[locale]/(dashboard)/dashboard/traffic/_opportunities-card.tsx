'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import {
  getPageOpportunities,
  type PageOpportunities,
  type PageOpportunity,
  type TrafficDateWindow,
} from '@/lib/actions/traffic';
import type { SourceState } from '@/lib/actions/integrations';
import { TRAFFIC_SECTION_SOURCES, googleSourceStatus } from '@/lib/traffic-sources';
import { NeedsTag, SourceNoData, SourceUnavailable } from './_source-gate';

/**
 * Pages that carry weight and get nothing from AI engines (#719), for the
 * range the page shows (AT-002).
 *
 * The server ranks that range on request with the nightly engine's rules,
 * so no section of the page has its own hidden window, and a page the
 * tracking snippet saw AI visitors on is never listed here.
 *
 * It needs Google Analytics, and says so beside its title (AT-016). Until
 * Analytics has data it shows the source's state in place of the list — not
 * connected, syncing, or no property for this brand — and with no Analytics
 * data for the range it says that. With data but no finding it says so too,
 * so the card never vanishes or stands blank.
 */

const PROVIDER = TRAFFIC_SECTION_SOURCES.pageOpportunities;

/**
 * The ranking is described in the words of the metric that produced it
 * (`signals.*` in the messages). The engine ranks on whatever the property
 * reports — money where there is money, engagement where there is not — and
 * the copy keeps the page honest about which. Calling an engagement rank
 * "your most valuable page" would be a true sentence about the wrong thing.
 *
 * Why a page that earns gets nothing from AI engines is one of three states
 * (`citation.*`), because they need three different actions. A page cited a
 * hundred times that still earns no visit is a click-through problem; a page
 * nothing points at is a coverage gap; a page a prompt targets and no answer
 * cites is a visibility loss.
 */

/** The ranked page's figure on the signal that ranked it. */
function signalValue(row: PageOpportunity, inMinutes: (minutes: string) => string): string {
  if (row.valueSignal === 'revenue') return formatNumber(row.revenue);
  if (row.valueSignal === 'transactions') return formatNumber(row.transactions);
  if (row.valueSignal === 'key_events') return formatNumber(row.keyEvents);
  return inMinutes(formatNumber(Math.round(row.engagementSeconds / 60)));
}

/** The count a citation state's detail line names. */
function citationCount(row: PageOpportunity): number {
  if (row.citationState === 'cited') return row.citations;
  if (row.citationState === 'targeted_not_cited') return row.targetingPrompts;
  return 0;
}

export function PageOpportunitiesCard({
  brandId,
  dateWindow,
  rangeLabel,
  source,
  sourceUnknown = false,
  domain,
  canConnect,
  onConnected,
  onShowAllTime,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** The page's own words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  /** Google Analytics' state for the brand; null while it loads. */
  source: SourceState | null;
  /** The state couldn't be read: show what the range has, as before AT-016. */
  sourceUnknown?: boolean;
  /** The brand's primary domain, for the property line. */
  domain: string | undefined;
  canConnect: boolean;
  onConnected: () => void;
  /** Widens the page's range; absent when it is already all time. */
  onShowAllTime?: () => void;
}) {
  const t = useTranslations('traffic.pageOpportunities');
  const status = source ? googleSourceStatus(source) : sourceUnknown ? 'connected' : null;
  const connected = status === 'connected';
  const windowKey = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}`;
  // The loaded result carries the brand and range it belongs to, rather than
  // a separate loading flag reset inside the effect: resetting state
  // synchronously there costs a cascading render, and comparing the stored
  // key answers the same question — whose data is this — without one.
  const [loaded, setLoaded] = useState<{
    brandId: string;
    windowKey: string;
    /** The range the rows were ranked for, which a faded card still names. */
    rangeLabel: string;
    /** Null when the read failed. */
    result: PageOpportunities | null;
  } | null>(null);

  useEffect(() => {
    // Nothing to rank until Analytics has data for this brand.
    if (!connected) return;
    let cancelled = false;
    getPageOpportunities(brandId, dateWindow)
      .then((result) => {
        if (!cancelled) setLoaded({ brandId, windowKey, rangeLabel, result });
      })
      .catch((err) => {
        // Best effort: this card is an addition to the page, and a failure
        // here must not take the traffic analytics down with it.
        console.error('Failed to load page opportunities:', err);
        if (!cancelled) setLoaded({ brandId, windowKey, rangeLabel, result: null });
      });
    return () => {
      cancelled = true;
    };
  }, [connected, brandId, dateWindow, windowKey, rangeLabel]);

  // The state is still loading: a moment, not worth a placeholder. A failed
  // read hides the card rather than claim Analytics has no data.
  if (!status) return null;
  if (connected && loaded?.brandId === brandId && loaded.result === null) return null;

  // Another brand's findings must never render under this brand's name. A
  // new range keeps the previous one's card, faded, until it loads, as the
  // rest of the page does.
  const shown = connected && loaded?.brandId === brandId ? loaded : null;
  const stale = shown !== null && shown.windowKey !== windowKey;
  const rows = shown?.result?.rows ?? [];
  const signal = rows[0]?.valueSignal;

  return (
    <Card aria-busy={stale} className={cn('transition-opacity', stale && 'opacity-60')}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Target className="h-4 w-4 text-muted-foreground" />
            {t('title')}
            <NeedsTag provider={PROVIDER} />
          </CardTitle>
          {shown && (
            <Badge variant="outline" className="text-xs">
              {shown.rangeLabel}
            </Badge>
          )}
        </div>
        {shown?.result && shown.result.pages > 0 && (
          <p className="text-xs text-muted-foreground">
            {signal
              ? t.rich('explain', {
                  ranking: t(`signals.${signal}.explain`),
                  b: (chunks) => <span className="font-medium">{chunks}</span>,
                })
              : t('empty')}
          </p>
        )}
      </CardHeader>
      {!connected && source && (
        <CardContent className="p-0">
          <SourceUnavailable
            provider={PROVIDER}
            state={source}
            domain={domain}
            canConnect={canConnect}
            onConnected={onConnected}
          />
        </CardContent>
      )}
      {connected && !shown && (
        <CardContent className="pb-4">
          <Skeleton className="h-4 w-64" />
        </CardContent>
      )}
      {shown?.result?.pages === 0 && (
        <SourceNoData provider={PROVIDER} onShowAllTime={onShowAllTime} />
      )}
      {signal && (
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{t('page')}</TableHead>
                <TableHead>{t('aiVisibility')}</TableHead>
                <TableHead className="text-right">{t('sessions')}</TableHead>
                <TableHead className="text-right">{t(`signals.${signal}.column`)}</TableHead>
                <TableHead className="text-right pr-6">
                  {t('rank', { by: t(`signals.${signal}.by`) })}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.landingPage} className="hover:bg-muted/50">
                  <TableCell className="pl-6 max-w-[280px]">
                    <span className="font-mono text-xs text-muted-foreground line-clamp-1">
                      {row.landingPage}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <Badge
                        variant={row.citationState === 'cited' ? 'secondary' : 'outline'}
                        className="text-xs"
                      >
                        {t(`citation.${row.citationState}.label`)}
                      </Badge>
                      <div className="text-[10px] text-muted-foreground">
                        {t(`citation.${row.citationState}.detail`, { count: citationCount(row) })}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatNumber(row.sessions)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-sm">
                    {signalValue(row, (minutes) => t('minutes', { minutes }))}
                  </TableCell>
                  <TableCell className="text-right pr-6 tabular-nums text-sm text-muted-foreground">
                    #{row.valueRank}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
}
