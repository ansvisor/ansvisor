import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const {
  AdsSyncError,
  addDays,
  campaignDayRow,
  dayIn,
  readSyncAccounts,
  runAdsSync,
  syncAccount,
  syncWindows,
  writeCampaignDays,
} = await import('./sync.js');

/**
 * The ad accounts' daily sync (Ads Phase 1, lib/ads/sync.js): the windows,
 * the upserts and what an account becomes when its platform fails.
 */

/** A Supabase stand-in that records every call and answers `answers[table]`. */
function fakeDb(answers = {}) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const chain = new Proxy(
        {},
        {
          get(_, op) {
            if (op === 'then') {
              const answer = answers[table] ?? { data: null, error: null };
              return (resolve) => resolve(typeof answer === 'function' ? answer(call) : answer);
            }
            return (...args) => {
              call.ops.push([op, ...args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
  return db;
}

const NOW = new Date('2026-11-22T10:00:00Z');

describe('dayIn / addDays', () => {
  it("reads the day in the account's time zone, UTC when unknown", () => {
    const late = new Date('2026-11-22T23:30:00Z');
    expect(dayIn(late, 'Europe/Istanbul')).toBe('2026-11-23');
    expect(dayIn(late, 'America/Los_Angeles')).toBe('2026-11-22');
    expect(dayIn(late, 'Not/AZone')).toBe('2026-11-22');
    expect(dayIn(late, null)).toBe('2026-11-22');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('syncWindows', () => {
  it('reads 90 days in 7-day chunks on the first sync, ending yesterday', () => {
    const windows = syncWindows({ now: NOW });
    expect(windows[0]).toEqual({ since: '2026-08-24', until: '2026-08-30' });
    expect(windows.at(-1).until).toBe('2026-11-21');
    expect(windows).toHaveLength(13);
    const days = windows.reduce(
      (n, w) => n + (Date.parse(w.until) - Date.parse(w.since)) / 86_400_000 + 1,
      0,
    );
    expect(days).toBe(90);
  });

  it('reads the last 30 days again on later runs', () => {
    const windows = syncWindows({ now: NOW, syncedThrough: '2026-11-20' });
    expect(windows[0].since).toBe('2026-10-23');
    expect(windows.at(-1).until).toBe('2026-11-21');
    expect(windows).toHaveLength(5);
  });

  it('goes on from synced_through after a cut-short first sync, never past 90 days', () => {
    expect(syncWindows({ now: NOW, syncedThrough: '2026-09-06' })[0].since).toBe('2026-09-07');
    expect(syncWindows({ now: NOW, syncedThrough: '2025-01-01' })[0].since).toBe('2026-08-24');
  });
});

describe('campaignDayRow / writeCampaignDays', () => {
  it('keeps clean numbers and refuses a row without a campaign or a day', () => {
    expect(
      campaignDayRow(
        'acc',
        {
          campaignId: 'c1',
          day: '2026-11-20',
          impressions: '12',
          clicks: -3,
          costMicros: 1_500_000.4,
          conversions: 1.236,
        },
        'T',
      ),
    ).toMatchObject({ impressions: 12, clicks: 0, cost_micros: 1_500_000, conversions: 1.24 });
    expect(campaignDayRow('acc', { day: '2026-11-20' }, 'T')).toBeNull();
    expect(campaignDayRow('acc', { campaignId: 'c1', day: 'Nov 20' }, 'T')).toBeNull();
  });

  it('upserts on (account, campaign, day), the last copy of a repeated day winning', async () => {
    const db = fakeDb();
    const written = await writeCampaignDays(
      'acc',
      [
        { campaignId: 'c1', day: '2026-11-20', clicks: 1 },
        { campaignId: 'c1', day: '2026-11-20', clicks: 2 },
        { campaignId: 'c2', day: '2026-11-20', clicks: 3 },
      ],
      { db },
    );
    expect(written).toBe(2);
    const [, rows, options] = db.calls[0].ops.find(([op]) => op === 'upsert');
    expect(rows.map((r) => r.clicks)).toEqual([2, 3]);
    expect(options).toEqual({ onConflict: 'account_id,campaign_id,day' });
  });
});

describe('readSyncAccounts', () => {
  it('leaves an account synced in the last 12 hours alone, unless it failed', async () => {
    const db = fakeDb({
      ads_accounts: {
        data: [
          { id: 'a', status: 'active', last_synced_at: '2026-11-22T05:00:00Z' },
          { id: 'b', status: 'active', last_synced_at: '2026-11-21T05:00:00Z' },
          { id: 'c', status: 'error', last_synced_at: '2026-11-22T05:00:00Z' },
          { id: 'd', status: 'active', last_synced_at: null },
        ],
        error: null,
      },
    });
    const due = await readSyncAccounts({ db, now: NOW });
    expect(due.map((a) => a.id)).toEqual(['b', 'c', 'd']);
    expect(db.calls[0].ops).toContainEqual(['in', 'status', ['active', 'error']]);
  });
});

describe('syncAccount', () => {
  const account = () => ({
    id: 'acc',
    platform: 'chatgpt',
    time_zone: 'UTC',
    synced_through: '2026-11-20',
  });
  const updates = (db) =>
    db.calls.filter((c) => c.ops.some(([op]) => op === 'update')).map((c) => c.ops[0][1]);

  it('reads every window, moves synced_through after each and marks the account active', async () => {
    const db = fakeDb();
    const syncer = vi.fn(async ({ window, writeDays }) => {
      await writeDays([{ campaignId: 'c1', day: window.since, clicks: 1 }]);
    });
    const result = await syncAccount(account(), syncer, { db, now: NOW });
    expect(syncer).toHaveBeenCalledTimes(5);
    expect(result).toEqual({ status: 'active', rows: 5 });
    const last = updates(db).at(-1);
    expect(last).toMatchObject({ status: 'active', last_error: null });
    expect(updates(db).some((u) => u.synced_through === '2026-11-21')).toBe(true);
  });

  it("marks the account 'error' with a code, never the upstream text, when its platform fails", async () => {
    const db = fakeDb();
    const syncer = vi.fn(async () => {
      throw new Error('upstream said: secret-body sk-123');
    });
    const result = await syncAccount(account(), syncer, { db, now: NOW });
    expect(result.status).toBe('error');
    const last = updates(db).at(-1);
    expect(last.status).toBe('error');
    expect(last.last_error).toBe('failed');
  });

  it("keeps an AdsSyncError's status and code", async () => {
    const db = fakeDb();
    const syncer = async () => {
      throw new AdsSyncError('key_missing', 'disconnected');
    };
    expect((await syncAccount(account(), syncer, { db, now: NOW })).status).toBe('disconnected');
    expect(updates(db).at(-1)).toMatchObject({
      status: 'disconnected',
      last_error: 'key_missing',
    });
  });

  it('fails a platform with no syncer', async () => {
    const db = fakeDb();
    expect((await syncAccount(account(), undefined, { db, now: NOW })).status).toBe('error');
  });
});

describe('runAdsSync', () => {
  it('syncs each due account with its platform and counts the outcomes', async () => {
    const db = fakeDb({
      ads_accounts: (call) =>
        call.ops.some(([op]) => op === 'select')
          ? {
              data: [
                { id: 'a', platform: 'chatgpt', status: 'active', synced_through: '2026-11-20' },
                { id: 'b', platform: 'google', status: 'active', synced_through: '2026-11-20' },
              ],
              error: null,
            }
          : { data: null, error: null },
    });
    const chatgpt = vi.fn(async () => {});
    const totals = await runAdsSync({ syncers: { chatgpt }, db, now: NOW });
    expect(totals).toMatchObject({ accounts: 2, active: 1, error: 1 });
    expect(chatgpt.mock.calls.every(([arg]) => arg.account.id === 'a')).toBe(true);
  });
});
