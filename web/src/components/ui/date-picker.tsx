'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  addDays,
  addMonths,
  clampDay,
  inRange,
  isDay,
  monthGrid,
  startOfWeek,
  today as todayOf,
  weekStartOf,
} from '@/lib/date-grid';
import { cn } from '@/lib/utils';

/**
 * The app's own date picker (UX audit AC-25), in place of the browser's
 * `<input type="date">`, whose look and language follow the browser rather
 * than the app. A button shows the day in the app's language; it opens a
 * month grid on Base UI's Popover:
 *
 *   * the arrow keys move a day (left and right follow the reading
 *     direction) or a week, Home and End to the week's ends, Page Up and
 *     Page Down a month (with Shift, a year), Enter or Space picks the day,
 *     Esc closes;
 *   * the month and weekday names come from Intl in the app's locale, and the
 *     week starts as the locale's does;
 *   * days outside `min`…`max` can't be picked; Today and Clear (when
 *     `clearable`) sit under the grid.
 *
 * Days are "YYYY-MM-DD" strings, as the input and the database's `date`
 * columns hold them; null is no day.
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  clearable = false,
  disabled = false,
  placeholder,
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'data-action': dataAction,
}: {
  id?: string;
  value: string | null;
  onChange: (day: string | null) => void;
  min?: string;
  max?: string;
  clearable?: boolean;
  disabled?: boolean;
  /** Shown without a day; "Pick a date" by default. */
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** The button's data-action, for analytics and tests. */
  'data-action'?: string;
}) {
  const t = useTranslations('datePicker');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const picked = isDay(value) ? value : null;
  const [focus, setFocus] = useState(() => clampDay(picked ?? todayOf(), min, max));
  const grid = useRef<HTMLDivElement>(null);

  const weekStart = useMemo(() => weekStartOf(locale), [locale]);
  const format = useMemo(() => {
    const at = (day: string) => new Date(`${day}T00:00:00Z`);
    const shown = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
    const full = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
    const month = new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    const dayNo = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' });
    return {
      shown: (day: string) => shown.format(at(day)),
      full: (day: string) => full.format(at(day)),
      month: (day: string) => month.format(at(day)),
      weekday: (day: string) => weekday.format(at(day)),
      dayNo: (day: string) => dayNo.format(at(day)),
    };
  }, [locale]);

  // Opening starts on the picked day, else today, within the range.
  const openChange = (next: boolean) => {
    if (next) setFocus(clampDay(picked ?? todayOf(), min, max));
    setOpen(next);
  };

  // The focused day takes the keyboard focus as it moves.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, focus]);

  const pick = (day: string | null) => {
    if (day && !inRange(day, min, max)) return;
    onChange(day);
    setOpen(false);
  };

  const move = (day: string) => setFocus(clampDay(day, min, max));

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = rtl ? -1 : 1;
    const keys: Record<string, () => string> = {
      ArrowRight: () => addDays(focus, step),
      ArrowLeft: () => addDays(focus, -step),
      ArrowDown: () => addDays(focus, 7),
      ArrowUp: () => addDays(focus, -7),
      Home: () => startOfWeek(focus, weekStart),
      End: () => addDays(startOfWeek(focus, weekStart), 6),
      PageDown: () => addMonths(focus, event.shiftKey ? 12 : 1),
      PageUp: () => addMonths(focus, event.shiftKey ? -12 : -1),
    };
    if (keys[event.key]) {
      event.preventDefault();
      move(keys[event.key]());
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(focus);
    }
  };

  const weeks = monthGrid(focus, weekStart);
  const today = todayOf();
  const label = picked ? format.shown(picked) : (placeholder ?? t('placeholder'));

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        data-slot="date-picker"
        data-value={picked ?? ''}
        data-action={dataAction}
        aria-label={ariaLabel ? `${ariaLabel}: ${label}` : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-start text-xs outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
          !picked && 'text-muted-foreground',
          className,
        )}
      >
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            data-action="datePicker.previousMonth"
            aria-label={t('previousMonth')}
            onClick={() => move(addMonths(focus, -1))}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          </button>
          <span className="text-sm font-medium" aria-live="polite" data-slot="date-picker-month">
            {format.month(focus)}
          </span>
          <button
            type="button"
            data-action="datePicker.nextMonth"
            aria-label={t('nextMonth')}
            onClick={() => move(addMonths(focus, 1))}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </button>
        </div>
        <div
          ref={grid}
          role="grid"
          aria-label={format.month(focus)}
          onKeyDown={onKey}
          className="grid gap-0.5"
        >
          <div role="row" className="grid grid-cols-7 gap-0.5">
            {weeks[0].map(({ day }) => (
              <span
                key={day}
                role="columnheader"
                className="flex h-7 items-center justify-center text-[11px] text-muted-foreground"
              >
                {format.weekday(day)}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0].day} role="row" className="grid grid-cols-7 gap-0.5">
              {week.map(({ day, inMonth }) => {
                const allowed = inRange(day, min, max);
                const selected = day === picked;
                return (
                  <div key={day} role="gridcell" aria-selected={selected}>
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focus ? 0 : -1}
                      aria-label={format.full(day)}
                      aria-current={day === today ? 'date' : undefined}
                      aria-disabled={!allowed || undefined}
                      onClick={() => pick(day)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-md text-xs tabular-nums outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                        !inMonth && 'text-muted-foreground/60',
                        day === today && !selected && 'font-semibold text-foreground',
                        selected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                        !allowed && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                      )}
                    >
                      {format.dayNo(day)}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <button
            type="button"
            data-action="datePicker.today"
            disabled={!inRange(today, min, max)}
            onClick={() => pick(today)}
            className="rounded-md px-2 py-1 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
          >
            {t('today')}
          </button>
          {clearable && picked && (
            <button
              type="button"
              data-action="datePicker.clear"
              onClick={() => pick(null)}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t('clear')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
