'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, History as HistoryIcon, Search, X } from 'lucide-react';
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
import { useBrandStore } from '@/stores/use-brand-store';
import { getActionHistory } from '@/lib/actions/action-history';
import { actionTexts } from '@/lib/action-center/display';
import {
  HISTORY_PAGE_SIZE,
  HISTORY_SORTS,
  HISTORY_STATUSES,
  summarize,
  type ActionHistoryItem,
  type HistorySort,
} from '@/lib/action-center/history';
import {
  ACTION_CATEGORIES,
  ACTION_IMPACTS,
  type ActionCategory,
  type ActionImpact,
  type ActionStatus,
} from '@/lib/action-center/registry';
import { SIGNAL_SOURCES, type SignalSource } from '@/lib/signals/registry';
import { ActionCenterTabs } from '@/components/action-center/action-center-tabs';
import { HistoryTable } from '@/components/action-center/history-table';
import { HistoryDrawer } from '@/components/action-center/history-drawer';
import { cn } from '@/lib/utils';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, all: null } as const;
type RangePreset = keyof typeof RANGE_DAYS;
const RANGE_PRESETS = Object.keys(RANGE_DAYS) as RangePreset[];

/**
 * History: what was done, and what it moved.
 *
 * Reads the same actions the Actions tab triages, but from the far end — an
 * action appears here once it has run its course. Every column except Result
 * comes from a recorded row; Result says what has been measured, which is
 * nothing yet, because no pass re-reads an action's metrics after it closes.
 * See lib/action-center/history.
 */
export default function ActionCenterHistoryPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const brandId = brand?.id ?? null;
  const t = useTranslations('actionCenter.historyPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tTypes = useTranslations('actionCenter.actionCategories');
  const tActions = useTranslations('actionCenter.actionsPage');
  const tSources = useTranslations('actionCenter.signalsPage.sources');

  const [items, setItems] = useState<ActionHistoryItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [range, setRange] = useState<RangePreset>('30d');
  const [status, setStatus] = useState<ActionStatus | 'all'>('all');
  const [type, setType] = useState<ActionCategory | 'all'>('all');
  const [impact, setImpact] = useState<ActionImpact | 'all'>('all');
  const [source, setSource] = useState<SignalSource | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<HistorySort>('newest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ActionHistoryItem | null>(null);

  const load = useCallback(async () => {
    if (!brandId) {
      setItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const days = RANGE_DAYS[range];
      const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
      setItems(await getActionHistory(brandId, { from }));
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [brandId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any narrowing puts the reader back on page 1; staying on page 4 of a list
  // that now has one page shows nothing and looks like a failure.
  useEffect(() => {
    setPage(1);
  }, [status, type, impact, source, search, sort, range]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = (items ?? []).filter((item) => {
      if (status !== 'all' && item.status !== status) return false;
      if (type !== 'all' && item.type !== type) return false;
      if (impact !== 'all' && item.impact !== impact) return false;
      if (source !== 'all' && !item.sources.includes(source)) return false;
      if (needle) {
        // Titles are composed from i18n templates rather than stored, so the
        // search has to run against what the row actually renders.
        const texts = actionTexts(
          { kind: item.kind, payload: item.payload } as Parameters<typeof actionTexts>[0],
          tTexts,
        );
        const haystack = `${texts.title} ${texts.description} AC-${item.actionNo}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const impactRank = { high: 0, medium: 1, low: 2 };
    return rows.sort((a, b) => {
      const aDate = a.completedAt ?? a.createdAt;
      const bDate = b.completedAt ?? b.createdAt;
      switch (sort) {
        case 'oldest':
          return aDate.localeCompare(bDate);
        case 'impact':
          return impactRank[a.impact] - impactRank[b.impact] || bDate.localeCompare(aDate);
        default:
          return bDate.localeCompare(aDate);
      }
    });
  }, [items, status, type, impact, source, search, sort, tTexts]);

  const summary = useMemo(() => summarize(filtered), [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  const visible = filtered.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

  const hasActiveFilters =
    status !== 'all' || type !== 'all' || impact !== 'all' || source !== 'all' || search !== '';

  const clearFilters = () => {
    setStatus('all');
    setType('all');
    setImpact('all');
    setSource('all');
    setSearch('');
  };

  const header = (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
    </div>
  );

  if (!brandId) {
    return (
      <div className="space-y-6">
        {header}
        <ActionCenterTabs />
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <h2 className="font-semibold">{t('noBrand.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('noBrand.description')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <ActionCenterTabs />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
      ) : loadFailed ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">{t('error.title')}</h2>
          <Button variant="outline" className="mt-4" onClick={() => void load()}>
            {t('error.retry')}
          </Button>
        </div>
      ) : !items?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <HistoryIcon className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">{t('empty.title')}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard
              label={t('cards.total')}
              value={summary.totalActions}
              sub={t('cards.totalSub')}
            />
            <SummaryCard
              label={t('cards.completed')}
              value={summary.completed}
              sub={t('cards.ofTotal', { percent: summary.completedPercent })}
            />
            <SummaryCard
              label={t('cards.inProgress')}
              value={summary.inProgress}
              sub={t('cards.ofTotal', { percent: summary.inProgressPercent })}
            />
            <SummaryCard
              label={t('cards.noImprovement')}
              value={summary.noImprovement}
              sub={t('cards.ofTotal', { percent: summary.noImprovementPercent })}
            />
            <SummaryCard
              label={t('cards.dismissed')}
              value={summary.dismissed}
              sub={t('cards.ofTotal', { percent: summary.dismissedPercent })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRange(preset)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    range === preset
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {t(`range.${preset}`)}
                </button>
              ))}
            </div>
            <FilterSelect
              label={t('filters.status')}
              value={status}
              onChange={(v) => setStatus(v as ActionStatus | 'all')}
              options={HISTORY_STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) }))}
              allLabel={t('filters.all')}
            />
            <FilterSelect
              label={t('filters.type')}
              value={type}
              onChange={(v) => setType(v as ActionCategory | 'all')}
              options={ACTION_CATEGORIES.map((v) => ({ value: v, label: tTypes(v) }))}
              allLabel={t('filters.all')}
            />
            <FilterSelect
              label={t('filters.impact')}
              value={impact}
              onChange={(v) => setImpact(v as ActionImpact | 'all')}
              options={ACTION_IMPACTS.map((v) => ({ value: v, label: tActions(`impact.${v}`) }))}
              allLabel={t('filters.all')}
            />
            <FilterSelect
              label={t('filters.source')}
              value={source}
              onChange={(v) => setSource(v as SignalSource | 'all')}
              options={SIGNAL_SOURCES.map((v) => ({ value: v, label: tSources(v) }))}
              allLabel={t('filters.all')}
            />
            <FilterSelect
              label={t('filters.sort')}
              value={sort}
              onChange={(v) => setSort((v === 'all' ? 'newest' : v) as HistorySort)}
              options={HISTORY_SORTS.map((v) => ({ value: v, label: t(`sort.${v}`) }))}
              allLabel={t('sort.newest')}
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
            <>
              <HistoryTable
                items={visible}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {t('pagination.showing', {
                    from: (page - 1) * HISTORY_PAGE_SIZE + 1,
                    to: Math.min(page * HISTORY_PAGE_SIZE, filtered.length),
                    total: filtered.length,
                  })}
                </span>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={page === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      {t('pagination.previous')}
                    </Button>
                    <span className="px-2 tabular-nums">
                      {t('pagination.page', { page, pageCount })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={page === pageCount}
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    >
                      {t('pagination.next')}
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <h2 className="font-semibold">{t('noMatch.title')}</h2>
              <Button variant="outline" size="sm" className="mt-4 text-xs" onClick={clearFilters}>
                {t('noMatch.clear')}
              </Button>
            </div>
          )}
        </>
      )}

      <HistoryDrawer item={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
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
  const items = [{ value: 'all', label: allLabel }, ...options];
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? 'all')} items={items}>
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
