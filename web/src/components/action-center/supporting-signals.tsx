'use client';

import { useTranslations } from 'next-intl';
import type { Signal } from '@/lib/actions/signals';
import { signalAffected, signalTypeLabel } from '@/lib/signals/display';
import { platformName } from '@/lib/signals/names';
import { supportingOf } from '@/lib/action-center/affected';

/** How many rows "What happened" lists before "All signals". */
export const SUPPORT_SHOWN = 5;

/**
 * "n signals support this action" (AC-007): the open signals an action rests
 * on, each by type, platform and what it is about, so why it exists can be
 * checked. Resolved and dismissed signals no longer support it, nor do ones
 * that have moved on to a later cycle's action; the Signals tab, which
 * "All signals" opens, still lists them all. Signals that read the same (one
 * kind, the same platforms and target) share one row with how many they are:
 * three identical rows said nothing the first didn't.
 */
export function SupportingSignals({
  actionId,
  signals,
  onOpenSignal,
  onShowAll,
}: {
  actionId: string;
  /** Every signal the action has taken as evidence, newest first. */
  signals: Signal[];
  onOpenSignal: (id: string) => void;
  onShowAll: () => void;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer');
  const tSignals = useTranslations('actionCenter.signalsPage');
  const tCategories = useTranslations('actionCenter.signalCategories');

  // As the list counts them: open, and this action's now.
  const supporting = supportingOf(signals, actionId);
  const rows: { key: string; label: string; where: string; ids: string[] }[] = [];
  for (const signal of supporting) {
    const affected = signalAffected(signal, tSignals);
    const label = signalTypeLabel(signal, tCategories, tSignals);
    const where = [
      signal.where.platforms.map(platformName).join(', '),
      affected.detail ?? affected.label,
    ]
      .filter(Boolean)
      .join(' · ');
    const key = `${label}\u0000${where}`;
    const same = rows.find((row) => row.key === key);
    if (same) same.ids.push(signal.id);
    else rows.push({ key, label, where, ids: [signal.id] });
  }
  const shown = rows.slice(0, SUPPORT_SHOWN);
  const shownCount = shown.reduce((sum, row) => sum + row.ids.length, 0);

  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{t('support', { count: supporting.length })}</p>
      {shown.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {shown.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                // One signal opens it; a group opens the Signals tab that lists each.
                onClick={() => (row.ids.length === 1 ? onOpenSignal(row.ids[0]) : onShowAll())}
                className="flex w-full items-baseline gap-2 rounded-md border px-3 py-1.5 text-start text-xs transition-colors hover:bg-muted/40"
              >
                <span className="shrink-0 font-medium">{row.label}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.where}</span>
                {row.ids.length > 1 && (
                  <span
                    className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                    title={t('supportSame', { count: row.ids.length })}
                  >
                    {t('supportTimes', { count: row.ids.length })}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {signals.length > shownCount && (
        <button
          type="button"
          onClick={onShowAll}
          className="mt-2 text-xs font-medium underline-offset-2 hover:underline"
        >
          {t('supportAll', { count: signals.length })}
        </button>
      )}
    </div>
  );
}
