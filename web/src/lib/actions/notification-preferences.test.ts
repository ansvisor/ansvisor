// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultChoices } from '@/lib/notification-preferences';

/**
 * "Your e-mails" (00554): read and saved as the person. Until they save, the
 * choices are carried over from pulse_settings and nothing is written; a
 * save checks the plan first and replaces their rows in one call.
 */

type Rows = Record<string, unknown>[];
const db = vi.hoisted(() => ({
  role: 'admin',
  brands: [] as Rows,
  prefs: [] as Rows,
  pulse: [] as Rows,
  rpc: [] as [string, unknown][],
  writes: [] as string[],
  refused: false,
}));

function query(table: string) {
  const rows = () =>
    table === 'brands'
      ? db.brands
      : table === 'notification_preferences'
        ? db.prefs
        : table === 'pulse_settings'
          ? db.pulse
          : [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    insert: () => (db.writes.push(table), chain),
    upsert: () => (db.writes.push(table), chain),
    delete: () => (db.writes.push(table), chain),
    maybeSingle: async () => ({
      data: { role: db.role, organization_id: 'org-1' },
      error: null,
    }),
    then: (resolve: (value: unknown) => void) => resolve({ data: rows(), error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email: 'ana@acme.test' } } }),
    },
    from: query,
    rpc: async (name: string, args: unknown) => {
      db.rpc.push([name, args]);
      return { error: null };
    },
  }),
}));
vi.mock('@/lib/subscription-guard', () => ({
  assertWritable: async () => {
    if (db.refused) throw new Error('subscription_inactive');
  },
}));

const { getNotificationPreferences, saveNotificationPreferences } =
  await import('./notification-preferences');

beforeEach(() => {
  db.role = 'admin';
  db.brands = [
    { id: 'b1', name: 'Acme' },
    { id: 'b2', name: 'Beta' },
  ];
  db.prefs = [];
  db.pulse = [];
  db.rpc = [];
  db.writes = [];
  db.refused = false;
});

describe('getNotificationPreferences', () => {
  it("carries over what each brand's Pulse settings send the person today, writing nothing", async () => {
    db.pulse = [
      { brand_id: 'b1', frequency: 'daily', recipients: null, traffic_digest: true },
      // A set list without them: nothing from Beta.
      { brand_id: 'b2', frequency: 'daily', recipients: ['bo@acme.test'], traffic_digest: true },
    ];
    const state = await getNotificationPreferences();
    expect(state.saved).toBe(false);
    expect(state.brands).toEqual(db.brands);
    // One brand each way: the first brand's choice stands for All my brands.
    expect(state.choices.all.daily_pulse).toBe('daily');
    expect(state.choices.brands).toEqual({ b2: { daily_pulse: 'off', traffic_digest: 'off' } });
    expect(db.writes).toEqual([]);
    expect(db.rpc).toEqual([]);
  });

  it('reads saved choices, leaving out brands the person no longer reaches', async () => {
    db.prefs = [
      { kind: 'daily_pulse', brand_id: null, frequency: 'weekly', delivery: 'per_brand' },
      { kind: 'daily_pulse', brand_id: 'gone', frequency: 'daily', delivery: 'per_brand' },
    ];
    const state = await getNotificationPreferences();
    expect(state.saved).toBe(true);
    expect(state.choices.all.daily_pulse).toBe('weekly');
    expect(state.choices.brands).toEqual({});
  });
});

describe('saveNotificationPreferences', () => {
  it('replaces the rows in one call, for brands the person reaches', async () => {
    const choices = defaultChoices();
    choices.brands = { b1: { daily_pulse: 'daily' }, elsewhere: { daily_pulse: 'daily' } };
    await saveNotificationPreferences(choices);
    expect(db.rpc).toHaveLength(1);
    const [name, args] = db.rpc[0] as [string, { p_rows: Rows }];
    expect(name).toBe('save_notification_preferences');
    expect(args.p_rows.filter((row) => row.brand_id !== null)).toEqual([
      { kind: 'daily_pulse', brand_id: 'b1', frequency: 'daily', delivery: 'per_brand' },
    ]);
    expect(args.p_rows.some((row) => row.kind === 'ai_usage')).toBe(true);
  });

  it("leaves the Account e-mails out for someone who isn't an Admin", async () => {
    db.role = 'manager';
    await saveNotificationPreferences(defaultChoices());
    const [, args] = db.rpc[0] as [string, { p_rows: Rows }];
    expect(args.p_rows.some((row) => row.kind === 'ai_usage')).toBe(false);
  });

  it('saves nothing while the workspace is read-only', async () => {
    db.refused = true;
    await expect(saveNotificationPreferences(defaultChoices())).rejects.toThrow();
    expect(db.rpc).toEqual([]);
  });
});
