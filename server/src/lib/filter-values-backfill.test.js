import { describe, expect, it, vi } from 'vitest';
import {
  backfillFilterValues,
  FILTER_VALUES_MAX_CALLS,
  filterValuesOptions,
} from './filter-values-backfill.js';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

const BRANDS = [
  { brand_id: A, next_month: null, ready: false },
  { brand_id: B, next_month: null, ready: true },
  { brand_id: C, next_month: '2026-10-01', ready: false },
];

/**
 * A fake rpc: each brand needs `months[brand]` calls to be ready (a ready
 * brand returns at once), recording the backfill calls.
 */
function fakeRpc({ months = { [A]: 3, [C]: 2 }, fail = null, gone = null } = {}) {
  const calls = [];
  const left = { ...months };
  const rpc = vi.fn(async (fn, args) => {
    if (fn === 'brand_filter_values_backfill_brands') return { data: BRANDS, error: null };
    calls.push(args);
    if (args.p_brand_id === gone) {
      return { data: null, error: { code: 'P0002', message: `brand ${gone} not found` } };
    }
    if (fail && args.p_brand_id === fail.brand && calls.length === fail.call) {
      return { data: null, error: { code: 'XX000', message: 'counts don’t match' } };
    }
    left[args.p_brand_id] = (left[args.p_brand_id] ?? 1) - 1;
    const ready = left[args.p_brand_id] <= 0;
    return {
      data: { month_from: '2026-01-01', month_to: '2026-01-01', corrected: 4, ready },
      error: null,
    };
  });
  return { rpc, calls };
}

const run = (rpc, options = {}) =>
  backfillFilterValues({ rpc, pauseMs: 0, log: () => {}, ...options });

const brief = (calls) => calls.map((c) => [c.p_brand_id.slice(-1), c.p_months]);

describe('backfillFilterValues', () => {
  it('walks each brand not yet ready, by the list’s order, until it is ready', async () => {
    const { rpc, calls } = fakeRpc();
    const done = await run(rpc);
    expect(brief(calls)).toEqual([
      ['a', 1],
      ['a', 1],
      ['a', 1],
      ['c', 1],
      ['c', 1],
    ]);
    expect(done).toMatchObject({ brands: 2, ready: 2, calls: 5 });
  });

  it('passes the months per call', async () => {
    const { rpc, calls } = fakeRpc({ months: { [A]: 1, [C]: 1 } });
    await run(rpc, { chunkMonths: 6 });
    expect(brief(calls)).toEqual([
      ['a', 6],
      ['c', 6],
    ]);
  });

  it('runs the brand named, even a ready one (it returns at once)', async () => {
    const { rpc, calls } = fakeRpc();
    await run(rpc, { brand: B });
    expect(brief(calls)).toEqual([['b', 1]]);
    await expect(run(rpc, { brand: 'ffffffff-0000-0000-0000-000000000000' })).rejects.toThrow(
      'no such brand',
    );
  });

  it('skips a brand deleted since the list was read', async () => {
    const { rpc, calls } = fakeRpc({ gone: A });
    const done = await run(rpc);
    expect(brief(calls)).toEqual([
      ['a', 1],
      ['c', 1],
      ['c', 1],
    ]);
    expect(done).toMatchObject({ brands: 2, ready: 1 });
  });

  it('stops at a failed call and says that running it again resumes', async () => {
    const { rpc, calls } = fakeRpc({ fail: { brand: A, call: 2 } });
    await expect(run(rpc)).rejects.toThrow(
      `${A}: counts don’t match\nRun the script again to resume`,
    );
    expect(calls).toHaveLength(2);
  });

  it('gives up on a brand that never gets ready', async () => {
    const { rpc } = fakeRpc({ months: { [A]: Infinity } });
    await expect(run(rpc)).rejects.toThrow(
      `${A}: not ready after ${FILTER_VALUES_MAX_CALLS} calls`,
    );
  });

  it('pauses after each call', async () => {
    const { rpc } = fakeRpc();
    const sleep = vi.fn(async () => {});
    await backfillFilterValues({ rpc, pauseMs: 40, sleep, log: () => {} });
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledWith(40);
  });

  it('only plans on a dry run', async () => {
    const log = vi.fn();
    const { rpc, calls } = fakeRpc();
    await run(rpc, { dryRun: true, log });
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      '2 brand(s) of 3, up to 1 month(s) per call, 0 ms apart (dry run)',
    );
  });

  it('fails when the list can’t be read', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }));
    await expect(run(rpc)).rejects.toThrow(
      'brand_filter_values_backfill_brands: permission denied',
    );
  });
});

describe('filterValuesOptions', () => {
  it('reads the options, with defaults', () => {
    expect(filterValuesOptions([])).toEqual({
      chunkMonths: 1,
      pauseMs: 250,
      brand: null,
      dryRun: false,
    });
    expect(
      filterValuesOptions(['--chunk-months', '3', '--pause-ms', '0', '--brand', A, '--dry-run']),
    ).toEqual({ chunkMonths: 3, pauseMs: 0, brand: A, dryRun: true });
  });

  it('refuses what the backfill function would', () => {
    expect(() => filterValuesOptions(['--chunk-months', '0'])).toThrow('--chunk-months');
    expect(() => filterValuesOptions(['--chunk-months', '25'])).toThrow('--chunk-months');
    expect(() => filterValuesOptions(['--pause-ms', '-1'])).toThrow('--pause-ms');
    expect(() => filterValuesOptions(['--brand', 'Brand A'])).toThrow('--brand');
    expect(() => filterValuesOptions(['--from-day', '2026-01-01'])).toThrow();
  });
});
