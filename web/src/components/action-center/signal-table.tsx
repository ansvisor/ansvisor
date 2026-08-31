'use client';

import { useTranslations } from 'next-intl';
import { Check, Eye, MoreHorizontal, RotateCcw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Signal } from '@/lib/actions/signals';
import { SIGNAL_KINDS, type SignalImpact, type SignalStatus } from '@/lib/signals/registry';
import { signalAffected, signalTexts } from '@/lib/signals/display';
import { formatRelative } from '@/lib/format-relative';
import { cn } from '@/lib/utils';

/**
 * Impact as the mockup's multi-dot meter. Never color alone: the dots sit
 * beside the impact word, which carries the meaning for assistive tech.
 */
export function ImpactDots({ impact }: { impact: SignalImpact }) {
  const filled = impact === 'high' ? 3 : impact === 'medium' ? 2 : 1;
  const color =
    impact === 'high' ? 'bg-red-500' : impact === 'medium' ? 'bg-amber-500' : 'bg-muted-foreground';
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn('h-1.5 w-1.5 rounded-full', i < filled ? color : 'bg-muted')}
        />
      ))}
    </span>
  );
}

export const STATUS_BADGE: Record<SignalStatus, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  acknowledged: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  resolved: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  dismissed: 'border-border bg-muted/50 text-muted-foreground',
};

const STATE_TEXT: Record<string, string> = {
  dropped: 'text-red-600 dark:text-red-400',
  lost: 'text-red-600 dark:text-red-400',
  crossed: 'text-red-600 dark:text-red-400',
  gain: 'text-red-600 dark:text-red-400',
  gained: 'text-green-600 dark:text-green-400',
  overtaken: 'text-green-600 dark:text-green-400',
  opportunity: 'text-emerald-600 dark:text-emerald-400',
};

export function SignalStatusBadge({ status }: { status: SignalStatus }) {
  const t = useTranslations('actionCenter.signalsPage');
  return (
    <Badge variant="outline" className={STATUS_BADGE[status]}>
      {t(`status.${status}`)}
    </Badge>
  );
}

function detectedLabel(iso: string, tCommon: ReturnType<typeof useTranslations>): string {
  return formatRelative(iso, tCommon);
}

export function SignalTable({
  signals,
  onSelect,
  onStatusChange,
  busyId,
}: {
  signals: Signal[];
  onSelect: (signal: Signal) => void;
  onStatusChange: (signal: Signal, status: SignalStatus) => void;
  busyId: string | null;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.signalCategories');
  const tCommon = useTranslations('common');

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t('table.signal')}</TableHead>
            <TableHead className="text-xs">{t('table.type')}</TableHead>
            <TableHead className="text-xs">{t('table.impact')}</TableHead>
            <TableHead className="text-xs">{t('table.source')}</TableHead>
            <TableHead className="text-xs">{t('table.affected')}</TableHead>
            <TableHead className="text-xs">{t('table.detected')}</TableHead>
            <TableHead className="text-xs">{t('table.status')}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t('table.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signals.map((signal) => {
            const texts = signalTexts(signal, tTexts);
            const affected = signalAffected(signal, t);
            const stateKey = SIGNAL_KINDS[signal.kind].stateKey;
            const detected = new Date(signal.detectedAt);
            return (
              <TableRow
                key={signal.id}
                className="cursor-pointer"
                onClick={() => onSelect(signal)}
              >
                <TableCell className="max-w-[360px]">
                  <p className="truncate text-sm font-medium">{texts.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{texts.description}</p>
                </TableCell>
                <TableCell>
                  <p className="text-xs font-medium">{tCategories(signal.category)}</p>
                  <p className={cn('text-xs', STATE_TEXT[stateKey] ?? 'text-muted-foreground')}>
                    {t(`states.${stateKey}`)}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{t(`impact.${signal.impact}`)}</span>
                    <ImpactDots impact={signal.impact} />
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {signal.source.map((s) => t(`sources.${s}`)).join(' + ')}
                </TableCell>
                <TableCell className="max-w-[180px]">
                  <p className="text-xs font-medium">{affected.label}</p>
                  {affected.detail && (
                    <p className="truncate text-xs text-muted-foreground">{affected.detail}</p>
                  )}
                </TableCell>
                <TableCell>
                  <p className="text-xs tabular-nums">
                    {detected.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                    {', '}
                    {detected.toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {detectedLabel(signal.detectedAt, tCommon)}
                  </p>
                </TableCell>
                <TableCell>
                  <SignalStatusBadge status={signal.status} />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="rounded p-1 text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                      disabled={busyId === signal.id}
                      aria-label={t('menu.label')}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {signal.status === 'new' && (
                        <DropdownMenuItem onClick={() => onStatusChange(signal, 'acknowledged')}>
                          <Eye className="h-4 w-4" />
                          {t('menu.acknowledge')}
                        </DropdownMenuItem>
                      )}
                      {(signal.status === 'new' || signal.status === 'acknowledged') && (
                        <>
                          <DropdownMenuItem onClick={() => onStatusChange(signal, 'resolved')}>
                            <Check className="h-4 w-4" />
                            {t('menu.resolve')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onStatusChange(signal, 'dismissed')}>
                            <X className="h-4 w-4" />
                            {t('menu.dismiss')}
                          </DropdownMenuItem>
                        </>
                      )}
                      {(signal.status === 'resolved' || signal.status === 'dismissed') && (
                        <DropdownMenuItem onClick={() => onStatusChange(signal, 'new')}>
                          <RotateCcw className="h-4 w-4" />
                          {t('menu.reopen')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
