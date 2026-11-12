// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * A Getting started explore page opened (AC-ALT2 §4): recorded through
 * getting_started_page_opened, answered as a value and never thrown
 * (#1777). The demo brand keeps no steps: nothing is recorded or logged.
 * Skipping Getting started writes the brand's row, made when it has none.
 */

const db = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown }[],
  data: true as unknown,
  error: null as { message: string } | null,
  throws: false,
  tables: null as { from: (table: string) => unknown } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (db.throws) throw new Error('down');
    return {
      rpc: async (fn: string, args: unknown) => {
        db.calls.push({ fn, args });
        return { data: db.data, error: db.error };
      },
      from: (table: string) => db.tables!.from(table),
    };
  },
}));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: vi.fn() }));

const { markGettingStartedPageOpened, skipGettingStarted } = await import('./getting-started');

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.calls = [];
  db.data = true;
  db.error = null;
  db.throws = false;
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorLog.mockRestore());

describe('markGettingStartedPageOpened', () => {
  it('records the page and says whether the step counts', async () => {
    expect(await markGettingStartedPageOpened('brand-1', 'mentions')).toEqual({
      ok: true,
      recorded: true,
    });
    expect(db.calls).toEqual([
      { fn: 'getting_started_page_opened', args: { p_brand_id: 'brand-1', p_step: 'mentions' } },
    ]);
    db.data = false;
    expect(await markGettingStartedPageOpened('brand-1', 'mentions')).toEqual({
      ok: true,
      recorded: false,
    });
  });

  it('answers the demo brand quietly: nothing recorded, nothing logged', async () => {
    db.error = { message: 'demo_brand' };
    expect(await markGettingStartedPageOpened('demo-brand', 'mentions')).toEqual({
      ok: true,
      recorded: false,
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('answers any other failure as a value, never a thrown error', async () => {
    db.error = { message: 'permission denied' };
    expect(await markGettingStartedPageOpened('brand-1', 'mentions')).toEqual({
      ok: false,
      failure: 'failed',
    });
    db.throws = true;
    expect(await markGettingStartedPageOpened('brand-1', 'mentions')).toEqual({
      ok: false,
      failure: 'failed',
    });
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it('asks nothing for a step that is not an explore page', async () => {
    expect(await markGettingStartedPageOpened('brand-1', 'connect_gsc')).toEqual({
      ok: false,
      failure: 'step',
    });
    expect(db.calls).toEqual([]);
  });
});

describe('skipGettingStarted', () => {
  const BRAND = 'brand-1';
  const AT = '2026-10-01T00:00:00.000Z';
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = createFakeSupabase();
    fake.tables.getting_started = [];
    db.tables = fake;
  });

  it('skips it for a brand from before Getting started, which has no row yet', async () => {
    await skipGettingStarted(BRAND);
    expect(fake.log).toEqual([['getting_started', 'upsert']]);
    expect(fake.tables.getting_started).toEqual([
      expect.objectContaining({ brand_id: BRAND, dismissed_at: expect.any(String) }),
    ]);
  });

  it('skips it for a brand that runs it, keeping when it started and was confirmed', async () => {
    fake.tables.getting_started = [
      { brand_id: BRAND, started_at: AT, confirmed_at: AT, dismissed_at: null },
    ];
    await skipGettingStarted(BRAND);
    expect(fake.tables.getting_started).toEqual([
      { brand_id: BRAND, started_at: AT, confirmed_at: AT, dismissed_at: expect.any(String) },
    ]);
  });

  it('throws when the policies refuse it (not an admin or manager), writing nothing', async () => {
    fake.failures.getting_started = {
      code: '42501',
      message: 'new row violates row-level security policy for table "getting_started"',
    };
    await expect(skipGettingStarted(BRAND)).rejects.toThrow('row-level security');
    expect(fake.tables.getting_started).toEqual([]);
  });
});
