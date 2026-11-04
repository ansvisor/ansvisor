'use client';

import { useMemo } from 'react';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox';
import { timeZoneNames, zoneMatches, zoneOffset } from '@/lib/time-zone';

/** The Automatic option's value: no zone of its own (null), the browser's. */
const AUTOMATIC = 'automatic';

export interface TimeZoneOption {
  value: string;
  label: string;
  offset: string;
}

/**
 * The picker's options: Automatic first when offered, then every IANA zone
 * A to Z with its offset now, and `current` when the list doesn't have it
 * (a zone saved from another browser), so it still shows as picked.
 */
export function timeZoneOptions(
  current: string | null,
  automaticLabel: string | null,
  now: Date,
): TimeZoneOption[] {
  const names = timeZoneNames();
  if (current && !names.includes(current)) names.unshift(current);
  const zones = names.map((name) => ({ value: name, label: name, offset: zoneOffset(name, now) }));
  return automaticLabel
    ? [{ value: AUTOMATIC, label: automaticLabel, offset: '' }, ...zones]
    : zones;
}

/**
 * A searchable list of IANA time zones (Settings › Account, a scheduled
 * job's page): type a city, a region or an offset ("new york", "gmt+3").
 * With `automaticLabel`, its first option is Automatic: `value` null.
 */
export function TimeZonePicker({
  id,
  value,
  onChange,
  automaticLabel = null,
  searchPlaceholder,
  emptyText,
  disabled = false,
  now,
  action,
}: {
  id?: string;
  value: string | null;
  onChange: (zone: string | null) => void;
  automaticLabel?: string | null;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  now: Date;
  /** The trigger's data-action, for the product's click events. */
  action?: string;
}) {
  const options = useMemo(
    () => timeZoneOptions(value, automaticLabel, now),
    [value, automaticLabel, now],
  );
  const picked =
    options.find((option) => option.value === (value ?? AUTOMATIC)) ?? options[0] ?? null;

  return (
    <Combobox
      items={options}
      value={picked}
      disabled={disabled}
      filter={(option: TimeZoneOption, query: string) =>
        option.value === AUTOMATIC
          ? zoneMatches(option.label, query)
          : zoneMatches(option.value, query, option.offset)
      }
      onValueChange={(option: TimeZoneOption | null) => {
        if (!option) return;
        const zone = option.value === AUTOMATIC ? null : option.value;
        if (zone !== value) onChange(zone);
      }}
    >
      <ComboboxTrigger id={id} data-action={action} className="w-full" title={picked?.label}>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
          <span className="truncate">{picked?.label}</span>
          {picked?.offset && (
            <span className="shrink-0 text-xs text-muted-foreground">{picked.offset}</span>
          )}
        </span>
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
        <ComboboxList>
          <ComboboxEmpty>{emptyText}</ComboboxEmpty>
          <ComboboxCollection>
            {(option: TimeZoneOption) => (
              <ComboboxItem key={option.value} value={option} title={option.label}>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.offset && (
                  <span className="shrink-0 text-xs text-muted-foreground">{option.offset}</span>
                )}
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
