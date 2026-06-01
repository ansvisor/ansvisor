'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ShoppingBag, Store, ArrowUpRight, Crown, Lock } from 'lucide-react';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import {
  getShoppingChartData,
  getShoppingFilterOptions,
  getShoppingKpis,
  type ShoppingChartData,
  type ShoppingDatePreset,
  type ShoppingFilters,
  type ShoppingKpis,
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
import { buttonVariants } from '@/components/ui/button';

const DATE_PRESETS: ShoppingDatePreset[] = ['7d', '30d', '90d', 'all'];

// Theme tokens in globals.css ship as full oklch values; reference them
// directly with var(--…). Wrapping in hsl() yields invalid CSS, so chart
// text turns black on dark mode (lesson learned from #138).
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;
const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  fontSize: '0.75rem',
  color: 'var(--foreground)',
} as const;

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
    try {
      const [k, c] = await Promise.all([
        getShoppingKpis(activeBrandId, filters),
        getShoppingChartData(activeBrandId, filters),
      ]);
      if (reqId === reqIdRef.current) {
        setKpis(k);
        setCharts(c);
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [activeBrandId, filters]);

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
          <KpiGrid t={t} kpis={kpis} loading={loading} hasFullAccess={hasFullAccess} />

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
        </>
      )}
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
            <SelectValue />
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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platformOpts.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      <FilterField label={t('filterRegion')}>
        <Select value={region} onValueChange={(v) => setRegion(v ?? 'all')}>
          <SelectTrigger className="h-8 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regionOpts.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
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
}: {
  t: ReturnType<typeof useTranslations<'shopping'>>;
  kpis: ShoppingKpis | null;
  loading: boolean;
  hasFullAccess: boolean;
}) {
  if (loading && !kpis) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        title={t('kpiCardRate')}
        value={formatPercent(cardRate)}
        subtitle={t('kpiCardRateSub')}
        icon={ShoppingBag}
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
      {width > 0 && (
        <BarChart
          width={width}
          height={220}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="platform" stroke="var(--border)" tick={AXIS_TICK} tickLine={false} />
          <YAxis
            stroke="var(--border)"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            unit="%"
          />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
          <Bar dataKey="rate" name="Card rate" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
        </BarChart>
      )}
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
      {width > 0 && (
        <LineChart
          width={width}
          height={220}
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            stroke="var(--border)"
            tick={AXIS_TICK}
            tickLine={false}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis stroke="var(--border)" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'var(--border)' }} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }} />
          <Line
            type="monotone"
            dataKey="ownCards"
            name="Your cards"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
          <Line
            type="monotone"
            dataKey="totalCards"
            name="All cards"
            stroke="var(--chart-4)"
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        </LineChart>
      )}
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
