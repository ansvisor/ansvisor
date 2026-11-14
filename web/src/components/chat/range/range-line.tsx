'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { rangeWords } from '@/lib/chat/range';
import { RangeChoices, useRangeT } from './range-picker';
import { useChatRange } from './use-chat-range';

/**
 * The range Chat reads, as a chip above the message box (owner request
 * 2026-11-11; a chip in the context row since 2026-11-14): "Last 30 days ×",
 * or a dashed "Add date range" before the first pick, which Chat asks for
 * before the first analysis. The chip opens the ranges; a pick is the
 * person's default at once, in every chat and beside every page. × clears it,
 * as Settings' "Ask me before the first analysis" does. Hidden when it can't
 * be read (the new Chat off).
 */
export function RangeChip({ running = false }: { running?: boolean }) {
  const t = useTranslations('chatRange');
  const say = useRangeT();
  const { range, available, save } = useChatRange(running);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  const keep = async (next: Parameters<typeof save>[0]) => {
    setBusy(true);
    const kept = await save(next);
    setBusy(false);
    if (kept) setOpen(false);
  };
  const words = range ? rangeWords(range, say) : null;
  return (
    <span
      data-slot="composer-range"
      className={
        words
          ? 'inline-flex h-[22px] items-center gap-0.5 rounded-[7px] border bg-muted/60 pr-1 text-[11.5px] text-foreground/80'
          : 'inline-flex'
      }
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-action="composer.changeRange"
          aria-label={words ? t('chipLabel', { range: words }) : undefined}
          title={t('lineTitle')}
          className={
            words
              ? 'inline-flex h-full items-center gap-1 rounded-l-[7px] pl-[7px] whitespace-nowrap hover:text-foreground'
              : 'inline-flex h-[22px] items-center gap-1 rounded-[7px] border border-dashed px-[7px] text-[11.5px] whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted'
          }
        >
          {words ? (
            <CalendarDays className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Plus className="size-3 shrink-0" aria-hidden />
          )}
          {words ?? t('add')}
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
          <PopoverTitle className="mb-2 text-[13px]">{t('menuLabel')}</PopoverTitle>
          <RangeChoices value={range} busy={busy} onPick={(picked) => void keep(picked)} />
        </PopoverContent>
      </Popover>
      {words && (
        <button
          type="button"
          data-action="composer.clearRange"
          disabled={busy}
          onClick={() => void keep(null)}
          aria-label={t('clear')}
          title={t('clear')}
          className="inline-flex size-4 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          ×
        </button>
      )}
    </span>
  );
}
