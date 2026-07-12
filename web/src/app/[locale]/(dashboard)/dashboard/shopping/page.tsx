'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
const DynamicPlatformCardRateChart = dynamic(
  () => import('./shopping_charts').then((m) => m.PlatformCardRateChartView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full" />,
  },
);

const DynamicShoppingTrendChart = dynamic(
  () => import('./shopping_charts').then((m) => m.ShoppingTrendChartView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full" />,
  },
);
import {
  ShoppingBag,
  Store,
  ArrowUpRight,
  Crown,
  Lock,
  Download,
  ExternalLink,
  Layers,
  Target,
  Search,
  Calendar,
  Globe,
} from 'lucide-react';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import {
  getShoppingChartData,
  getShoppingFilterOptions,
  getShoppingKpis,
  getOwnProducts,
  getCompetitorProducts,
  getCompetitorSummary,
  getCardEligiblePrompts,
  type ShoppingChartData,
  type ShoppingDatePreset,
  type ShoppingFilters,
  type ShoppingKpis,
  type ShoppingProduct,
  type CompetitorShoppingSummary,
  type CardEligiblePromptRow,
  type CardEligiblePromptsResponse,
} from '@/lib/actions/shopping';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { CodeBlock, CodeBlockCode } from '@/components/ui/code-block';
import {
  AIProviderAvatar,
  resolveAIProvider,
  getAIProviderDisplayName,
} from '@/components/ai-provider-avatar';
import { toCsv } from '@/lib/csv';
import { PLATFORM_LABELS } from '@/config/platform-labels';
import { formatRegionDisplay } from '@/lib/region';

const DATE_PRESETS: ShoppingDatePreset[] = ['7d', '30d', '90d', 'all'];

// Theme tokens in globals.css ship as full oklch values; reference them
// directly with var(--…). Wrapping in hsl() yields invalid CSS, so chart
// text turns black on dark mode (lesson learned from #138).

function getDomainName(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}
export default function ShoppingPage() {
  const t = useTranslations('shopping');
  const { activeBrandId } = useBrandStore();
  const { canUse, requiredPlanFor } = useFeatureGate();
  const hasFullAccess = canUse('shopping_analytics');

  const [datePreset, setDatePreset] = useState<ShoppingDatePreset>('30d');
  const [platform, setPlatform] = useState<string>('all');
  const [region, setRegion] = useState<string>('all');

  const [filterOpts, setFilterOpts] = useState<{ platforms: string[]; regions: string[] }>({
    platforms: [],
    regions: [],
  });
  const [kpis, setKpis] = useState<ShoppingKpis | null>(null);
  const [charts, setCharts] = useState<ShoppingChartData | null>(null);
  const [loading, setLoading] = useState(false);

  const [ownProducts, setOwnProducts] = useState<ShoppingProduct[]>([]);
  const [competitorProducts, setCompetitorProducts] = useState<ShoppingProduct[]>([]);
  const [competitorSummary, setCompetitorSummary] = useState<CompetitorShoppingSummary[]>([]);
  const [promptsData, setPromptsData] = useState<CardEligiblePromptsResponse | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ShoppingProduct | null>(null);
  const [activeTab, setActiveTab] = useState<string>('overview');

  const filters = useMemo<ShoppingFilters>(
    () => ({
      datePreset,
      platforms: platform === 'all' ? undefined : [platform],
      regions: region === 'all' ? undefined : [region],
    }),
    [datePreset, platform, region],
  );

  // Load filter options once per brand so the dropdowns only show
  // platform / region values that actually appear in this brand's data.
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    (async () => {
      try {
        const opts = await getShoppingFilterOptions(activeBrandId);
        if (!cancelled) setFilterOpts(opts);
      } catch {
        if (!cancelled) setFilterOpts({ platforms: [], regions: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  // De-dupe overlapping fetches when filters change in quick succession.
  const reqIdRef = useRef(0);
  const loadData = useCallback(async () => {
    if (!activeBrandId) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    if (hasFullAccess) {
      setTableLoading(true);
    }
    try {
      const promises: [Promise<ShoppingKpis>, Promise<ShoppingChartData>, ...Promise<unknown>[]] = [
        getShoppingKpis(activeBrandId, filters),
        getShoppingChartData(activeBrandId, filters),
      ];

      if (hasFullAccess) {
        promises.push(
          getOwnProducts(activeBrandId, filters),
          getCompetitorProducts(activeBrandId, filters),
          getCompetitorSummary(activeBrandId, filters),
          getCardEligiblePrompts(activeBrandId, filters),
        );
      }

      const results = await Promise.all(promises);

      if (reqId === reqIdRef.current) {
        setKpis(results[0]);
        setCharts(results[1]);
        if (hasFullAccess && results.length >= 6) {
          setOwnProducts(results[2] as ShoppingProduct[]);
          setCompetitorProducts(results[3] as ShoppingProduct[]);
          setCompetitorSummary(results[4] as CompetitorShoppingSummary[]);
          setPromptsData(results[5] as CardEligiblePromptsResponse);
        }
      }
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setTableLoading(false);
      }
    }
  }, [activeBrandId, filters, hasFullAccess]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (!activeBrandId) {
    return (
      <div className="space-y-6">
        <PageHeader t={t} />
        <EmptyState title={t('noBrandTitle')} description={t('noBrandDescription')} />
      </div>
    );
  }

  const totalCards =
    (charts?.ownPresenceTrend ?? []).reduce((sum, p) => sum + p.totalCards, 0) +
    // platformCardRate's data has card-rate built in, so the trend total is
    // sufficient as a "do we have any data at all?" check.
    0;
  const isEmpty = !loading && (kpis?.shoppingCardRateSampleSize ?? 0) === 0 && totalCards === 0;

  return (
    <div className="space-y-6">
      <PageHeader t={t} />

      <FilterBar
        t={t}
        datePreset={datePreset}
        setDatePreset={setDatePreset}
        platform={platform}
        setPlatform={setPlatform}
        region={region}
        setRegion={setRegion}
        platformOpts={filterOpts.platforms}
        regionOpts={filterOpts.regions}
      />

      {isEmpty ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          <KpiGrid
            t={t}
            kpis={kpis}
            loading={loading}
            hasFullAccess={hasFullAccess}
            triggerRate={promptsData?.triggerRate}
          />
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList>
              <TabsTrigger value="overview">{t('tabOverview')}</TabsTrigger>
              <TabsTrigger value="prompts">{t('tabPrompts')}</TabsTrigger>
              <TabsTrigger value="own_products">{t('tabMyProducts')}</TabsTrigger>
              <TabsTrigger value="competitors">{t('tabCompetitors')}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              {hasFullAccess ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <PlatformCardRateChart
                    t={t}
                    data={charts?.platformCardRate ?? []}
                    loading={loading}
                  />
                  <OwnPresenceTrendChart
                    t={t}
                    data={charts?.ownPresenceTrend ?? []}
                    loading={loading}
                  />
                </div>
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>

            <TabsContent value="prompts" className="space-y-6">
              {hasFullAccess ? (
                <PromptsTabContent
                  t={t}
                  brandId={activeBrandId}
                  promptsData={promptsData}
                  loading={tableLoading}
                />
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>

            <TabsContent value="own_products" className="space-y-6">
              {hasFullAccess ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{t('tabMyProducts')}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const headers = [
                          'product_title',
                          'product_brand',
                          'impressions',
                          'platforms',
                          'regions',
                          'last_price',
                          'price_currency',
                          'top_merchant',
                          'last_seen',
                        ];
                        const rows = ownProducts.map((p) => ({
                          product_title: p.product_title,
                          product_brand: p.product_brand || '',
                          impressions: p.impressions,
                          platforms: p.platforms.join('; '),
                          regions: p.regions.join('; '),
                          last_price: p.last_price !== null ? p.last_price : '',
                          price_currency: p.price_currency || '',
                          top_merchant: p.top_merchant || '',
                          last_seen: p.last_seen,
                        }));
                        const csv = toCsv(rows, headers);
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        const date = new Date().toISOString().slice(0, 10);
                        link.download = `my_products_${date}.csv`;
                        link.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {t('exportCsv')}
                    </Button>
                  </div>
                  <ProductTable
                    t={t}
                    products={ownProducts}
                    loading={tableLoading}
                    onRowClick={setSelectedProduct}
                  />
                </>
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>

            <TabsContent value="competitors" className="space-y-6">
              {hasFullAccess ? (
                <>
                  <CompetitorSummaryList
                    t={t}
                    summaries={competitorSummary}
                    loading={tableLoading}
                  />

                  <div className="flex items-center justify-between pt-4">
                    <h2 className="text-lg font-semibold">{t('tabCompetitors')}</h2>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const headers = [
                          'competitor_name',
                          'product_title',
                          'product_brand',
                          'impressions',
                          'platforms',
                          'regions',
                          'last_price',
                          'price_currency',
                          'top_merchant',
                          'last_seen',
                        ];
                        const rows = competitorProducts.map((p) => ({
                          competitor_name: p.competitor_name || '',
                          product_title: p.product_title,
                          product_brand: p.product_brand || '',
                          impressions: p.impressions,
                          platforms: p.platforms.join('; '),
                          regions: p.regions.join('; '),
                          last_price: p.last_price !== null ? p.last_price : '',
                          price_currency: p.price_currency || '',
                          top_merchant: p.top_merchant || '',
                          last_seen: p.last_seen,
                        }));
                        const csv = toCsv(rows, headers);
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        const date = new Date().toISOString().slice(0, 10);
                        link.download = `competitor_products_${date}.csv`;
                        link.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {t('exportCsv')}
                    </Button>
                  </div>
                  <ProductTable
                    t={t}
                    products={competitorProducts}
                    loading={tableLoading}
                    onRowClick={setSelectedProduct}
                    showCompetitorName
                  />
                </>
              ) : (
                <UpgradeCard t={t} requiredPlan={requiredPlanFor('shopping_analytics')} />
              )}
            </TabsContent>
          </Tabs>

          {hasFullAccess && (
            <ProductAppearancesDrawer
              t={t}
              product={selectedProduct}
              onOpenChange={(open) => {
                if (!open) setSelectedProduct(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function PromptsTabContent({
  t,
  brandId,
  promptsData,
  loading,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  brandId: string;
  promptsData: CardEligiblePromptsResponse | null;
  loading: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState<CardEligiblePromptRow | null>(null);

  const brand = useBrandStore((s) => s.brands.find((b) => b.id === brandId) ?? null);
  const brandSlug = brand?.slug || brandId;

  const filteredPrompts = useMemo(() => {
    if (!promptsData?.prompts) return [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return promptsData.prompts;
    return promptsData.prompts.filter(
      (p) => p.promptText.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q),
    );
  }, [promptsData, searchQuery]);

  const handleExportCsv = useCallback(() => {
    if (!promptsData?.prompts.length) return;
    const exportRows = promptsData.prompts.map((p) => ({
      prompt: p.promptText,
      topic: p.topic,
      platforms: p.platforms.join('; '),
      total_cards: p.totalCards,
      own_cards: p.ownCardsCount,
      competitor_cards: p.competitorCardsCount,
      other_cards: p.otherCardsCount,
      last_seen: p.lastTriggered ? p.lastTriggered.slice(0, 10) : '—',
    }));
    const headers = [
      'prompt',
      'topic',
      'platforms',
      'total_cards',
      'own_cards',
      'competitor_cards',
      'other_cards',
      'last_seen',
    ];
    const csv = toCsv(exportRows, headers);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const date = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `ansvisor_${brandSlug}_shopping_prompts_${date}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [promptsData, brandSlug]);

  if (loading && !promptsData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('searchPrompts')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={!promptsData?.prompts.length}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          {t('exportCsv')}
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('tablePrompt')}</TableHead>
              <TableHead>{t('tableTopic')}</TableHead>
              <TableHead>{t('tablePlatforms')}</TableHead>
              <TableHead className="text-right">{t('tableTotalCards')}</TableHead>
              <TableHead className="w-[120px]">{t('tableSplitBar')}</TableHead>
              <TableHead className="text-right">{t('tableLastSeen')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            ) : filteredPrompts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <ShoppingBag className="h-8 w-8 opacity-40 mb-2" />
                    <p className="font-medium text-sm">{t('noPromptsFound')}</p>
                    <p className="text-xs mt-1">{t('noPromptsFoundSub')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredPrompts.map((row) => {
                const ownPct = row.totalCards > 0 ? (row.ownCardsCount / row.totalCards) * 100 : 0;
                const compPct =
                  row.totalCards > 0 ? (row.competitorCardsCount / row.totalCards) * 100 : 0;
                const otherPct =
                  row.totalCards > 0 ? (row.otherCardsCount / row.totalCards) * 100 : 0;

                return (
                  <TableRow
                    key={row.promptId}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => setSelectedPrompt(row)}
                  >
                    <TableCell className="max-w-[320px]">
                      <Link
                        href={`/dashboard/prompts/${row.promptId}`}
                        className="font-medium text-primary hover:underline block truncate"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.promptText}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-normal">
                        {row.topic}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {row.platforms.map((p) => (
                          <AIProviderAvatar
                            key={p}
                            provider={resolveAIProvider(p)}
                            className="h-5 w-5 border"
                          />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {row.totalCards.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex h-2 w-24 overflow-hidden rounded-full bg-muted-foreground/10"
                        title={`Own: ${row.ownCardsCount}, Competitors: ${row.competitorCardsCount}, Other: ${row.otherCardsCount}`}
                      >
                        {ownPct > 0 && (
                          <div className="h-full bg-primary" style={{ width: `${ownPct}%` }} />
                        )}
                        {compPct > 0 && (
                          <div className="h-full bg-orange-500" style={{ width: `${compPct}%` }} />
                        )}
                        {otherPct > 0 && (
                          <div
                            className="h-full bg-muted-foreground/40"
                            style={{ width: `${otherPct}%` }}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {row.lastTriggered ? row.lastTriggered.slice(0, 10) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selectedPrompt} onOpenChange={(open) => !open && setSelectedPrompt(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto px-4">
          <SheetHeader className="pb-4 border-b">
            <SheetTitle>{t('drawerTitle')}</SheetTitle>
            <SheetDescription>{t('drawerSubtitle')}</SheetDescription>
          </SheetHeader>
          {selectedPrompt && (
            <div className="space-y-6 py-4">
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {t('tablePrompt')}
                </h4>
                <p className="text-sm font-medium text-foreground bg-muted/30 rounded-lg p-3 border">
                  {selectedPrompt.promptText}
                </p>
              </div>

              <div className="space-y-4">
                {selectedPrompt.appearances.map((app) => (
                  <div key={app.promptResultId} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between border-b pb-2 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <AIProviderAvatar
                          provider={resolveAIProvider(app.platform)}
                          className="h-4.5 w-4.5"
                        />
                        <span>{getAIProviderDisplayName(resolveAIProvider(app.platform))}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        {app.region && (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {app.region}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(app.timestamp).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {t('drawerCardsTitle')} ({app.cards.length})
                      </h5>
                      <div className="grid gap-2">
                        {app.cards.map((card) => (
                          <div
                            key={card.id}
                            className="flex gap-3 rounded-md border bg-muted/10 p-2 text-xs"
                          >
                            {card.imageUrl ? (
                              <img
                                src={card.imageUrl}
                                alt=""
                                className="h-12 w-12 rounded border object-contain bg-white shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : null}
                            <div className="flex flex-1 flex-col justify-between min-w-0">
                              <span className="font-medium text-foreground line-clamp-1">
                                {card.title}
                              </span>
                              <div className="flex items-center justify-between mt-1 text-muted-foreground">
                                <span className="font-semibold text-foreground">{card.price}</span>
                                {card.merchantUrl && (
                                  <a
                                    href={card.merchantUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-0.5 hover:text-primary transition-colors"
                                  >
                                    <span>{getDomainName(card.merchantUrl)}</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

function PageHeader({ t }: { t: ReturnType<typeof useTranslations<'shopping'>> }) {
  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
        <ShoppingBag className="h-6 w-6 text-primary" />
        {t('title')}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  t,
  datePreset,
  setDatePreset,
  platform,
  setPlatform,
  region,
  setRegion,
  platformOpts,
  regionOpts,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  datePreset: ShoppingDatePreset;
  setDatePreset: (v: ShoppingDatePreset) => void;
  platform: string;
  setPlatform: (v: string) => void;
  region: string;
  setRegion: (v: string) => void;
  platformOpts: string[];
  regionOpts: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
      <FilterField label={t('filterDateRange')}>
        <Select value={datePreset} onValueChange={(v) => setDatePreset(v as ShoppingDatePreset)}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue>{(value) => (value === 'all' ? 'All time' : `Last ${value}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map((p) => (
              <SelectItem key={p} value={p}>
                {p === 'all' ? 'All time' : `Last ${p}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label={t('filterPlatform')}>
        <Select value={platform} onValueChange={(v) => setPlatform(v ?? 'all')}>
          <SelectTrigger className="h-8 w-40">
            <SelectValue>
              {(value) =>
                value === 'all' || !value
                  ? 'All platforms'
                  : (PLATFORM_LABELS[String(value)] ?? String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platformOpts.map((p) => (
              <SelectItem key={p} value={p}>
                {PLATFORM_LABELS[p] ?? p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label={t('filterRegion')}>
        <Select value={region} onValueChange={(v) => setRegion(v ?? 'all')}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue>
              {(value) =>
                value === 'all' || !value ? 'All regions' : formatRegionDisplay(String(value))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regionOpts.map((r) => (
              <SelectItem key={r} value={r}>
                {formatRegionDisplay(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// ── KPI grid ──────────────────────────────────────────────────────────────────

function KpiGrid({
  t,
  kpis,
  loading,
  hasFullAccess,
  triggerRate,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  kpis: ShoppingKpis | null;
  loading: boolean;
  hasFullAccess: boolean;
  triggerRate?: number;
}) {
  if (loading && !kpis) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
    );
  }

  const cardRate = kpis?.shoppingCardRate ?? 0;
  const productsSurfaced = kpis?.productsSurfaced ?? 0;
  const sov = kpis?.shoppingSov ?? 0;
  const merchant = kpis?.topMerchant;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard
        title={t('kpiCardRate')}
        value={formatPercent(cardRate)}
        subtitle={t('kpiCardRateSub')}
        icon={ShoppingBag}
      />
      <KpiCard
        title={t('kpiTriggerRate')}
        value={triggerRate !== undefined ? formatPercent(triggerRate) : '—'}
        subtitle={t('kpiTriggerRateSub')}
        icon={Target}
        locked={!hasFullAccess}
      />
      <KpiCard
        title={t('kpiOwnProducts')}
        value={productsSurfaced.toLocaleString()}
        subtitle={t('kpiOwnProductsSub')}
        icon={ArrowUpRight}
        locked={!hasFullAccess}
      />
      <KpiCard
        title={t('kpiSov')}
        value={formatPercent(sov)}
        subtitle={t('kpiSovSub')}
        icon={Crown}
        locked={!hasFullAccess}
      />
      <KpiCard
        title={t('kpiTopMerchant')}
        value={merchant?.domain ?? '—'}
        subtitle={
          merchant
            ? `${merchant.cardCount} card${merchant.cardCount === 1 ? '' : 's'}`
            : t('kpiTopMerchantSub')
        }
        icon={Store}
        locked={!hasFullAccess}
      />
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  locked = false,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  locked?: boolean;
}) {
  return (
    <Card className={locked ? 'opacity-70' : ''}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          {locked ? (
            <Lock className="h-4 w-4 text-muted-foreground/60" />
          ) : (
            <Icon className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <p className="truncate text-2xl font-bold">{locked ? '—' : value}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

function PlatformCardRateChart({
  t,
  data,
  loading,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  data: Array<{ platform: string; cardRate: number; totalResults: number }>;
  loading: boolean;
}) {
  const chartData = data.map((d) => ({ platform: d.platform, rate: Math.round(d.cardRate * 100) }));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('platformBreakdownTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : (
          <ResponsiveBarChart data={chartData} />
        )}
      </CardContent>
    </Card>
  );
}

function ResponsiveBarChart({ data }: { data: Array<{ platform: string; rate: number }> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: '100%', height: 220 }}>
      {width > 0 && <DynamicPlatformCardRateChart width={width} data={data} />}
    </div>
  );
}

function OwnPresenceTrendChart({
  t,
  data,
  loading,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  data: Array<{ date: string; ownCards: number; totalCards: number }>;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('trendTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-[220px] w-full" /> : <ResponsiveLineChart data={data} />}
      </CardContent>
    </Card>
  );
}

function ResponsiveLineChart({
  data,
}: {
  data: Array<{ date: string; ownCards: number; totalCards: number }>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: '100%', height: 220 }}>
      {width > 0 && <DynamicShoppingTrendChart width={width} data={data} />}
    </div>
  );
}

// ── States ────────────────────────────────────────────────────────────────────

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed py-12 text-center">
      <ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground/40" />
      <h3 className="mt-3 text-sm font-medium">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function UpgradeCard({
  t,
  requiredPlan,
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  requiredPlan: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Crown className="mt-1 h-5 w-5 text-amber-500" />
          <div>
            <p className="font-medium">{t('lockedTitle')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('lockedDescription')}</p>
          </div>
        </div>
        <Link
          href="/dashboard/settings?tab=billing"
          className={buttonVariants({ variant: 'default' })}
        >
          <Badge variant="secondary" className="mr-2 gap-1">
            <Crown className="h-3 w-3" />
            {requiredPlan}
          </Badge>
          Upgrade
        </Link>
      </CardContent>
    </Card>
  );
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0%';
  if (value < 0.01) return '<1%';
  return `${Math.round(value * 100)}%`;
}

// ── Product table component ────────────────────────────────────────────────────

interface ProductTableProps {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  products: ShoppingProduct[];
  loading: boolean;
  onRowClick: (p: ShoppingProduct) => void;
  showCompetitorName?: boolean;
}

function ProductTable({
  t,
  products,
  loading,
  onRowClick,
  showCompetitorName = false,
}: ProductTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed py-8 text-center bg-card">
        <Layers className="mx-auto h-8 w-8 text-muted-foreground/30" />
        <p className="mt-2 text-sm text-muted-foreground">No products found matching filters.</p>
      </div>
    );
  }

  // Ensure default sorting: impressions descending
  const sortedProducts = [...products].sort((a, b) => b.impressions - a.impressions);

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]"></TableHead>
            <TableHead>{t('colProductTitle')}</TableHead>
            {showCompetitorName && <TableHead>{t('competitorName')}</TableHead>}
            <TableHead>{t('colPlatforms')}</TableHead>
            <TableHead>{t('colRegions')}</TableHead>
            <TableHead className="text-right">{t('colImpressions')}</TableHead>
            <TableHead className="text-right">{t('colLastPrice')}</TableHead>
            <TableHead>{t('colTopMerchant')}</TableHead>
            <TableHead className="text-right">{t('colLastSeen')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedProducts.map((p, idx) => {
            const lastPriceStr =
              p.last_price !== null ? `${p.last_price} ${p.price_currency || ''}` : '—';
            const formattedDate = p.last_seen
              ? new Date(p.last_seen).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
              : '—';

            return (
              <TableRow
                key={idx}
                className="cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => onRowClick(p)}
              >
                <TableCell>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted overflow-hidden">
                    {p.image_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={p.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <ShoppingBag className="h-5 w-5 text-muted-foreground/40" />
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-medium max-w-[240px] truncate">
                  <div>
                    <span className="block truncate text-sm" title={p.product_title}>
                      {p.product_title}
                    </span>
                    {p.product_brand && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.product_brand}
                      </span>
                    )}
                  </div>
                </TableCell>
                {showCompetitorName && (
                  <TableCell className="max-w-[120px] truncate">
                    <span className="font-medium text-xs">{p.competitor_name || '—'}</span>
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-1">
                    {p.platforms.map((plat) => (
                      <AIProviderAvatar
                        key={plat}
                        provider={resolveAIProvider(plat)}
                        className="h-5 w-5 border"
                      />
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[120px]">
                    {p.regions.map((reg) => (
                      <Badge key={reg} variant="outline" className="text-[10px] py-0 px-1.5">
                        {reg}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {p.impressions.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {lastPriceStr}
                </TableCell>
                <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                  {p.top_merchant || '—'}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                  {formattedDate}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Competitor summary list component ──────────────────────────────────────────

interface CompetitorSummaryListProps {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  summaries: CompetitorShoppingSummary[];
  loading: boolean;
}

function CompetitorSummaryList({ t, summaries, loading }: CompetitorSummaryListProps) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (summaries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
        {t('compSummaryTitle')}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaries.map((s) => (
          <Card key={s.competitor_id} className="relative overflow-hidden bg-card">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between min-w-0">
                <span className="font-semibold text-sm truncate block" title={s.name}>
                  {s.name}
                </span>
                <span className="text-[10px] text-muted-foreground truncate ml-1 max-w-[100px]">
                  {s.domain}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground text-[10px] block">
                    {t('compDistinctProducts')}
                  </span>
                  <span className="font-bold text-sm tabular-nums">
                    {s.distinct_products_count}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-muted-foreground text-[10px] block">{t('compSov')}</span>
                  <span className="font-bold text-sm tabular-nums">{formatPercent(s.sov)}</span>
                </div>
              </div>
              {/* Shopping SOV progress bar */}
              <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-400 transition-all rounded-full"
                  style={{ width: `${Math.round(s.sov * 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Product appearances side drawer ─────────────────────────────────────────────

interface ProductAppearancesDrawerProps {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  product: ShoppingProduct | null;
  onOpenChange: (open: boolean) => void;
}

function ProductAppearancesDrawer({ t, product, onOpenChange }: ProductAppearancesDrawerProps) {
  const isOpen = product !== null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0 h-full">
        <SheetHeader className="border-b px-5 py-4 shrink-0">
          <SheetTitle className="text-base truncate" title={product?.product_title}>
            {product?.product_title}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {product?.product_brand
              ? `${product.product_brand} • ${product.impressions} appearances`
              : `${product?.impressions || 0} appearances`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {product?.appearances.map((app) => {
            const dateStr = new Date(app.created_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <Card key={app.id} className="border hover:shadow-xs transition-shadow">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 font-medium text-foreground text-xs">
                        <AIProviderAvatar
                          provider={resolveAIProvider(app.platform)}
                          className="h-4.5 w-4.5"
                        />
                        <span>{getAIProviderDisplayName(resolveAIProvider(app.platform))}</span>
                      </div>
                      {app.region && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          {app.region}
                        </Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {dateStr}
                      </span>
                    </div>

                    {app.merchant_url && (
                      <a
                        href={app.merchant_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                      >
                        {t('appearanceMerchant')}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {t('appearancePrompt')}
                    </span>
                    <div>
                      {app.prompt_id ? (
                        <Link
                          href={`/dashboard/prompts/${app.prompt_id}`}
                          className="text-sm text-foreground font-medium hover:text-primary hover:underline line-clamp-3 block leading-relaxed"
                          title="View Prompt Details"
                          onClick={() => onOpenChange(false)}
                        >
                          &quot;{app.prompt_text}&quot;
                        </Link>
                      ) : (
                        <p className="text-sm font-medium text-foreground italic leading-relaxed">
                          &quot;{app.prompt_text}&quot;
                        </p>
                      )}
                    </div>
                  </div>

                  <details className="text-xs border rounded-md group">
                    <summary className="cursor-pointer font-medium p-2 text-muted-foreground hover:text-foreground select-none flex items-center justify-between">
                      <span>{t('appearanceRaw')}</span>
                      <span className="transition-transform group-open:rotate-180">↓</span>
                    </summary>
                    <div className="border-t p-2 bg-muted/20 overflow-x-auto max-h-[220px]">
                      <CodeBlock>
                        <CodeBlockCode
                          code={JSON.stringify(app.raw, null, 2)}
                          language="json"
                          theme="github-light"
                        />
                      </CodeBlock>
                    </div>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
