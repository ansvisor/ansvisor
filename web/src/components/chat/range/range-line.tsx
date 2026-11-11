'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { rangeWords } from '@/lib/chat/range';
import { RangeChoices, useRangeT } from './range-picker';
import { useChatRange } from './use-chat-range';

/**
 * The range Chat reads, under the message box (owner request 2026-11-11):
 * "Range: last 30 days · change", or "Range: not set yet · choose" before
 * the first pick, which Chat asks for before the first analysis. change
 * opens the ranges; a pick is the person's default at once, in every chat
 * and beside every page. Hidden when it can't be read (the new Chat off).
 */
export function RangeLine({ running = false }: { running?: boolean }) {
  const t = useTranslations('chatRange');
  const say = useRangeT();
  const { range, available, save } = useChatRange(running);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  return (
    <span data-slot="composer-range" className="inline-flex items-center gap-1 whitespace-nowrap">
      <span title={t('lineTitle')}>
        {range ? rangeWords(range, say, { as: 'line' }) : t('lineNotSet')}
      </span>
      <span aria-hidden>·</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-action="composer.changeRange"
          aria-label={t('menuLabel')}
          className="rounded-[5px] px-0.5 text-foreground underline underline-offset-2 hover:bg-muted aria-expanded:bg-muted"
        >
          {range ? t('change') : t('choose')}
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
          <PopoverTitle className="mb-2 text-[13px]">{t('menuLabel')}</PopoverTitle>
          <RangeChoices
            value={range}
            busy={busy}
            onPick={async (picked) => {
              setBusy(true);
              const kept = await save(picked);
              setBusy(false);
              if (kept) setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}
