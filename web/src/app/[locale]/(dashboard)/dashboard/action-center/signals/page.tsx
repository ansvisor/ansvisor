'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertCircle, Radar, Search, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Brand } from '@/types';
import {
  getSignals,
  getSignalsSummary,
  updateSignalStatus,
  type Signal,
  type SignalsSummary,
} from '@/lib/actions/signals';
import {
  SIGNAL_CATEGORIES,
  SIGNAL_IMPACTS,
  SIGNAL_SOURCES,
  SIGNAL_STATUSES,
  type SignalCategory,
  type SignalImpact,
  type SignalSource,
  type SignalStatus,
} from '@/lib/signals/registry';
import { signalAffected, signalTexts } from '@/lib/signals/display';
import { ActionCenterTabs } from '@/components/action-center/action-center-tabs';
import { SignalTable } from '@/components/action-center/signal-table';
import { SignalDrawer } from '@/components/action-center/signal-drawer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { KpiTrendPoint } from '@/lib/actions/kpis';

const KpiSparkline = dynamic(() => import('@/components/action-center/kpi-sparkline'), {
  ssr: false,
  loading: () => <Skeleton className="h-8 w-[110px]" />,
});

type SignalDatePreset = '7d' | '30d' | '90d';
const DATE_PRESETS: readonly SignalDatePreset[] = ['7d', '30d', '90d'];
const PRESET_DAYS: Record<SignalDatePreset, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 86_400_000;

function utcDay(offset = 0): string {
  return new Date(Date.now() - offset * DAY_MS).toISOString().slice(0, 10);
}

export default function ActionCenterSignalsPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const t = useTranslations('actionCenter.signalsPage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <ActionCenterTabs />
      {brand ? (
        <SignalsContent key={brand.id} brand={brand} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h2 className="text-lg font-semibold">{t('noBrand.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('noBrand.description')}</p>
        </div>
      )}
    </div>
  );
}

function SignalsContent({ brand }: { brand: Brand }) {
  const t = useTranslations('actionCenter.signalsPage');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.signalCategories');

  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [summary, setSummary] = useState<SignalsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [datePreset, setDatePreset] = useState<SignalDatePreset>('30d');
  const [category, setCategory] = useState<SignalCategory | 'all'>('all');
  const [impact, setImpact] = useState<SignalImpact | 'all'>('all');
  const [status, setStatus] = useState<SignalStatus | 'all'>('all');
  const [source, setSource] = useState<SignalSource | 'all'>('all');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<Signal | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const windowDays = PRESET_DAYS[datePreset];
  const dayFrom = utcDay(windowDays - 1);
  const dayTo = utcDay();

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const [rows, sums] = await Promise.all([
        getSignals(brand.id, { dayFrom, dayTo }),
        getSignalsSummary(brand.id, dayFrom, dayTo),
      ]);
      setSignals(rows);
      setSummary(sums);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [brand.id, dayFrom, dayTo]);

  useEffect(() => {
    void load();
  }, [load]);

  // Category/impact/status/source/search all narrow client-side: the whole
  // window is already loaded (per-brand signal counts are tens), and search
  // must match the composed titles, which only exist here.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (signals ?? []).filter((signal) => {
      if (category !== 'all' && signal.category !== category) return false;
      if (impact !== 'all' && signal.impact !== impact) return false;
      if (status !== 'all' && signal.status !== status) return false;
      if (source !== 'all' && !signal.source.includes(source)) return false;
      if (needle) {
        const texts = signalTexts(signal, tTexts);
        const affected = signalAffected(signal, t);
        const haystack =
          `${texts.title} ${texts.description} ${affected.detail ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [signals, category, impact, status, source, search, tTexts, t]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<SignalCategory, number>();
    for (const signal of signals ?? []) {
      counts.set(signal.category, (counts.get(signal.category) ?? 0) + 1);
    }
    return counts;
  }, [signals]);

  const sparkPoints = useMemo<KpiTrendPoint[]>(() => {
    if (!summary) return [];
    return Array.from({ length: Math.min(windowDays, 30) }, (_, i) => {
      const day = utcDay(Math.min(windowDays, 30) - 1 - i);
      return { date: day, value: summary.byDay[day] ?? 0 };
    });
  }, [summary, windowDays]);

  const hasActiveFilters =
    category !== 'all' || impact !== 'all' || status !== 'all' || source !== 'all' || search !== '';

  const clearFilters = () => {
    setCategory('all');
    setImpact('all');
    setStatus('all');
    setSource('all');
    setSearch('');
  };

  const handleStatusChange = async (signal: Signal, nextStatus: SignalStatus) => {
    setBusyId(signal.id);
    try {
      await updateSignalStatus(brand.id, signal.id, nextStatus);
      const patch = (s: Signal) =>
        s.id === signal.id
          ? {
              ...s,
              status: nextStatus,
              resolvedAt: nextStatus === 'resolved' ? new Date().toISOString() : null,
            }
          : s;
      setSignals((prev) => (prev ?? []).map(patch));
      setSelected((prev) => (prev && prev.id === signal.id ? patch(prev) : prev));
    } catch {
      toast.error(t('statusChangeFailed'));
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('error.title')}</h2>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          {t('error.retry')}
        </Button>
      </div>
    );
  }

  if (!signals?.length && !hasActiveFilters) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <Radar className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('empty.title')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            label={t('cards.total')}
            value={summary.total}
            prev={summary.prevTotal}
            days={windowDays}
            spark={sparkPoints}
          />
          <SummaryCard label={t('cards.important')} value={summary.important} days={windowDays} />
          <SummaryCard label={t('cards.new')} value={summary.newCount} days={windowDays} />
          <SummaryCard label={t('cards.resolved')} value={summary.resolved} days={windowDays} />
          <AvgImpactCard summary={summary} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryPill
            label={t('allSignals')}
            count={signals?.length ?? 0}
            isActive={category === 'all'}
            onClick={() => setCategory('all')}
          />
          {SIGNAL_CATEGORIES.filter((key) => (categoryCounts.get(key) ?? 0) > 0).map((key) => (
            <CategoryPill
              key={key}
              label={tCategories(key)}
              count={categoryCounts.get(key) ?? 0}
              isActive={category === key}
              onClick={() => setCategory(key)}
            />
          ))}
        </div>
        <div
          className="flex h-8 overflow-hidden rounded-md border"
          role="group"
          aria-label={t('table.detected')}
        >
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setDatePreset(preset)}
              aria-pressed={datePreset === preset}
              className={cn(
                'px-3 text-xs font-medium transition-colors',
                datePreset === preset
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-foreground hover:bg-muted',
              )}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label={t('filters.impact')}
          value={impact}
          onChange={(v) => setImpact(v as SignalImpact | 'all')}
          options={SIGNAL_IMPACTS.map((v) => ({ value: v, label: t(`impact.${v}`) }))}
          allLabel={t('filters.all')}
        />
        <FilterSelect
          label={t('filters.status')}
          value={status}
          onChange={(v) => setStatus(v as SignalStatus | 'all')}
          options={SIGNAL_STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) }))}
          allLabel={t('filters.all')}
        />
        <FilterSelect
          label={t('filters.source')}
          value={source}
          onChange={(v) => setSource(v as SignalSource | 'all')}
          options={SIGNAL_SOURCES.map((v) => ({ value: v, label: t(`sources.${v}`) }))}
          allLabel={t('filters.all')}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('filters.search')}
            className="h-8 w-56 pl-8 text-xs"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" />
            {t('filters.clear')}
          </Button>
        )}
      </div>

      {visible.length > 0 ? (
        <SignalTable
          signals={visible}
          onSelect={setSelected}
          onStatusChange={(signal, next) => void handleStatusChange(signal, next)}
          busyId={busyId}
        />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t('noResults')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
        </div>
      )}

      <SignalDrawer
        signal={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onStatusChange={(signal, next) => void handleStatusChange(signal, next)}
        isBusy={busyId === selected?.id}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  prev,
  days,
  spark,
}: {
  label: string;
  value: number;
  prev?: number;
  days: number;
  spark?: KpiTrendPoint[];
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const change =
    prev !== undefined && prev > 0 ? Math.round(((value - prev) / prev) * 100) : null;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="mt-1 flex items-end justify-between gap-2">
          <span className="text-2xl font-bold tabular-nums">{value}</span>
          {spark && spark.length > 1 && (
            <span className="text-muted-foreground">
              <KpiSparkline points={spark} />
            </span>
          )}
        </div>
        {change !== null && (
          <p
            className={cn(
              'mt-1 flex items-center gap-0.5 text-xs',
              change >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-500',
            )}
          >
            {change >= 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {Math.abs(change)}% {t('cards.vsPrev', { days })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AvgImpactCard({ summary }: { summary: SignalsSummary }) {
  const t = useTranslations('actionCenter.signalsPage');
  const ratio = summary.total > 0 ? summary.important / summary.total : 0;
  const level = ratio >= 0.5 ? 'high' : ratio >= 0.2 ? 'medium' : 'low';
  const filled = level === 'high' ? 10 : level === 'medium' ? 6 : 3;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('cards.avgImpact')}
        </p>
        <p className="mt-1 text-2xl font-bold">{t(`impact.${level}`)}</p>
        <div className="mt-2 flex gap-0.5" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-2.5 w-1 rounded-sm',
                i < filled ? 'bg-foreground/70' : 'bg-muted',
              )}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? 'all')}>
      <SelectTrigger className="h-8 w-36 text-xs">
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CategoryPill({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
        isActive
          ? 'border-foreground/20 bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {label}
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}
