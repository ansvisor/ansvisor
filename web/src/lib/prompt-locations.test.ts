import { describe, it, expect } from 'vitest';
import {
  promptLocationCount,
  summarizeLocationRows,
  locationLimitMessage,
} from './prompt-locations';
import { PLANS } from '@/config/plans';

const starter = PLANS.starter; // maxPrompts: 50
const selfHosted = PLANS.self_hosted; // maxPrompts: -1
const enterprise = PLANS.enterprise; // maxPrompts: -1

describe('promptLocationCount', () => {
  it('counts one location per region entry', () => {
    expect(promptLocationCount(['US'])).toBe(1);
    expect(promptLocationCount(['US', 'DE', 'TR'])).toBe(3);
  });

  it('costs one for prompts with no regions — the worker still runs them once', () => {
    expect(promptLocationCount([])).toBe(1);
    expect(promptLocationCount(null)).toBe(1);
    expect(promptLocationCount(undefined)).toBe(1);
  });
});

describe('summarizeLocationRows', () => {
  it('totals the per-brand rows the RPC returns', () => {
    const usage = summarizeLocationRows([
      { brand_id: 'a', locations: 3 },
      { brand_id: 'b', locations: 1 },
    ]);
    expect(usage.total).toBe(4);
    expect(usage.byBrand.get('a')).toBe(3);
    expect(usage.byBrand.get('b')).toBe(1);
  });

  it('returns zero usage for no rows', () => {
    const usage = summarizeLocationRows([]);
    expect(usage.total).toBe(0);
    expect(usage.byBrand.size).toBe(0);
  });
});

describe('locationLimitMessage', () => {
  it('never rejects on the -1 sentinel (self-host and enterprise stay unmetered)', () => {
    expect(locationLimitMessage(selfHosted, 10_000, 500)).toBeNull();
    expect(locationLimitMessage(enterprise, 10_000, 500)).toBeNull();
  });

  it('allows landing exactly on the limit (inclusive cap)', () => {
    expect(locationLimitMessage(starter, 49, 1)).toBeNull();
    expect(locationLimitMessage(starter, 0, 50)).toBeNull();
  });

  it('rejects the first location past the limit', () => {
    expect(locationLimitMessage(starter, 50, 1)).not.toBeNull();
    expect(locationLimitMessage(starter, 49, 2)).not.toBeNull();
  });

  it('measures the delta, not one: a multi-location add near the limit is rejected', () => {
    // 48 used + a prompt targeting 3 locations = 51 > 50, even though a
    // row-count check (48 < 50) would have let it through.
    expect(locationLimitMessage(starter, 48, 3)).not.toBeNull();
  });

  it('always allows changes that add nothing, even over the limit', () => {
    // Re-saving unchanged at the cap, or after a plan downgrade left the org
    // over its limit, must not brick the existing set.
    expect(locationLimitMessage(starter, 50, 0)).toBeNull();
    expect(locationLimitMessage(starter, 120, 0)).toBeNull();
    expect(locationLimitMessage(starter, 120, -5)).toBeNull();
  });

  it('spells out the location math in the message', () => {
    const msg = locationLimitMessage(starter, 48, 5);
    expect(msg).toContain('50 tracked prompt locations');
    expect(msg).toContain('53');
    expect(msg).toContain('48 in place + 5 added');
    expect(msg).toContain('Remove 3 locations');
  });

  it('uses singular grammar for a single excess location', () => {
    expect(locationLimitMessage(starter, 50, 1)).toContain('Remove 1 location ');
  });
});
