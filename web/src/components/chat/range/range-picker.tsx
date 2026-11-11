'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  RANGE_PRESETS,
  customDays,
  isRangePreset,
  parseRange,
  rangeWords,
  type ChatRange,
  type RangeT,
} from '@/lib/chat/range';
import { cn } from '@/lib/utils';

/** The `chatRange` messages as range.ts reads them. */
export function useRangeT(): RangeT {
  const t = useTranslations('chatRange');
  return (key, values) => t(key as never, values as never);
}

/** Today, as the date fields' last day: the UTC day, as the app's presets cut them. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Custom: two days, the first and the last, neither after today (the date
 * control's own fields, components/filters/date-range-filter.tsx). "Use
 * these dates" waits until they make a range.
 */
export function CustomRangeFields({
  initial,
  busy = false,
  action,
  onUse,
  className,
}: {
  initial?: { from: string; to: string } | null;
  busy?: boolean;
  /** The Use button's data-action id. */
  action: string;
  onUse: (range: ChatRange) => void;
  className?: string;
}) {
  const t = useTranslations('chatRange');
  const id = useId();
  const [from, setFrom] = useState(initial?.from ?? '');
  const [to, setTo] = useState(initial?.to ?? '');
  const range = from && to ? parseRange(`${from}/${to}`, new Date()) : null;
  const max = today();
  return (
    <div className={cn('flex flex-wrap items-end gap-2', className)} data-slot="range-custom">
      <div>
        <label htmlFor={`${id}-from`} className="mb-1 block text-xs text-muted-foreground">
          {t('from')}
        </label>
        <Input
          id={`${id}-from`}
          type="date"
          value={from}
          max={to || max}
          disabled={busy}
          onChange={(event) => setFrom(event.target.value)}
          className="h-8 w-36 text-xs"
        />
      </div>
      <div>
        <label htmlFor={`${id}-to`} className="mb-1 block text-xs text-muted-foreground">
          {t('to')}
        </label>
        <Input
          id={`${id}-to`}
          type="date"
          value={to}
          min={from || undefined}
          max={max}
          disabled={busy}
          onChange={(event) => setTo(event.target.value)}
          className="h-8 w-36 text-xs"
        />
      </div>
      <Button
        type="button"
        size="sm"
        data-action={action}
        disabled={busy || !range}
        onClick={() => range && onUse(range)}
      >
        {t('useDates')}
      </Button>
      {from && to && !range && (
        <p role="alert" className="m-0 w-full text-xs text-red-700 dark:text-red-300">
          {t('datesInvalid')}
        </p>
      )}
    </div>
  );
}

/**
 * The ranges to pick from (the line under the box, Chat Settings): the four
 * presets as the app's date control has them, then Custom's two days. The
 * one in use is pressed; a click keeps it.
 */
export function RangeChoices({
  value,
  busy = false,
  onPick,
}: {
  value: ChatRange | null;
  busy?: boolean;
  onPick: (range: ChatRange) => void;
}) {
  const t = useTranslations('chatRange');
  const say = useRangeT();
  const custom = value ? customDays(value) : null;
  const [customOpen, setCustomOpen] = useState(!!custom);
  return (
    <div className="grid gap-2" data-slot="range-choices">
      <div role="group" aria-label={t('menuLabel')} className="flex flex-wrap gap-1.5">
        {RANGE_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            size="sm"
            variant={value === preset ? 'default' : 'outline'}
            aria-pressed={value === preset}
            data-action="range.pick"
            disabled={busy}
            onClick={() => onPick(preset)}
          >
            {rangeWords(preset, say)}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={value && !isRangePreset(value) ? 'default' : 'outline'}
          aria-pressed={!!value && !isRangePreset(value)}
          aria-expanded={customOpen}
          data-action="range.custom"
          disabled={busy}
          onClick={() => setCustomOpen((open) => !open)}
        >
          {custom ? rangeWords(value!, say) : t('customButton')}
        </Button>
      </div>
      {customOpen && (
        <CustomRangeFields initial={custom} busy={busy} action="range.useDates" onUse={onPick} />
      )}
    </div>
  );
}
