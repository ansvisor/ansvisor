'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  ArrowUpDown,
  CircleDot,
  ListChecks,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Brand } from '@/types';
import { getActions, type ActionItem } from '@/lib/actions/action-center';
import { listMembers, type TeamMember } from '@/lib/actions/team';
import {
  ACTION_CATEGORIES,
  ACTION_IMPACTS,
  ACTION_SORTS,
  ACTION_STATUSES,
  type ActionCategory,
  type ActionImpact,
  type ActionSort,
  type ActionStatus,
} from '@/lib/action-center/registry';
import { actionContextTags, actionTexts, comparePriority } from '@/lib/action-center/display';
import { ActionCenterTabs } from '@/components/action-center/action-center-tabs';
import { ActionTable } from '@/components/action-center/action-table';
import { ActionDrawer } from '@/components/action-center/action-drawer';
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

const OPEN_STATUSES: ActionStatus[] = ['new', 'in_progress', 'on_hold', 'no_improvement'];

export default function ActionCenterActionsPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const t = useTranslations('actionCenter.actionsPage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <ActionCenterTabs />
      {brand ? (
        <ActionsContent key={brand.id} brand={brand} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h2 className="text-lg font-semibold">{t('noBrand.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('noBrand.description')}</p>
        </div>
      )}
    </div>
  );
}

function ActionsContent({ brand }: { brand: Brand }) {
  const t = useTranslations('actionCenter.actionsPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tCategories = useTranslations('actionCenter.actionCategories');

  const [actions, setActions] = useState<ActionItem[] | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [category, setCategory] = useState<ActionCategory | 'all'>('all');
  const [impact, setImpact] = useState<ActionImpact | 'all'>('all');
  const [status, setStatus] = useState<ActionStatus | 'all'>('all');
  const [assignee, setAssignee] = useState<string>('all');
  const [sort, setSort] = useState<ActionSort>('priority');
  const [search, setSearch] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setActions(await getActions(brand.id));
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [brand.id]);

  useEffect(() => {
    void load();
    listMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [load]);

  const selected = useMemo(
    () => (actions ?? []).find((action) => action.id === selectedId) ?? null,
    [actions, selectedId],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = (actions ?? []).filter((action) => {
      if (category !== 'all' && action.category !== category) return false;
      if (impact !== 'all' && action.impact !== impact) return false;
      if (status !== 'all' && action.status !== status) return false;
      if (assignee !== 'all') {
        if (assignee === 'unassigned' ? action.assignee !== null : action.assignee?.id !== assignee)
          return false;
      }
      if (needle) {
        const texts = actionTexts(action, tTexts);
        const tags = actionContextTags(action, t).join(' ');
        if (!`${texts.title} ${texts.description} ${tags}`.toLowerCase().includes(needle))
          return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'impact':
          return comparePriority(a, b);
        case 'newest':
          return b.createdAt.localeCompare(a.createdAt);
        case 'due_date':
          return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
        case 'updated':
          return b.updatedAt.localeCompare(a.updatedAt);
        default:
          return comparePriority(a, b);
      }
    });
  }, [actions, category, impact, status, assignee, search, sort, tTexts, t]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<ActionCategory, number>();
    for (const action of actions ?? []) {
      counts.set(action.category, (counts.get(action.category) ?? 0) + 1);
    }
    return counts;
  }, [actions]);

  const summary = useMemo(() => {
    const open = (actions ?? []).filter((action) => OPEN_STATUSES.includes(action.status));
    const impacts = open.map((action) => action.impact);
    return {
      top: open.filter((action) => action.impact === 'high').length,
      atRisk: open.filter((action) => action.category === 'recover' || action.category === 'fix')
        .length,
      opportunities: open.filter((action) => action.category === 'growth').length,
      inProgress: (actions ?? []).filter((action) => action.status === 'in_progress').length,
      potential: impacts.includes('high') ? 'high' : impacts.includes('medium') ? 'medium' : 'low',
      hasOpen: open.length > 0,
    };
  }, [actions]);

  const hasActiveFilters =
    category !== 'all' || impact !== 'all' || status !== 'all' || assignee !== 'all' || search !== '';

  const clearFilters = () => {
    setCategory('all');
    setImpact('all');
    setStatus('all');
    setAssignee('all');
    setSearch('');
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
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
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

  if (!actions?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <ListChecks className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('empty.title')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard icon={CircleDot} label={t('cards.top')} value={summary.top} sub={t('cards.topSub')} />
        <SummaryCard
          icon={Shield}
          label={t('cards.atRisk')}
          value={summary.atRisk}
          sub={t('cards.atRiskSub')}
        />
        <SummaryCard
          icon={Sparkles}
          label={t('cards.opportunities')}
          value={summary.opportunities}
          sub={t('cards.opportunitiesSub')}
        />
        <SummaryCard
          icon={ArrowUpDown}
          label={t('cards.inProgress')}
          value={summary.inProgress}
          sub={t('cards.inProgressSub')}
        />
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md border bg-muted/40">
                <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">{t('cards.impact')}</p>
            </div>
            <p className="mt-2 text-2xl font-bold">
              {summary.hasOpen ? t(`impact.${summary.potential}`) : '—'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('cards.impactSub')}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryPill
            label={t('allActions')}
            count={actions.length}
            isActive={category === 'all'}
            onClick={() => setCategory('all')}
          />
          {ACTION_CATEGORIES.filter((key) => (categoryCounts.get(key) ?? 0) > 0).map((key) => (
            <CategoryPill
              key={key}
              label={tCategories(key)}
              count={categoryCounts.get(key) ?? 0}
              isActive={category === key}
              onClick={() => setCategory(key)}
            />
          ))}
        </div>
        <Select
          value={sort}
          onValueChange={(v) => setSort((v ?? 'priority') as ActionSort)}
          items={ACTION_SORTS.map((key) => ({ value: key, label: t(`sort.${key}`) }))}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <span className="text-muted-foreground">{t('sort.label')}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_SORTS.map((key) => (
              <SelectItem key={key} value={key}>
                {t(`sort.${key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label={t('filters.impact')}
          value={impact}
          onChange={(v) => setImpact(v as ActionImpact | 'all')}
          options={ACTION_IMPACTS.map((v) => ({ value: v, label: t(`impact.${v}`) }))}
          allLabel={t('filters.all')}
        />
        <FilterSelect
          label={t('filters.status')}
          value={status}
          onChange={(v) => setStatus(v as ActionStatus | 'all')}
          options={ACTION_STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) }))}
          allLabel={t('filters.all')}
        />
        <FilterSelect
          label={t('filters.assignee')}
          value={assignee}
          onChange={setAssignee}
          options={[
            { value: 'unassigned', label: t('filters.unassigned') },
            ...members.map((member) => ({
              value: member.userId,
              label: member.fullName ?? member.userId.slice(0, 8),
            })),
          ]}
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
        <ActionTable actions={visible} onSelect={(action) => setSelectedId(action.id)} />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t('noResults')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
        </div>
      )}

      <ActionDrawer
        brandId={brand.id}
        action={selected}
        members={members}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onChanged={() => void load()}
      />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border bg-muted/40">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
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
