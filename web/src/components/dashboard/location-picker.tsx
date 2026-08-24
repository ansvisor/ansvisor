'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';

import { REGIONS, US_STATES } from '@/config/prompt-options';
import { formatRegionDisplay, locationCode, parseLocation } from '@/lib/region';
import { Badge } from '@/components/ui/badge';
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

interface LocationOption {
  value: string;
  /** What base-ui filters the search box against. */
  label: string;
  sublabel: string;
}

export interface LocationPickerProps {
  value: string[];
  onChange: (locations: string[]) => void;
  /**
   * Most locations this prompt may hold before the org hits its plan cap —
   * null when the plan is unlimited. The caller derives it from org usage so
   * the picker can refuse a pick with a reason instead of letting the save
   * fail afterwards.
   */
  maxSelectable: number | null;
  /** Engines the prompt runs, to warn where state targeting doesn't apply. */
  platforms?: string[];
}

/** Engines with no sub-country mechanism — mirrors the worker's collapse. */
const COUNTRY_ONLY_PLATFORMS = new Set(['google-aio', 'google-aimode']);

/**
 * Per-prompt tracking locations (#691).
 *
 * Follows the card's existing "add, then chip" idiom (the Platform & Models
 * picker): the list adds, the chips below remove. It is a Combobox rather
 * than a Select because the list is 18 countries plus 50 states — long
 * enough that scrolling to a known name is worse than typing it.
 *
 * Two things this picker must say out loud, because both cost money or
 * mislead if left implicit: every location is a plan-quota unit (the trigger
 * carries the count, and picks stop at the cap with the reason on screen),
 * and Google's engines have no state targeting, so a state pick runs them
 * country-wide instead of twice.
 */
export function LocationPicker({ value, onChange, maxSelectable, platforms }: LocationPickerProps) {
  const options = useMemo<LocationOption[]>(
    () => [
      ...REGIONS.map((region) => ({
        value: region.code,
        label: region.label,
        sublabel: 'Country',
      })),
      ...US_STATES.map((state) => ({
        value: locationCode('US', state.code),
        label: state.label,
        sublabel: 'United States · state',
      })),
    ],
    [],
  );

  const selected = new Set(value);
  const atCap = maxSelectable !== null && value.length >= maxSelectable;

  // A prompt with no location cannot be tracked, so the last chip keeps its
  // remove control hidden rather than failing server-side.
  const canRemove = value.length > 1;

  const hasStatePick = value.some((code) => parseLocation(code)?.state);
  const countryOnlyEngines = (platforms ?? []).filter((id) => COUNTRY_ONLY_PLATFORMS.has(id));
  const showCountryOnlyNote = hasStatePick && countryOnlyEngines.length > 0;

  const add = (option: LocationOption | null) => {
    if (!option || selected.has(option.value) || atCap) return;
    onChange([...value, option.value]);
  };

  const remove = (code: string) => {
    if (!canRemove) return;
    onChange(value.filter((entry) => entry !== code));
  };

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        Locations
        <span className="ml-1 font-normal">
          {maxSelectable === null
            ? `· ${value.length} tracked`
            : `· ${value.length} of ${maxSelectable} available`}
        </span>
      </label>

      <Combobox items={options} value={null} onValueChange={add}>
        <ComboboxTrigger className="w-full">
          <span className="truncate text-muted-foreground">
            {atCap ? 'Plan limit reached' : 'Add a country or US state'}
          </span>
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput placeholder="Search locations…" />
          <ComboboxList>
            <ComboboxEmpty>No locations match.</ComboboxEmpty>
            <ComboboxCollection>
              {(option: LocationOption) => (
                <ComboboxItem
                  key={option.value}
                  value={option}
                  disabled={selected.has(option.value) || atCap}
                >
                  <div>
                    <div>{formatRegionDisplay(option.value)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {selected.has(option.value)
                        ? 'Already tracked'
                        : atCap
                          ? 'Plan limit reached — remove a location or upgrade'
                          : option.sublabel}
                    </div>
                  </div>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {value.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {value.map((code) => (
            <Badge key={code} variant="outline" className="gap-1 text-xs">
              {formatRegionDisplay(code)}
              {canRemove && (
                <button type="button" onClick={() => remove(code)} aria-label={`Remove ${code}`}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}

      {showCountryOnlyNote && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Google AI Overview and AI Mode have no state-level targeting — they run once per country,
          so your state picks cost one location each but are answered country-wide there.
        </p>
      )}
    </div>
  );
}
