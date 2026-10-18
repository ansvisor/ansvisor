'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileSearch, Loader2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { getPlatformName } from '@/lib/traffic-platforms';
import { citationState, pageStatuses } from '@/lib/traffic-pages';
import {
  getTrafficPages,
  type TrafficDateWindow,
  type TrafficPageRow,
  type TrafficPages,
  type TrafficPagesTab,
} from '@/lib/actions/traffic';
import { runAudit } from '@/lib/actions/audits';

/**
 * Pages: which answers send visitors (AT-006, spec §3.5, "the
 * differentiator"). The brand's pages in the page's range, with their AI
 * visits, how often tracked answers cite them and the prompts pointing to
 * them, in three work lists and the full list:
 *
 *   - No AI traffic: pages with traffic in Google Analytics or in the
 *     sitemap that got no AI visit, ranked by value, with why (replaces
 *     "Pages AI engines aren't sending traffic to", in the same window).
 *   - Cited, not clicked: answers cite them at least 20 times, nobody clicks.
 *   - Traffic, no prompt: AI visitors arrive from questions no tracked
 *     prompt's answer covers.
 *
 * A row's action is the next step for it: audit the page, or track prompts
 * that point to it. Sending pages to Action Center and suggested prompts
 * come with AT-006 part B.
 */

const TABS: TrafficPagesTab[] = ['noAiTraffic', 'citedNotClicked', 'trafficNoPrompt', 'all'];
const PAGE_SIZE = 10;

/** Which figure ranks No AI traffic, in the words of what the property reports. */
type ValueSignal = 'revenue' | 'transactions' | 'key_events' | 'engagement';

function valueSignal(rows: TrafficPageRow[]): ValueSignal {
  if (rows.some((r) => r.revenue > 0)) return 'revenue';
  if (rows.some((r) => r.transactions > 0)) return 'transactions';
  if (rows.some((r) => r.keyEvents > 0)) return 'key_events';
  return 'engagement';
}

function TabCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {formatNumber(count)}
    </span>
  );
}

function PageCell({ page }: { page: string }) {
  return (
    <TableCell className="pl-6 max-w-[180px] xl:max-w-[280px]">
      <span className="font-mono text-xs text-muted-foreground line-clamp-1" title={page}>
        {page}
      </span>
    </TableCell>
  );
}

const num = (n: number) => <span className="tabular-nums">{formatNumber(n)}</span>;

export function PagesCard({
  brandId,
  dateWindow,
  rangeLabel,
  domain,
  analyticsMissing,
  actions,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** The page's own words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  /** The brand's primary domain, for auditing a page. */
  domain: string | undefined;
  /** Google Analytics has no data for the brand: key events and No AI traffic are partial (§3.8b). */
  analyticsMissing: boolean;
  /** The section's Excel / CSV buttons (AT-015). */
  actions?: ReactNode;
}) {
  const t = useTranslations('traffic.pageList');
  const tReason = useTranslations('traffic.pageOpportunities');
  const router = useRouter();
  const [tab, setTab] = useState<TrafficPagesTab>('noAiTraffic');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [auditing, setAuditing] = useState<string | null>(null);

  const key = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}|${tab}|${limit}`;
  // The loaded result carries the request it answers, as the KPI cards do:
  // no loading flag reset inside the effect, and the last list stays on
  // screen, faded, while another loads.
  const [loaded, setLoaded] = useState<{
    key: string;
    tab: TrafficPagesTab;
    result: TrafficPages | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTrafficPages(brandId, dateWindow, { tab, limit })
      .then((result) => {
        if (!cancelled) setLoaded({ key, tab, result });
      })
      .catch((err) => {
        // Best effort: the rest of the page doesn't depend on this list.
        console.error('Failed to load the Pages section:', err);
        if (!cancelled) setLoaded({ key, tab, result: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, tab, limit, key]);

  const result = loaded?.result ?? null;
  const stale = loaded !== null && loaded.key !== key;
  // Another tab's rows don't fit this tab's columns: wait for its own.
  const loading = !loaded || loaded.tab !== tab;
  const rows = loading ? [] : (result?.rows ?? []);
  const total = result?.counts[tab] ?? 0;
  const signal = valueSignal(rows);

  const changeTab = (next: TrafficPagesTab) => {
    setTab(next);
    setLimit(PAGE_SIZE);
  };

  const auditPage = async (page: string) => {
    if (!domain) return;
    setAuditing(page);
    try {
      // A running audit opens on its own page, which follows it to the end.
      const started = await runAudit(brandId, `https://${domain}${page}`);
      router.push(`/dashboard/audit/${started.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('auditFailed'));
      setAuditing(null);
    }
  };

  const auditButton = (page: string) => (
    <Button
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      disabled={!domain || auditing !== null}
      onClick={() => void auditPage(page)}
    >
      {auditing === page && <Loader2 className="h-3 w-3 animate-spin" />}
      {t('auditPage')}
    </Button>
  );

  const addPromptsLink = (
    <Link
      href="/dashboard/prompts"
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
    >
      {t('addPrompts')}
    </Link>
  );

  /** A No AI traffic row's next step, by why AI engines skip it. */
  const reasonAction = (row: TrafficPageRow) =>
    citationState(row) === 'not_targeted' ? addPromptsLink : auditButton(row.page);

  const platforms = (row: TrafficPageRow) =>
    row.aiPlatforms.length ? row.aiPlatforms.map(getPlatformName).join(', ') : '—';

  return (
    <Card aria-busy={stale} className={cn('transition-opacity', stale && 'opacity-60')}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <FileSearch className="h-4 w-4 text-muted-foreground" />
            {t('title')}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {rangeLabel}
            </Badge>
            {actions}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        {analyticsMissing && <p className="text-xs text-muted-foreground">{t('needsAnalytics')}</p>}
      </CardHeader>
      <CardContent className="p-0">
        <Tabs value={tab} onValueChange={(v) => changeTab(v as TrafficPagesTab)}>
          <div className="px-6">
            <TabsList variant="line" aria-label={t('title')}>
              {TABS.map((id) => (
                <TabsTrigger key={id} value={id}>
                  {t(`tabs.${id}.label`)}
                  {result && <TabCount count={result.counts[id]} />}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <p className="px-6 pt-2 pb-1 text-xs text-muted-foreground">{t(`tabs.${tab}.explain`)}</p>

        {loading ? (
          <div className="px-6 py-4">
            <Skeleton className="h-4 w-64" />
          </div>
        ) : !result ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">{t('failed')}</p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">{t(`tabs.${tab}.empty`)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{t('columns.page')}</TableHead>
                {tab === 'noAiTraffic' && (
                  <>
                    <TableHead className="whitespace-normal">{t('columns.aiVisibility')}</TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.sessions')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {tReason(`signals.${signal}.column`)}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {tReason('rank', { by: tReason(`signals.${signal}.by`) })}
                    </TableHead>
                  </>
                )}
                {tab === 'citedNotClicked' && (
                  <>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.citations')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.prompts')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.sessions')}
                    </TableHead>
                  </>
                )}
                {tab === 'trafficNoPrompt' && (
                  <>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.aiVisits')}
                    </TableHead>
                    <TableHead className="whitespace-normal">{t('columns.platforms')}</TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.keyEvents')}
                    </TableHead>
                  </>
                )}
                {tab === 'all' && (
                  <>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.aiVisits')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.keyEvents')}
                    </TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.citations')}
                    </TableHead>
                    <TableHead className="whitespace-normal">{t('columns.platforms')}</TableHead>
                    <TableHead className="whitespace-normal text-right">
                      {t('columns.prompts')}
                    </TableHead>
                    <TableHead className="pr-6">{t('columns.status')}</TableHead>
                  </>
                )}
                {tab !== 'all' && <TableHead className="pr-6" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.page} className="hover:bg-muted/50">
                  <PageCell page={row.page} />
                  {tab === 'noAiTraffic' && (
                    <>
                      <TableCell>
                        <div className="space-y-0.5">
                          <Badge
                            variant={citationState(row) === 'cited' ? 'secondary' : 'outline'}
                            className="text-xs"
                          >
                            {tReason(`citation.${citationState(row)}.label`)}
                          </Badge>
                          <div className="text-[10px] text-muted-foreground">
                            {tReason(`citation.${citationState(row)}.detail`, {
                              count:
                                citationState(row) === 'cited'
                                  ? row.citations
                                  : row.targetingPrompts,
                            })}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.sessions)}</TableCell>
                      <TableCell className="text-right font-semibold text-sm">
                        {signal === 'revenue'
                          ? num(Math.round(row.revenue))
                          : signal === 'transactions'
                            ? num(row.transactions)
                            : signal === 'key_events'
                              ? num(row.keyEvents)
                              : tReason('minutes', {
                                  minutes: formatNumber(Math.round(row.engagementSeconds / 60)),
                                })}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                        {row.valueRank === null ? '—' : `#${row.valueRank}`}
                      </TableCell>
                      <TableCell className="pr-6 text-right">{reasonAction(row)}</TableCell>
                    </>
                  )}
                  {tab === 'citedNotClicked' && (
                    <>
                      <TableCell className="text-right font-semibold text-sm">
                        {num(row.citations)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {num(row.targetingPrompts)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.sessions)}</TableCell>
                      <TableCell className="pr-6 text-right">{auditButton(row.page)}</TableCell>
                    </>
                  )}
                  {tab === 'trafficNoPrompt' && (
                    <>
                      <TableCell className="text-right font-semibold text-sm">
                        {num(row.aiVisits)}
                      </TableCell>
                      <TableCell className="min-w-24 whitespace-normal text-sm text-muted-foreground">
                        {platforms(row)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.aiKeyEvents)}</TableCell>
                      <TableCell className="pr-6 text-right">{addPromptsLink}</TableCell>
                    </>
                  )}
                  {tab === 'all' && (
                    <>
                      <TableCell className="text-right font-semibold text-sm">
                        {num(row.aiVisits)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.aiKeyEvents)}</TableCell>
                      <TableCell className="text-right text-sm">{num(row.citations)}</TableCell>
                      <TableCell className="min-w-24 whitespace-normal text-sm text-muted-foreground">
                        {platforms(row)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {num(row.targetingPrompts)}
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex flex-wrap gap-1 text-sm text-muted-foreground">
                          {pageStatuses(row).map((status) => (
                            <Badge key={status} variant="outline" className="text-[10px]">
                              {t(`tabs.${status}.label`)}
                            </Badge>
                          ))}
                          {pageStatuses(row).length === 0 && '—'}
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!loading && result && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-xs text-muted-foreground">
            <span>
              {t('shown', { shown: rows.length, total })} · {t('sameWindow')}
            </span>
            {rows.length < total && (
              <button
                type="button"
                disabled={stale}
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
                className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
              >
                {t('showMore')}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
