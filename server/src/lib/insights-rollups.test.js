import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
const rpc = vi.fn();
const from = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) },
}));

// The Citations rollups ride on the same callers; their own behavior is
// covered in citations-rollups.test.js.
const refreshCitationsDaily = vi.fn();
const rebuildQueuedCitationRollups = vi.fn();
vi.mock('./citations-rollups.js', () => ({
  refreshCitationsDaily: (...a) => refreshCitationsDaily(...a),
  rebuildQueuedCitationRollups: (...a) => rebuildQueuedCitationRollups(...a),
}));

import {
  refreshInsightsDaily,
  refreshForCompletedRun,
  sweepInsightsRollups,
  utcDay,
  SWEEP_DAYS,
} from './insights-rollups.js';

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  refreshCitationsDaily.mockReset().mockResolvedValue(true);
  rebuildQueuedCitationRollups.mockReset().mockResolvedValue({ rebuilt: 0, failed: 0 });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-21T05:30:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('utcDay', () => {
  it('returns the UTC calendar day of an ISO timestamp', () => {
    expect(utcDay('2026-08-20T23:59:59Z')).toBe('2026-08-20');
    expect(utcDay('2026-08-21T00:00:01Z')).toBe('2026-08-21');
  });

  // A timestamp carrying a positive offset belongs to the previous UTC day —
  // days in the rollup tables are UTC, whatever wrote the string.
  it('normalizes offsets to UTC', () => {
    expect(utcDay('2026-08-21T01:30:00+03:00')).toBe('2026-08-20');
  });

  it('defaults to today (UTC)', () => {
    expect(utcDay()).toBe('2026-08-21');
  });
});

describe('refreshInsightsDaily', () => {
  it('calls the refresh function with the brand and inclusive day range', async () => {
    rpc.mockResolvedValue({ error: null });
    const ok = await refreshInsightsDaily('brand-1', '2026-08-19', '2026-08-21');
    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'brand-1',
      p_day_from: '2026-08-19',
      p_day_to: '2026-08-21',
    });
  });

  // The rollups are derived state: a failed refresh costs freshness until the
  // next sweep, and must never throw into a tracking run's finalize path.
  it('reports failure without throwing', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } });
    await expect(refreshInsightsDaily('brand-1', '2026-08-21', '2026-08-21')).resolves.toBe(false);
  });
});

describe('refreshForCompletedRun', () => {
  it('spans from the run start day through today', async () => {
    rpc.mockResolvedValue({ error: null });
    await refreshForCompletedRun('brand-1', '2026-08-21T03:10:00Z');
    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'brand-1',
      p_day_from: '2026-08-21',
      p_day_to: '2026-08-21',
    });
  });

  // A run that started before UTC midnight lands rows on two calendar days;
  // refreshing only "today" would leave yesterday's tail stale until the
  // sweep.
  it('covers both days of a run that crossed midnight', async () => {
    rpc.mockResolvedValue({ error: null });
    await refreshForCompletedRun('brand-1', '2026-08-20T23:45:00Z');
    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'brand-1',
      p_day_from: '2026-08-20',
      p_day_to: '2026-08-21',
    });
  });

  it('refreshes the Citations rollups for the same days', async () => {
    rpc.mockResolvedValue({ error: null });
    await refreshForCompletedRun('brand-1', '2026-08-20T23:45:00Z');
    expect(refreshCitationsDaily).toHaveBeenCalledWith('brand-1', '2026-08-20', '2026-08-21');
  });
});

describe('sweepInsightsRollups', () => {
  function brandsList(rows, error = null) {
    from.mockReturnValue({ select: () => Promise.resolve({ data: rows, error }) });
  }

  it('refreshes the trailing window for every brand, today included', async () => {
    brandsList([{ id: 'a' }, { id: 'b' }]);
    rpc.mockResolvedValue({ error: null });

    const res = await sweepInsightsRollups();

    expect(res).toEqual({ refreshed: 2, failed: 0 });
    expect(rpc).toHaveBeenCalledTimes(2);
    // SWEEP_DAYS trailing days ending today: 3 days → today-2 .. today.
    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'a',
      p_day_from: '2026-08-19',
      p_day_to: '2026-08-21',
    });
    expect(SWEEP_DAYS).toBe(3);
    expect(refreshCitationsDaily).toHaveBeenCalledWith('b', '2026-08-19', '2026-08-21');
    expect(rebuildQueuedCitationRollups).toHaveBeenCalledTimes(1);
  });

  it('counts a brand whose Citations refresh failed', async () => {
    brandsList([{ id: 'a' }, { id: 'b' }]);
    rpc.mockResolvedValue({ error: null });
    refreshCitationsDaily.mockResolvedValueOnce(false);

    const res = await sweepInsightsRollups();

    expect(res).toEqual({ refreshed: 1, failed: 1 });
  });

  // One brand's failure must not stop the sweep — the whole point of the
  // backstop is that no brand silently stays stale.
  it('keeps sweeping past a failing brand and counts it', async () => {
    brandsList([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    rpc.mockResolvedValueOnce({ error: { message: 'boom' } }).mockResolvedValue({ error: null });

    const res = await sweepInsightsRollups();

    expect(res).toEqual({ refreshed: 2, failed: 1 });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('gives up quietly when the brand list cannot be read', async () => {
    brandsList(null, { message: 'boom' });
    const res = await sweepInsightsRollups();
    expect(res).toEqual({ refreshed: 0, failed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});
