import { describe, expect, it } from 'vitest';
import type { PlanAddOnsView } from '@/lib/actions/plan-add-ons';
import { trackingValue } from './tracking-value';

const platform = (id: string, unitCents: number, included: number, units = 0) => ({
  id,
  group: 'standard' as const,
  unitCents,
  unitSlots: 100,
  included,
  units,
  inUse: 0,
});
const STANDARD = ['chatgpt-web', 'gemini-web', 'google-aio', 'google-aimode', 'copilot-web'];
const growth = (over: Partial<PlanAddOnsView> = {}) => ({
  planPriceCents: 24900,
  interval: 'month' as const,
  current: { trackingUnits: 0, extraBrands: 0 },
  slots: {
    state: 'open' as const,
    platforms: [...STANDARD.map((id) => platform(id, 1500, 250)), platform('claude-web', 6000, 0)],
  },
  ...over,
});

describe('trackingValue', () => {
  it('gives Growth 37,500 answers a month at $6.64 per 1,000', () => {
    expect(trackingValue(growth())).toEqual({
      slotsPerDay: 1250,
      answersPerMonth: 37_500,
      centsPer1000: 664,
    });
  });

  it('counts the picked slots and their price', () => {
    expect(trackingValue(growth(), { 'claude-web': 1 })).toEqual({
      slotsPerDay: 1350,
      answersPerMonth: 40_500,
      centsPer1000: 763,
    });
  });

  it('takes the volume discount off the slots', () => {
    // 10 × $60 = $600 of slots: 5% off the $100 above $500 → $595.
    const value = trackingValue(growth(), { 'claude-web': 10 })!;
    expect(value.answersPerMonth).toBe(67_500);
    expect(value.centsPer1000).toBe(Math.round(((24_900 + 59_500) / 67_500) * 1000));
  });

  it('spreads a yearly price over twelve months', () => {
    expect(trackingValue(growth({ interval: 'year', planPriceCents: 239_000 }))?.centsPer1000).toBe(
      Math.round((239_000 / (37_500 * 12)) * 1000),
    );
  });

  it('says nothing it can’t tell honestly', () => {
    expect(trackingValue(growth({ slots: null }))).toBeNull();
    expect(trackingValue(growth({ planPriceCents: null }))).toBeNull();
    expect(trackingValue(growth({ current: { trackingUnits: 100, extraBrands: 0 } }))).toBeNull();
    expect(
      trackingValue(
        growth({ slots: { state: 'open', platforms: [platform('chatgpt-web', 1500, -1)] } }),
      ),
    ).toBeNull();
  });
});
