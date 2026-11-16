import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import { backfillBrandNumbers } from './brand-numbers-backfill.js';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

/** A fake rpc over these brands per kind, recording the backfill calls. */
function fakeRpc(brands, { failOn = null } = {}) {
  const calls = [];
  const rpc = vi.fn(async (fn, args) => {
    if (fn === 'brand_numbers_backfill_brands') return { data: brands[args.p_kind], error: null };
    calls.push([args.p_kind, args.p_brand_id.slice(-1)]);
    if (failOn && args.p_brand_id === failOn) {
      return { data: null, error: { message: 'canceling statement due to statement timeout' } };
    }
    return { data: { numbered: 2, last_no: 2 }, error: null };
  });
  return { rpc, calls };
}

const run = (rpc, options = {}) =>
  backfillBrandNumbers({ rpc, pauseMs: 0, log: () => {}, ...options });

const brands = {
  action: [
    { brand_id: A, ready: false },
    { brand_id: B, ready: true },
    { brand_id: C, ready: false },
  ],
  signal: [{ brand_id: B, ready: false }],
};

describe('backfillBrandNumbers', () => {
  it('numbers each brand not numbered yet, one brand and kind per call, actions first', async () => {
    const { rpc, calls } = fakeRpc(brands);
    const done = await run(rpc);
    expect(calls).toEqual([
      ['action', 'a'],
      ['action', 'c'],
      ['signal', 'b'],
    ]);
    expect(done).toMatchObject({ calls: 3, numbered: 6 });
  });

  it('skips every brand on a second run, once all are numbered', async () => {
    const all = {
      action: brands.action.map((b) => ({ ...b, ready: true })),
      signal: [{ brand_id: B, ready: true }],
    };
    const { rpc, calls } = fakeRpc(all);
    expect(await run(rpc)).toMatchObject({ calls: 0, numbered: 0 });
    expect(calls).toEqual([]);
  });

  it('numbers a brand named with --brand even when it is numbered, and one kind with --kind', async () => {
    const { rpc, calls } = fakeRpc(brands);
    await run(rpc, { brand: B, kinds: ['action'] });
    expect(calls).toEqual([['action', 'b']]);
  });

  it('resumes from the brand it names, and says where to resume when a call fails', async () => {
    const { rpc, calls } = fakeRpc(brands, { failOn: C });
    await expect(run(rpc)).rejects.toThrow(`Resume with: --kind action --from-brand ${C}`);
    expect(calls).toEqual([
      ['action', 'a'],
      ['action', 'c'],
    ]);
    const again = fakeRpc(brands);
    await run(again.rpc, { fromBrand: C });
    expect(again.calls).toEqual([['action', 'c']]);
  });

  it('calls nothing on a dry run', async () => {
    const { rpc, calls } = fakeRpc(brands);
    expect(await run(rpc, { dryRun: true })).toMatchObject({ calls: 0 });
    expect(calls).toEqual([]);
  });
});

/** 00534 without its comments, on one line. */
const sql = readFileSync(
  new URL('../../../supabase/migrations/00534_actions_brand_number.sql', import.meta.url),
  'utf8',
)
  .replace(/--[^\n]*/g, '')
  .replace(/\s+/g, ' ');

describe('00534', () => {
  it('numbers nothing that is there: its only updates are inside functions', () => {
    const outside = sql.replace(/\$\$.*?\$\$/g, '');
    expect(outside).not.toMatch(/\bupdate public\./i);
    expect(outside).not.toMatch(/\binsert into public\./i);
  });

  it('builds the unique indexes only on empty tables; the runbook builds them after the backfill', () => {
    expect(sql).toMatch(
      /if not exists \(select 1 from public\.actions\) then create unique index if not exists actions_brand_no_key on public\.actions \(brand_id, brand_no\) where brand_no is not null/,
    );
    expect(sql).toMatch(
      /if not exists \(select 1 from public\.signals\) then create unique index if not exists signals_brand_no_key/,
    );
  });

  it('gives the next number from a counter updated in the insert, on both tables', () => {
    expect(sql).toMatch(
      /before insert on public\.actions for each row execute function public\.set_brand_no\('action'\)/,
    );
    expect(sql).toMatch(
      /before insert on public\.signals for each row execute function public\.set_brand_no\('signal'\)/,
    );
    expect(sql).toMatch(
      /set last_no = c\.last_no \+ 1 where c\.brand_id = new\.brand_id and c\.kind = v_kind returning c\.last_no into v_no/,
    );
  });

  it('numbers by creation order, after the highest number, under the lock inserts wait on', () => {
    expect(sql).toMatch(/row_number\(\) over \(order by a\.created_at, a\.action_no\)/);
    expect(sql).toMatch(/row_number\(\) over \(order by s\.created_at, s\.id\)/);
    expect(sql).toMatch(/where a\.brand_id = p_brand_id and a\.brand_no is null/);
    expect(sql).toMatch(
      /perform pg_advisory_xact_lock\(public\.brand_no_lock_key\(p_kind, p_brand_id\)\)/,
    );
    expect(sql).toMatch(
      /perform pg_advisory_xact_lock_shared\(public\.brand_no_lock_key\(v_kind, new\.brand_id\)\)/,
    );
  });

  it('keeps the counters and the backfill to the server', () => {
    expect(sql).toMatch(/alter table public\.brand_number_counters enable row level security/);
    expect(sql).not.toMatch(/create policy[^;]*brand_number_counters/i);
    expect(sql).toMatch(
      /revoke execute on function public\.backfill_brand_numbers\(text, uuid\) from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.brand_numbers_backfill_brands\(text\) from public, anon, authenticated/,
    );
  });
});
