/**
 * The Positions panel's own range (PROMPT-002) and its URL mirror, so an open
 * panel can be shared: ?positions=<promptId>&positionsRange=7d, plus
 * positionsFrom / positionsTo for a custom range.
 */

import { isPromptRangePreset, type PromptRangePreset } from '@/config/prompt-options';

/** The panel's own window choice; `from` / `to` are YYYY-MM-DD and only used by custom. */
export interface PositionsRange {
  preset: PromptRangePreset;
  from: string;
  to: string;
}

/** URL params that mirror an open panel; null removes the param. */
export function positionsUrlParams(
  promptId: string | null,
  range: PositionsRange,
): Record<'positions' | 'positionsRange' | 'positionsFrom' | 'positionsTo', string | null> {
  const custom = promptId !== null && range.preset === 'custom';
  return {
    positions: promptId,
    positionsRange: promptId ? range.preset : null,
    positionsFrom: custom && range.from ? range.from : null,
    positionsTo: custom && range.to ? range.to : null,
  };
}

/** The panel range a shared link asks for, falling back to the table's preset. */
export function parsePositionsRange(
  params: { get(name: string): string | null },
  fallback: PromptRangePreset,
): PositionsRange {
  const raw = params.get('positionsRange');
  return {
    preset: isPromptRangePreset(raw) ? raw : fallback,
    from: params.get('positionsFrom') ?? '',
    to: params.get('positionsTo') ?? '',
  };
}
