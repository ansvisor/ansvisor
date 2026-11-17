'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';
import { getImprovingPrompts } from '@/lib/actions/prompt-positions';
import { actionCode } from '@/lib/action-center/action-ref';
import type { ImprovingAction } from '@/lib/improve-outcome';

const NONE: Record<string, ImprovingAction> = {};

/**
 * The Improve actions still being tracked for the rows on screen (PROMPT-008),
 * by prompt id: one read for the whole page of rows, by the panel's rule.
 * Read again when the positions panel closes, so an Improve sent from it
 * shows on its row. Nothing until read, or when the read fails: the rows
 * look as they always did.
 */
export function useImprovingPrompts(
  brandId: string,
  promptIds: readonly string[],
  panelOpen: boolean,
): Record<string, ImprovingAction> {
  const [reads, setReads] = useState(0);
  const [wasOpen, setWasOpen] = useState(panelOpen);
  if (wasOpen !== panelOpen) {
    setWasOpen(panelOpen);
    if (!panelOpen) setReads((n) => n + 1);
  }
  // The same rows in another order need no new read.
  const ids = [...promptIds].sort().join(',');
  const [loaded, setLoaded] = useState<{
    key: string;
    byPrompt: Record<string, ImprovingAction>;
  } | null>(null);
  useEffect(() => {
    if (!brandId || !ids) return;
    let cancelled = false;
    const key = `${brandId}|${ids}`;
    getImprovingPrompts(brandId, ids.split(','))
      .then((byPrompt) => {
        if (!cancelled) setLoaded({ key, byPrompt });
      })
      .catch((err) => console.error('Failed to read the Improve actions:', err));
    return () => {
      cancelled = true;
    };
  }, [brandId, ids, reads]);
  // Another brand's or page's answer never shows; a re-read keeps this one up meanwhile.
  return loaded?.key === `${brandId}|${ids}` ? loaded.byPrompt : NONE;
}

/**
 * "AC-12 · Improving" under a row's Work chip: opens the prompt's positions
 * panel on its Improve tab. Wraps under the chip rather than widening the column.
 */
export function ImprovingLink({ action, onOpen }: { action: ImprovingAction; onOpen: () => void }) {
  const t = useTranslations('prompts.columns.improving');
  const code = actionCode(action);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('aria', { code })}
      title={t('title', { code })}
      className="inline-flex max-w-24 items-center justify-center gap-0.5 rounded-sm text-center text-[10px] leading-tight font-medium whitespace-normal text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
      <span>{t('label', { code })}</span>
    </button>
  );
}
