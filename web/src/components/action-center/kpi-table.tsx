'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Eye,
  MessageSquare,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  PieChart,
  Quote,
  Smile,
  TrendingDown,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { KpiSnapshot } from '@/lib/actions/kpis';
import { isValidKpiTarget, type KpiKey } from '@/lib/kpis/registry';
import { presetTarget } from '@/lib/kpis/presets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { KpiStatus } from '@/lib/kpis/status';
import { isImprovement } from '@/lib/kpis/status';
import { formatCompactNumber, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const KpiSparkline = dynamic(() => import('./kpi-sparkline'), {
  ssr: false,
  loading: () => <Skeleton className="h-8 w-[110px]" />,
});

const KPI_ICONS: Record<KpiKey, React.ComponentType<{ className?: string }>> = {
  ai_visibility: Eye,
  citations: Quote,
  mentions: MessageSquare,
  share_of_voice: PieChart,
  ai_referral_traffic: MousePointerClick,
  positive_sentiment: Smile,
};

/**
 * One soft color per status, shared by the badge, the sparkline and the
 * progress bar so a row's color always says one thing. Status is never
 * carried by color alone — the badge text is the accessible signal.
 */
const STATUS_BADGE: Record<KpiStatus, string> = {
  on_track: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  at_risk: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  off_track: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  goal_reached: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

const STATUS_TEXT: Record<KpiStatus, string> = {
  on_track: 'text-green-600 dark:text-green-400',
  at_risk: 'text-amber-600 dark:text-amber-400',
  off_track: 'text-red-600 dark:text-red-400',
  goal_reached: 'text-emerald-600 dark:text-emerald-400',
};

const STATUS_BAR: Record<KpiStatus, string> = {
  on_track: 'bg-green-500',
  at_risk: 'bg-amber-500',
  off_track: 'bg-red-500',
  goal_reached: 'bg-emerald-500',
};

/**
 * A KPI's value or target in its unit: "12.5%" for a share, "29.9/100" for
 * the Visibility score (a score, never a %: AC-02, D2), compact counts.
 */
function formatKpiValue(
  value: number,
  unit: KpiSnapshot['unit'],
  score: (value: number) => string,
): string {
  const tenth = Math.round(value * 10) / 10;
  if (unit === 'percent') return `${tenth}%`;
  if (unit === 'points') return score(tenth);
  return formatCompactNumber(value);
}

function KpiChange({ snapshot }: { snapshot: KpiSnapshot }) {
  const t = useTranslations('actionCenter.kpis');
  if (snapshot.change === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const improving = isImprovement(snapshot.change, snapshot.direction);
  const Arrow = snapshot.change > 0 ? TrendingUp : TrendingDown;
  const magnitude = Math.abs(snapshot.change);
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-xs font-medium tabular-nums',
        improving ? 'text-green-600 dark:text-green-400' : 'text-red-500',
      )}
    >
      <Arrow className="h-3.5 w-3.5" />
      {snapshot.changeKind === 'points' ? t('pointsChange', { value: magnitude }) : `${magnitude}%`}
    </span>
  );
}

function GoalProgress({ snapshot }: { snapshot: KpiSnapshot }) {
  const t = useTranslations('actionCenter.kpis');
  return (
    <div className="w-24">
      <span className="text-xs font-medium tabular-nums">{snapshot.progress}%</span>
      <div
        role="progressbar"
        aria-valuenow={Math.min(snapshot.progress, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('vsGoalAria', { progress: snapshot.progress })}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full', STATUS_BAR[snapshot.status])}
          style={{ width: `${Math.min(snapshot.progress, 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * "Goal passed · Set a new goal" (UX audit AC-62): the next goal offered 20%
 * above the KPI's value (presetTarget), to change before it is saved. Nothing
 * changes until Save.
 */
function NewGoalDialog({
  kpi,
  onClose,
  onSave,
  score,
}: {
  kpi: KpiSnapshot;
  onClose: () => void;
  onSave: (key: KpiKey, target: number) => void;
  score: (value: number) => string;
}) {
  const t = useTranslations('actionCenter.kpis');
  const tRegistry = useTranslations('actionCenter.registry');
  const [value, setValue] = useState(() => String(presetTarget(kpi.key, kpi.value)));
  const target = Number(value);
  const valid = value.trim() !== '' && isValidKpiTarget(kpi.key, target);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('newGoal.title', { name: tRegistry(`${kpi.key}.name`) })}</DialogTitle>
          <DialogDescription>
            {t('newGoal.description', {
              value: formatKpiValue(kpi.value, kpi.unit, score),
              goal: formatKpiValue(kpi.target, kpi.unit, score),
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSave(kpi.key, target);
            onClose();
          }}
        >
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            aria-label={t('newGoal.label')}
            data-action="kpis.newGoalValue"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!valid}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('newGoal.cancel')}
            </Button>
            <Button type="submit" data-action="kpis.saveNewGoal" disabled={!valid}>
              {t('newGoal.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KpiTable({
  kpis,
  onEdit,
  onRemove,
  onSetGoal,
  busyKey,
}: {
  kpis: KpiSnapshot[];
  /** Without them (the unsaved ready-made set) the rows have no menu. */
  onEdit?: (key: KpiKey) => void;
  onRemove?: (key: KpiKey) => void;
  /** A passed goal's next one, saved once confirmed (AC-62); none on the ready-made set. */
  onSetGoal?: (key: KpiKey, target: number) => void;
  busyKey: KpiKey | null;
}) {
  const editable = Boolean(onEdit && onRemove);
  const t = useTranslations('actionCenter.kpis');
  const tRegistry = useTranslations('actionCenter.registry');
  const scoreOf = (value: number) => t('score', { value });
  const [newGoalFor, setNewGoalFor] = useState<KpiSnapshot | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t('table.kpi')}</TableHead>
            <TableHead className="text-xs">{t('table.value')}</TableHead>
            <TableHead className="text-xs">{t('table.change')}</TableHead>
            <TableHead className="text-xs">{t('table.trend')}</TableHead>
            <TableHead className="text-xs">{t('table.status')}</TableHead>
            <TableHead className="text-xs">{t('table.goal')}</TableHead>
            <TableHead className="text-xs">{t('table.vsGoal')}</TableHead>
            {editable && (
              <TableHead className="w-10">
                <span className="sr-only">{t('table.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {kpis.map((kpi) => {
            const Icon = KPI_ICONS[kpi.key];
            return (
              <TableRow key={kpi.key}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{tRegistry(`${kpi.key}.name`)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tRegistry(`${kpi.key}.description`)}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm font-semibold tabular-nums">
                  {formatKpiValue(kpi.value, kpi.unit, scoreOf)}
                </TableCell>
                <TableCell>
                  <KpiChange snapshot={kpi} />
                </TableCell>
                <TableCell>
                  <div className={STATUS_TEXT[kpi.status]}>
                    <KpiSparkline points={kpi.trend} />
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_BADGE[kpi.status]}>
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
                    />
                    {t(`status.${kpi.status}`)}
                  </Badge>
                  {kpi.status === 'goal_reached' && onSetGoal && (
                    <button
                      type="button"
                      data-action="kpis.setNewGoal"
                      disabled={busyKey === kpi.key}
                      onClick={() => setNewGoalFor(kpi)}
                      className="mt-1 block text-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
                    >
                      {t('newGoal.prompt')}
                    </button>
                  )}
                </TableCell>
                {/* The exact goal on hover: compact counts can look alike ("21.4k"). */}
                <TableCell
                  className="text-xs text-muted-foreground tabular-nums"
                  title={formatNumber(kpi.target)}
                >
                  {formatKpiValue(kpi.target, kpi.unit, scoreOf)}
                </TableCell>
                <TableCell>
                  <GoalProgress snapshot={kpi} />
                </TableCell>
                {editable && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="rounded p-1 text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                        disabled={busyKey === kpi.key}
                        aria-label={t('menu.label', { name: tRegistry(`${kpi.key}.name`) })}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit?.(kpi.key)}>
                          <Pencil className="h-4 w-4" />
                          {t('menu.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => onRemove?.(kpi.key)}>
                          <Trash2 className="h-4 w-4" />
                          {t('menu.remove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {newGoalFor && onSetGoal && (
        <NewGoalDialog
          kpi={newGoalFor}
          onClose={() => setNewGoalFor(null)}
          onSave={onSetGoal}
          score={scoreOf}
        />
      )}
    </div>
  );
}
