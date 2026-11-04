// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings › Account › Time zone (00468): the person reads and saves their
 * own pick through their session, on their own row only; null is
 * Automatic. Nothing else is written: a scheduled job keeps its own zone.
 */

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';

interface Call {
  table: string;
  op: 'select' | 'update';
  row?: unknown;
  filters: unknown[][];
}
let calls: Call[] = [];
let stored: string | null = null;
let signedIn = true;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: signedIn ? { id: ME } : null } }),
    },
    from: (table: string) => {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const chain = {
        select: () => chain,
        update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
        eq: (...args: unknown[]) => {
          call.filters.push(['eq', ...args]);
          return chain;
        },
        maybeSingle: async () => ({ data: { time_zone: stored }, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { getAccountTimeZone, updateAccountTimeZone } = await import('./organization');

beforeEach(() => {
  calls = [];
  stored = null;
  signedIn = true;
});

describe('the Account time zone', () => {
  it('reads the person’s pick, null for Automatic or a zone nobody knows', async () => {
    expect(await getAccountTimeZone()).toBeNull();
    stored = 'Europe/Istanbul';
    expect(await getAccountTimeZone()).toBe('Europe/Istanbul');
    stored = 'Mars/Olympus';
    expect(await getAccountTimeZone()).toBeNull();
    expect(calls.every((c) => c.table === 'profiles' && c.op === 'select')).toBe(true);
  });

  it('saves a zone, or Automatic, on their own row and nothing else', async () => {
    await updateAccountTimeZone('Asia/Tokyo');
    await updateAccountTimeZone(null);
    expect(calls).toEqual([
      {
        table: 'profiles',
        op: 'update',
        row: { time_zone: 'Asia/Tokyo' },
        filters: [['eq', 'id', ME]],
      },
      { table: 'profiles', op: 'update', row: { time_zone: null }, filters: [['eq', 'id', ME]] },
    ]);
    // No scheduled job moves with it.
    expect(calls.some((c) => c.table === 'chat_schedules')).toBe(false);
  });

  it('refuses a zone nobody knows, and anyone signed out', async () => {
    await expect(updateAccountTimeZone('Mars/Olympus')).rejects.toThrow('Unknown time zone');
    signedIn = false;
    await expect(updateAccountTimeZone('Asia/Tokyo')).rejects.toThrow('Unauthorized');
    await expect(getAccountTimeZone()).rejects.toThrow('Unauthorized');
    expect(calls).toEqual([]);
  });
});
