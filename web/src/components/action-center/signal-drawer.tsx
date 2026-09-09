'use client';

import { useTranslations } from 'next-intl';
import { ArrowUpRight, Check, Eye, RotateCcw, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import type { Signal } from '@/lib/actions/signals';
import { SIGNAL_KINDS, type SignalStatus } from '@/lib/signals/registry';
import { signalAffected, signalTexts } from '@/lib/signals/display';
import { isKpiKey } from '@/lib/kpis/registry';
import { ImpactDots, SignalStatusBadge } from './signal-table';

/**
 * Signal detail: the evidence view. Deliberately light in v1 — identity,
 * the measured change, affected entities, related KPIs, and triage. The
 * "Create Action" CTA belongs to the Actions iteration and is absent rather
 * than dead.
 */
export function SignalDrawer({
  signal,
  onOpenChange,
  onStatusChange,
  isBusy,
}: {
  signal: Signal | null;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (signal: Signal, status: SignalStatus) => void;
  isBusy: boolean;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.signalCategories');
  const tRegistry = useTranslations('actionCenter.registry');

  if (!signal) return null;
  const texts = signalTexts(signal, tTexts);
  const affected = signalAffected(signal, t);
  const stateKey = SIGNAL_KINDS[signal.kind].stateKey;
  const relatedKpis = signal.kpiKeys.filter(isKpiKey);

  const formatStamp = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <Sheet open={Boolean(signal)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{tCategories(signal.category)}</span>
            <span>·</span>
            <span>{t(`states.${stateKey}`)}</span>
            <span className="flex items-center gap-1.5">
              <ImpactDots impact={signal.impact} />
              {t(`impact.${signal.impact}`)}
            </span>
          </div>
          <SheetTitle>{texts.title}</SheetTitle>
          <SheetDescription>{texts.description}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <DetailItem label={t('drawer.status')}>
              <SignalStatusBadge status={signal.status} />
            </DetailItem>
            <DetailItem label={t('drawer.source')}>
              <span className="text-xs">
                {signal.source.map((s) => t(`sources.${s}`)).join(' + ')}
              </span>
            </DetailItem>
            <DetailItem label={t('drawer.detected')}>
              <span className="text-xs tabular-nums">{formatStamp(signal.detectedAt)}</span>
            </DetailItem>
            <DetailItem label={t('drawer.lastDetected')}>
              <span className="text-xs tabular-nums">{formatStamp(signal.lastDetectedAt)}</span>
            </DetailItem>
          </div>

          {(signal.previousValue !== null || signal.changeValue !== null) && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('drawer.whatChanged')}
                </p>
                <div className="mt-2 flex items-baseline gap-3 tabular-nums">
                  {signal.previousValue !== null && (
                    <span className="text-sm text-muted-foreground line-through">
                      {signal.previousValue}
                    </span>
                  )}
                  {signal.currentValue !== null && (
                    <span className="text-lg font-semibold">{signal.currentValue}</span>
                  )}
                  {signal.changeValue !== null && (
                    <span
                      className={
                        signal.changeValue >= 0 === SIGNAL_KINDS[signal.kind].positive
                          ? 'text-xs font-medium text-green-600 dark:text-green-400'
                          : 'text-xs font-medium text-red-500'
                      }
                    >
                      {signal.changeValue > 0 ? '+' : ''}
                      {signal.changeValue}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          <Separator />
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t('drawer.affected')}</p>
            <p className="mt-1 text-sm">{affected.label}</p>
            {affected.detail && (
              <p className="break-all text-xs text-muted-foreground">{affected.detail}</p>
            )}
            {typeof signal.payload.promptId === 'string' && (
              <Link
                href={`/dashboard/prompts/${signal.payload.promptId}`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-2 hover:underline"
              >
                {t('drawer.viewPrompt')}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          {relatedKpis.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('drawer.relatedKpis')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {relatedKpis.map((key) => (
                    <Badge key={key} variant="outline" className="text-xs">
                      {tRegistry(`${key}.name`)}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t px-6 py-4">
          {signal.status === 'new' && (
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => onStatusChange(signal, 'acknowledged')}
            >
              <Eye className="h-3.5 w-3.5" />
              {t('menu.acknowledge')}
            </Button>
          )}
          {(signal.status === 'new' || signal.status === 'acknowledged') && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={isBusy}
                onClick={() => onStatusChange(signal, 'dismissed')}
              >
                <X className="h-3.5 w-3.5" />
                {t('menu.dismiss')}
              </Button>
              <Button
                size="sm"
                disabled={isBusy}
                onClick={() => onStatusChange(signal, 'resolved')}
              >
                <Check className="h-3.5 w-3.5" />
                {t('menu.resolve')}
              </Button>
            </>
          )}
          {(signal.status === 'resolved' || signal.status === 'dismissed') && (
            <Button
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={() => onStatusChange(signal, 'new')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('menu.reopen')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
