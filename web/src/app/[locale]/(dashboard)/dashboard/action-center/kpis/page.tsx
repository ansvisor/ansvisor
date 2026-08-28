'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertCircle, Loader2, Plus, Target } from 'lucide-react';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Brand } from '@/types';
import {
  applyDefaultKpis,
  getKpiSnapshots,
  removeKpi,
  type KpiSnapshotsResult,
} from '@/lib/actions/kpis';
import type { KpiCategory, KpiKey } from '@/lib/kpis/registry';
import { ActionCenterTabs } from '@/components/action-center/action-center-tabs';
import { KpiTable } from '@/components/action-center/kpi-table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export default function ActionCenterKpisPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const t = useTranslations('actionCenter.kpis');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <ActionCenterTabs />
      {brand ? (
        <KpisContent key={brand.id} brand={brand} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h2 className="text-lg font-semibold">{t('noBrand.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('noBrand.description')}</p>
        </div>
      )}
    </div>
  );
}

function KpisContent({ brand }: { brand: Brand }) {
  const t = useTranslations('actionCenter.kpis');
  const tCategories = useTranslations('actionCenter.categories');

  const [result, setResult] = useState<KpiSnapshotsResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [category, setCategory] = useState<KpiCategory | 'all'>('all');
  const [busyKey, setBusyKey] = useState<KpiKey | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setResult(await getKpiSnapshots(brand.id));
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [brand.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = useMemo(() => result?.kpis ?? [], [result]);
  const categories = useMemo(() => {
    const counts = new Map<KpiCategory, number>();
    for (const kpi of kpis) counts.set(kpi.category, (counts.get(kpi.category) ?? 0) + 1);
    return [...counts.entries()];
  }, [kpis]);
  const visible = category === 'all' ? kpis : kpis.filter((k) => k.category === category);

  const handleApplyDefaults = async () => {
    setIsApplying(true);
    try {
      await applyDefaultKpis(brand.id);
      await load();
    } catch {
      toast.error(t('applyFailed'));
    } finally {
      setIsApplying(false);
    }
  };

  const handleRemove = async (key: KpiKey) => {
    setBusyKey(key);
    try {
      await removeKpi(brand.id, key);
      await load();
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setBusyKey(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-24" />
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
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

  if (!result?.configured) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <Target className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('empty.title')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
        <Button className="mt-4" onClick={() => void handleApplyDefaults()} disabled={isApplying}>
          {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('empty.cta')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <CategoryPill
          label={t('allKpis')}
          count={kpis.length}
          isActive={category === 'all'}
          onClick={() => setCategory('all')}
        />
        {categories.map(([key, count]) => (
          <CategoryPill
            key={key}
            label={tCategories(key)}
            count={count}
            isActive={category === key}
            onClick={() => setCategory(key)}
          />
        ))}
      </div>

      {visible.length > 0 ? (
        <KpiTable kpis={visible} onRemove={(key) => void handleRemove(key)} busyKey={busyKey} />
      ) : kpis.length > 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t('noResults')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setCategory('all')}>
            {t('clearFilter')}
          </Button>
        </div>
      ) : (
        // Configured but nothing active/computable — distinct from the
        // never-configured empty state, which offers the default set.
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t('allInactive')}</p>
        </div>
      )}
    </div>
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
        'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors',
        isActive
          ? 'border-foreground/20 bg-muted font-medium'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {label}
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}
