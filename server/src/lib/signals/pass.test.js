import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { from: (...a) => from(...a) } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const recordSignalsForBrand = vi.fn();
const generateActionsForBrand = vi.fn();
vi.mock('./record.js', () => ({ recordSignalsForBrand: (...a) => recordSignalsForBrand(...a) }));
vi.mock('../action-center/generate.js', () => ({
  generateActionsForBrand: (...a) => generateActionsForBrand(...a),
}));

import { runSignalCatchUp, runSignalPass } from './pass.js';

const BRAND = 'brand-1';
const NOW = new Date('2026-09-25T06:00:00Z');
const RUN_AT = '2026-09-25T02:13:00.000Z';

/**
 * Enough PostgREST to drive the pass: `tracking_runs` and `signal_runs`
 * answer from the fixtures, and every write is recorded.
 */
function mockDb({ runs = [], passes = [] } = {}) {
  const writes = [];
  from.mockImplementation((table) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      upsert: (row) => {
        writes.push({ table, row });
        return Promise.resolve({ error: null });
      },
      then: (resolve, reject) => {
        const data = table === 'tracking_runs' ? runs : table === 'signal_runs' ? passes : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  });
  return writes;
}

beforeEach(() => {
  from.mockReset();
  recordSignalsForBrand.mockReset();
  generateActionsForBrand.mockReset();
  recordSignalsForBrand.mockResolvedValue({ inserted: 2, refreshed: 1 });
  generateActionsForBrand.mockResolvedValue({ created: 1, refreshed: 0 });
});

describe('runSignalPass', () => {
  it('records signals, generates actions, and logs the pass against the run', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });

    const result = await runSignalPass(BRAND, { now: NOW });

    expect(recordSignalsForBrand).toHaveBeenCalledOnce();
    expect(generateActionsForBrand).toHaveBeenCalledOnce();
    expect(result.trackingRunAt).toBe(RUN_AT);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      table: 'signal_runs',
      row: { brand_id: BRAND, tracking_run_at: RUN_AT, outcome: 'recorded' },
    });
  });

  /**
   * The row is the whole point of the ledger: written only when the pass
   * finished, so a pass that threw is exactly what the sweep can find.
   */
  it('logs nothing when recording throws, so the sweep can find the night', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockRejectedValue(new Error('canceling statement due to timeout'));

    await expect(runSignalPass(BRAND, { now: NOW })).rejects.toThrow(/timeout/);

    expect(writes).toHaveLength(0);
  });

  it('logs nothing when action generation throws', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    generateActionsForBrand.mockRejectedValue(new Error('boom'));

    await expect(runSignalPass(BRAND, { now: NOW })).rejects.toThrow('boom');

    expect(writes).toHaveLength(0);
  });

  /**
   * A run with no fresh results is a decision, not a failure — recording it
   * stops the sweep from retrying the same empty night every morning.
   */
  it('logs a deliberate skip and does not generate actions', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockResolvedValue({ skipped: 'no_fresh_results' });

    await runSignalPass(BRAND, { now: NOW });

    expect(generateActionsForBrand).not.toHaveBeenCalled();
    expect(writes[0].row.outcome).toBe('skipped');
  });

  it('does nothing for a brand whose nightly run has never stamped', async () => {
    const writes = mockDb({ runs: [] });

    const result = await runSignalPass(BRAND, { now: NOW });

    expect(result).toEqual({ skipped: 'no_stamped_run' });
    expect(recordSignalsForBrand).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('runSignalCatchUp', () => {
  it('re-runs a brand whose run stamped but whose pass never finished', async () => {
    const writes = mockDb({ runs: [{ brand_id: BRAND, completed_at: RUN_AT }], passes: [] });

    const summary = await runSignalCatchUp({ now: NOW });

    expect(summary).toMatchObject({ recovered: 1, healthy: 0, failed: 0 });
    expect(writes).toHaveLength(1);
  });

  it('leaves a brand alone once its pass is logged', async () => {
    const writes = mockDb({
      runs: [{ brand_id: BRAND, completed_at: RUN_AT }],
      passes: [{ brand_id: BRAND, tracking_run_at: RUN_AT }],
    });

    const summary = await runSignalCatchUp({ now: NOW });

    expect(summary).toMatchObject({ recovered: 0, healthy: 1 });
    expect(recordSignalsForBrand).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  /** One brand's timeout must not cost every brand behind it in the loop. */
  it('carries on past a brand that fails', async () => {
    mockDb({
      runs: [
        { brand_id: 'big', completed_at: RUN_AT },
        { brand_id: 'small', completed_at: RUN_AT },
      ],
    });
    recordSignalsForBrand.mockImplementation((brandId) =>
      brandId === 'big' ? Promise.reject(new Error('statement timeout')) : Promise.resolve({}),
    );

    const summary = await runSignalCatchUp({ now: NOW });

    expect(summary).toMatchObject({ recovered: 1, failed: 1 });
    expect(recordSignalsForBrand).toHaveBeenCalledTimes(2);
  });

  it('considers only the newest run per brand', async () => {
    mockDb({
      runs: [
        { brand_id: BRAND, completed_at: RUN_AT },
        { brand_id: BRAND, completed_at: '2026-09-24T02:10:00.000Z' },
      ],
    });

    const summary = await runSignalCatchUp({ now: NOW });

    expect(summary.recovered).toBe(1);
  });

  it('reports rather than throws when the sweep itself fails', async () => {
    from.mockImplementation(() => {
      throw new Error('connection refused');
    });

    expect(await runSignalCatchUp({ now: NOW })).toEqual({ error: true });
  });
});
