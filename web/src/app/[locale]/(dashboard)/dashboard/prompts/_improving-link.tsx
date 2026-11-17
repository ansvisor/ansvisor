'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp } from 'lucide-react';
import { getImprovingPrompts } from '@/lib/actions/prompt-positions';
import { actionCode } from '@/lib/action-center/action-ref';
import type { ImprovingAction } from '@/lib/improve-outcome';

/**
 * The Improve actions still being tracked (PROMPT-008), by prompt id: what
 * the table's own read brought (`seed`, every prompt of the brand, so the
 * links come with the rows and no read waits for them), and after the
 * positions panel closes, one read of the rows on screen, so an Improve sent
 * from the panel shows on its row. A newer table read (a new `seed`) wins.
 * A failed re-read leaves the seed as it was.
 */
export function useImprovingPrompts(
  brandId: string,
  promptIds: readonly string[],
  panelOpen: boolean,
  seed: Record<string, ImprovingAction>,
): Record<string, ImprovingAction> {
  // The rows on screen, and the seed then, when the panel closed: read then, and only then.
  const [asked, setAsked] = useState<{
    ids: string[];
    seed: Record<string, ImprovingAction>;
  } | null>(null);
  const [wasOpen, setWasOpen] = useState(panelOpen);
  if (wasOpen !== panelOpen) {
    setWasOpen(panelOpen);
    if (!panelOpen) setAsked({ ids: [...promptIds], seed });
  }
  const [reread, setReread] = useState<{
    brandId: string;
    seed: Record<string, ImprovingAction>;
    ids: string[];
    byPrompt: Record<string, ImprovingAction>;
  } | null>(null);
  useEffect(() => {
    if (!asked || !brandId || asked.ids.length === 0) return;
    let cancelled = false;
    getImprovingPrompts(brandId, asked.ids)
      .then((byPrompt) => {
        if (!cancelled) setReread({ brandId, seed: asked.seed, ids: asked.ids, byPrompt });
      })
      .catch((err) => console.error('Failed to read the Improve actions:', err));
    return () => {
      cancelled = true;
    };
  }, [brandId, asked]);
  return useMemo(() => {
    if (!reread || reread.brandId !== brandId || reread.seed !== seed) return seed;
    const merged = { ...seed };
    for (const id of reread.ids) delete merged[id];
    return { ...merged, ...reread.byPrompt };
  }, [reread, seed, brandId]);
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
