/**
 * positions-range.test.ts  (PROMPT-002)
 *
 * Tests the URL round trip of the Positions panel's own range.
 */

import { describe, expect, test } from 'vitest';
import { parsePositionsRange, positionsUrlParams } from './positions-range';

describe('positionsUrlParams', () => {
  test('a closed panel clears every param', () => {
    expect(
      positionsUrlParams(null, { preset: 'custom', from: '2026-10-01', to: '2026-10-05' }),
    ).toEqual({
      positions: null,
      positionsRange: null,
      positionsFrom: null,
      positionsTo: null,
    });
  });

  test('a preset range keeps only the prompt and the preset', () => {
    expect(positionsUrlParams('p1', { preset: '7d', from: '2026-10-01', to: '' })).toEqual({
      positions: 'p1',
      positionsRange: '7d',
      positionsFrom: null,
      positionsTo: null,
    });
  });

  test('a custom range carries its dates, and omits a missing one', () => {
    expect(positionsUrlParams('p1', { preset: 'custom', from: '2026-10-01', to: '' })).toEqual({
      positions: 'p1',
      positionsRange: 'custom',
      positionsFrom: '2026-10-01',
      positionsTo: null,
    });
  });
});

describe('parsePositionsRange', () => {
  test('reads back what positionsUrlParams wrote', () => {
    const range = { preset: 'custom' as const, from: '2026-10-01', to: '2026-10-05' };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(positionsUrlParams('p1', range))) if (v) params.set(k, v);
    expect(parsePositionsRange(params, '30d')).toEqual(range);
  });

  test('falls back to the table preset when the link has none or an unknown one', () => {
    expect(parsePositionsRange(new URLSearchParams(), '30d')).toEqual({
      preset: '30d',
      from: '',
      to: '',
    });
    expect(parsePositionsRange(new URLSearchParams('positionsRange=1y'), '7d').preset).toBe('7d');
  });
});
