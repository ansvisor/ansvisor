import { describe, expect, it, vi } from 'vitest';

// The day helpers' modules reach the supabase admin client at import time,
// whose config hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));

const { backfillFastRollups, backfillOptions, brandChunks, PACKED_TERMS } =
  await import('./fast-rollups-backfill.js');

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const TODAY = '2026-11-12';

/** A fake rpc over these ranges, recording the backfill calls. */
function fakeRpc(ranges, { failOn = null } = {}) {
  const calls = [];
  const rpc = vi.fn(async (fn, args) => {
    if (fn === 'fast_rollups_backfill_ranges') return { data: ranges, error: null };
    calls.push(args);
    if (failOn && args.p_brand_id === failOn.brand && args.p_day_from === failOn.from) {
      return { data: null, error: { message: 'canceling statement due to statement timeout' } };
    }
    return { data: { prompt_rows: 1, competitor_rows: 2, term_rows: 3 }, error: null };
  });
  return { rpc, calls };
}

const run = (rpc, options = {}) =>
  backfillFastRollups({ rpc, pauseMs: 0, today: TODAY, log: () => {}, ...options });

const brief = (calls) =>
  calls.map((c) => [c.p_brand_id.slice(-1), c.p_day_from, c.p_day_to, c.p_mark_ready]);

describe('brandChunks', () => {
  it('chunks the days and runs the last chunk through today', () => {
    expect(
      brandChunks({ dayFrom: '2026-10-01', dayTo: '2026-10-20', chunkDays: 14, today: TODAY }),
    ).toEqual([
      ['2026-10-01', '2026-10-14'],
      ['2026-10-15', TODAY],
    ]);
  });
});

describe('backfillFastRollups', () => {
  const ranges = [
    { brand_id: A, day_from: '2026-10-20', day_to: '2026-11-12', ready: false },
    { brand_id: B, day_from: '2026-11-01', day_to: '2026-11-12', ready: true },
    { brand_id: C, day_from: '2026-11-05', day_to: '2026-11-11', ready: false },
  ];

  it('fills each brand not yet ready, whole, and lists it ready with its last chunk only', async () => {
    const { rpc, calls } = fakeRpc(ranges);
    const done = await run(rpc);
    expect(brief(calls)).toEqual([
      ['a', '2026-10-20', '2026-11-02', false],
      ['a', '2026-11-03', TODAY, true],
      ['c', '2026-11-05', TODAY, true],
    ]);
    expect(done).toMatchObject({ brands: 2, chunks: 3 });
  });

  it('fills a brand named with --brand even when it is ready', async () => {
    const { rpc, calls } = fakeRpc(ranges);
    await run(rpc, { brand: B });
    expect(brief(calls)).toEqual([['b', '2026-11-01', TODAY, true]]);
  });

  it('re-runs every brand’s last days, ready or not, and lists none ready', async () => {
    const { rpc, calls } = fakeRpc([
      ...ranges,
      // Nothing since: nothing a refresh rewrote.
      {
        brand_id: 'ffffffff-0000-0000-0000-000000000000',
        day_from: '2026-01-01',
        day_to: '2026-03-01',
        ready: true,
      },
    ]);
    await run(rpc, { lastDays: 3 });
    expect(brief(calls)).toEqual([
      ['a', '2026-11-09', TODAY, false],
      ['b', '2026-11-09', TODAY, false],
      ['c', '2026-11-09', TODAY, false],
    ]);
  });

  it('resumes from a brand and day, the day for that brand only', async () => {
    const { rpc, calls } = fakeRpc(ranges);
    await run(rpc, { fromBrand: A, fromDay: '2026-11-03' });
    expect(brief(calls)).toEqual([
      ['a', '2026-11-03', TODAY, true],
      ['c', '2026-11-05', TODAY, true],
    ]);

    // A brand listed ready since is skipped; the day doesn't move to the next.
    const again = fakeRpc(ranges);
    await run(again.rpc, { fromBrand: B, fromDay: '2026-11-08' });
    expect(brief(again.calls)).toEqual([['c', '2026-11-05', TODAY, true]]);
  });

  it('stops at a failed call and names where to resume', async () => {
    const { rpc, calls } = fakeRpc(ranges, { failOn: { brand: A, from: '2026-11-03' } });
    await expect(run(rpc)).rejects.toThrow(`Resume with: --from-brand ${A} --from-day 2026-11-03`);
    expect(calls).toHaveLength(2);
  });

  it('only plans on a dry run', async () => {
    const log = vi.fn();
    const { rpc, calls } = fakeRpc(ranges);
    await run(rpc, { dryRun: true, log });
    expect(calls).toEqual([]);
    expect(log).toHaveBeenCalledWith(
      '2 brand(s), 3 call(s) of up to 14 days, 0 ms apart (dry run)',
    );
  });
});

describe('backfillFastRollups over the packed Perception terms (00540)', () => {
  const ranges = [
    { brand_id: A, day_from: '2026-10-20', day_to: '2026-11-12', ready: false },
    { brand_id: B, day_from: '2026-11-01', day_to: '2026-11-12', ready: true },
  ];

  it('walks the packed functions, names what each call wrote, and marks ready the same way', async () => {
    const calls = [];
    const log = vi.fn();
    const rpc = vi.fn(async (fn, args) => {
      if (fn === 'mentions_terms_packed_backfill_ranges') return { data: ranges, error: null };
      calls.push([
        fn,
        args.p_brand_id.slice(-1),
        args.p_day_from,
        args.p_day_to,
        args.p_mark_ready,
      ]);
      return { data: { packed_rows: 19 }, error: null };
    });
    await run(rpc, { rollups: PACKED_TERMS, log });
    expect(calls).toEqual([
      ['backfill_mention_terms_packed', 'a', '2026-10-20', '2026-11-02', false],
      ['backfill_mention_terms_packed', 'a', '2026-11-03', TODAY, true],
    ]);
    expect(rpc).not.toHaveBeenCalledWith('fast_rollups_backfill_ranges');
    expect(log).toHaveBeenLastCalledWith(
      expect.stringMatching(/rows written: 19 entity-day · ready$/),
    );
  });

  it('names the packed ranges function when it fails', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }));
    await expect(run(rpc, { rollups: PACKED_TERMS })).rejects.toThrow(
      'mentions_terms_packed_backfill_ranges: permission denied',
    );
  });
});

describe('backfillOptions', () => {
  it('reads the defaults and every option', () => {
    expect(backfillOptions([])).toEqual({
      chunkDays: 14,
      pauseMs: 250,
      brand: null,
      fromBrand: null,
      fromDay: null,
      lastDays: null,
      dryRun: false,
    });
    expect(
      backfillOptions([
        '--chunk-days',
        '7',
        '--pause-ms',
        '0',
        '--from-brand',
        A,
        '--from-day',
        '2026-11-03',
        '--last-days',
        '3',
        '--dry-run',
      ]),
    ).toMatchObject({
      chunkDays: 7,
      pauseMs: 0,
      fromBrand: A,
      fromDay: '2026-11-03',
      lastDays: 3,
      dryRun: true,
    });
  });

  it('refuses a bad brand id, day, count, or a day without a brand', () => {
    expect(() => backfillOptions(['--brand', 'B1'])).toThrow('--brand must be a brand id');
    expect(() => backfillOptions(['--from-brand', A, '--from-day', '3 Nov'])).toThrow('YYYY-MM-DD');
    expect(() => backfillOptions(['--chunk-days', '0'])).toThrow(
      '--chunk-days must be a whole number >= 1',
    );
    expect(() => backfillOptions(['--from-day', '2026-11-03'])).toThrow('--from-day needs');
  });
});
