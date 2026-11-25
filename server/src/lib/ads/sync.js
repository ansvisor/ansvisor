import cron from 'node-cron';
import supabaseAdmin from '../../config/supabase.js';
import { isCloud } from '../../config/plans.js';
import { adsEnabled } from '../ads-flag.js';
import { logger } from '../logger.js';

/**
 * The ad accounts' daily sync (Ads Phase 1, G3/C3): each account's campaign
 * days, read from its platform and kept in ads_campaign_daily (00560).
 *
 * Windows: an account's first sync reads the last FIRST_DAYS days; every
 * later run reads the last ROLLING_DAYS again, since platforms correct
 * conversions and spend for days already reported. Each run reads in
 * CHUNK_DAYS-day chunks, oldest first, and moves synced_through forward after
 * each chunk, so a run cut short goes on from there the next time. Writes
 * are upserts on (account, campaign, day): a chunk read twice writes the same
 * rows.
 *
 * One account at a time, the least recently synced first; an account synced
 * in the last FRESH_HOURS is left alone (a restart, or a second instance). A
 * platform that fails marks its account 'error' with a reason code
 * (SYNC_ERRORS) the Connections card words, and the next run tries it again; a sign-in or key
 * that is gone marks it 'disconnected', which isn't retried until someone
 * connects it again. Only workspaces with an active plan are read.
 *
 * Each platform registers a syncer: ({ account, window, writeDays, db }) →
 * void, called once per window, that reads it and hands its campaign days
 * ({ campaignId, campaignName, campaignStatus, day, impressions, clicks,
 * costMicros, conversions, conversionValue }) to writeDays. Logs carry ids,
 * counts and codes only, never a key, a campaign name or a search term.
 */

export const FIRST_DAYS = 90;
export const ROLLING_DAYS = 30;
export const CHUNK_DAYS = 7;
export const FRESH_HOURS = 12;
export const SCHEDULE = process.env.ADS_SYNC_SCHEDULE || '20 5 * * *';
const WRITE_BATCH = 500;
const ACTIVE_STATUSES = ['active', 'trialing'];
const ORG_OF = 'organizations!ads_accounts_organization_id_fkey!inner';

/**
 * Why a sync failed, kept in ads_accounts.last_error for the Connections card
 * to word (messages ads.connections.syncError): never a key or an upstream body.
 */
export const SYNC_ERRORS = ['key_refused', 'key_missing', 'signin_gone', 'upstream', 'failed'];

/** A failure the account shows: `code` (SYNC_ERRORS), `status` is what it becomes. */
export class AdsSyncError extends Error {
  /**
   * @param {'key_refused' | 'key_missing' | 'signin_gone' | 'upstream' | 'failed'} code
   * @param {'error' | 'disconnected'} [status]
   */
  constructor(code, status = 'error') {
    super(`ads sync failed: ${code}`);
    this.name = 'AdsSyncError';
    this.code = code;
    this.status = status;
  }
}

/** YYYY-MM-DD of `date` in `timeZone` (UTC when it is missing or unknown). */
export function dayIn(date, timeZone) {
  const format = (tz) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  try {
    return format(timeZone || 'UTC');
  } catch {
    return format('UTC');
  }
}

/** `day` (YYYY-MM-DD) moved by `n` days. */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The windows an account reads this run, oldest first: [{ since, until }],
 * both inclusive, ending yesterday in the account's time zone. From the
 * earlier of (yesterday - ROLLING_DAYS + 1) and the day after synced_through,
 * but never before (yesterday - FIRST_DAYS + 1).
 */
export function syncWindows({ now = new Date(), timeZone = null, syncedThrough = null } = {}) {
  const until = addDays(dayIn(now, timeZone), -1);
  const floor = addDays(until, -(FIRST_DAYS - 1));
  let since = addDays(until, -(ROLLING_DAYS - 1));
  if (!syncedThrough) since = floor;
  else if (addDays(syncedThrough, 1) < since) since = addDays(syncedThrough, 1);
  if (since < floor) since = floor;

  const windows = [];
  for (let start = since; start <= until; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1);
    windows.push({ since: start, until: end < until ? end : until });
  }
  return windows;
}

const count = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const amount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};
const text = (value, max) => {
  const s = value == null ? '' : String(value).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * A platform's campaign day as ads_campaign_daily keeps it; null for a row
 * with no campaign id or no valid day.
 */
export function campaignDayRow(accountId, row, updatedAt) {
  const campaignId = text(row?.campaignId, 64);
  const day = typeof row?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.day) ? row.day : null;
  if (!campaignId || !day) return null;
  return {
    account_id: accountId,
    campaign_id: campaignId,
    day,
    campaign_name: text(row.campaignName, 500),
    campaign_status: text(row.campaignStatus, 40),
    impressions: count(row.impressions),
    clicks: count(row.clicks),
    cost_micros: count(row.costMicros),
    conversions: amount(row.conversions),
    conversion_value: amount(row.conversionValue),
    updated_at: updatedAt,
  };
}

/** Upserts campaign days in batches; the number written. */
export async function writeCampaignDays(accountId, rows, { db = supabaseAdmin } = {}) {
  const updatedAt = new Date().toISOString();
  const byKey = new Map();
  for (const row of rows) {
    const clean = campaignDayRow(accountId, row, updatedAt);
    if (clean) byKey.set(`${clean.campaign_id}|${clean.day}`, clean);
  }
  const all = [...byKey.values()];
  for (let i = 0; i < all.length; i += WRITE_BATCH) {
    const { error } = await db
      .from('ads_campaign_daily')
      .upsert(all.slice(i, i + WRITE_BATCH), { onConflict: 'account_id,campaign_id,day' });
    if (error) throw new Error(`ads_campaign_daily write: ${error.code ?? 'error'}`);
  }
  return all.length;
}

/** The accounts to sync: active or failed, of workspaces with an active plan. */
export async function readSyncAccounts({ db = supabaseAdmin, now = new Date() } = {}) {
  let query = db
    .from('ads_accounts')
    .select(
      `id, organization_id, brand_id, platform, external_id, time_zone, login_customer_id, integration_account_id, status, last_synced_at, synced_through, ${ORG_OF}(subscription_status)`,
    )
    .in('status', ['active', 'error'])
    .order('last_synced_at', { ascending: true, nullsFirst: true });
  if (isCloud()) query = query.in('organizations.subscription_status', ACTIVE_STATUSES);
  const { data, error } = await query;
  if (error) throw new Error(`ads_accounts read: ${error.code ?? 'error'}`);
  const freshSince = now.getTime() - FRESH_HOURS * 3_600_000;
  return (data ?? []).filter(
    (row) =>
      row.status !== 'active' ||
      !row.last_synced_at ||
      new Date(row.last_synced_at).getTime() < freshSince,
  );
}

async function updateAccount(db, id, fields) {
  const { error } = await db
    .from('ads_accounts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`ads_accounts update: ${error.code ?? 'error'}`);
}

/**
 * Syncs one account with its platform's syncer: every window, oldest first,
 * then marks it active. A failure keeps the windows already written (and
 * synced_through after them) and marks it 'error' or 'disconnected'.
 * Returns { status, rows }.
 */
export async function syncAccount(account, syncer, { db = supabaseAdmin, now = new Date() } = {}) {
  const windows = syncWindows({
    now,
    timeZone: account.time_zone,
    syncedThrough: account.synced_through,
  });
  let rows = 0;
  try {
    if (!syncer) throw new AdsSyncError('failed');
    for (const window of windows) {
      await syncer({
        account,
        window,
        writeDays: async (days) => {
          rows += await writeCampaignDays(account.id, days, { db });
        },
        db,
      });
      if (!account.synced_through || window.until > account.synced_through) {
        await updateAccount(db, account.id, { synced_through: window.until });
        account.synced_through = window.until;
      }
    }
    await updateAccount(db, account.id, {
      status: 'active',
      last_error: null,
      last_synced_at: now.toISOString(),
    });
    return { status: 'active', rows };
  } catch (err) {
    const known = err instanceof AdsSyncError;
    const status = known ? err.status : 'error';
    const code = known ? err.code : 'failed';
    await updateAccount(db, account.id, {
      status,
      last_error: code,
      last_synced_at: now.toISOString(),
    });
    logger.warn(
      {
        account: account.id,
        platform: account.platform,
        status,
        code,
        err: known ? null : err?.name,
      },
      '[ads-sync] account failed',
    );
    return { status, rows };
  }
}

/**
 * One run: every account due, one at a time. A syncer per platform, e.g.
 * { chatgpt: syncChatGptWindow }. Returns counts.
 */
export async function runAdsSync({ syncers, db = supabaseAdmin, now = new Date() } = {}) {
  const accounts = await readSyncAccounts({ db, now });
  const totals = { accounts: accounts.length, active: 0, error: 0, disconnected: 0, rows: 0 };
  for (const account of accounts) {
    let result;
    try {
      result = await syncAccount(account, syncers?.[account.platform], { db, now });
    } catch (err) {
      // The account's own status couldn't be written: count it and go on.
      logger.error({ account: account.id, err: err?.message }, '[ads-sync] account crashed');
      result = { status: 'error', rows: 0 };
    }
    totals[result.status] += 1;
    totals.rows += result.rows;
  }
  logger.info(totals, '[ads-sync] run done');
  return totals;
}

/** Schedules the daily run, with Ads on; one run at a time. */
export function startAdsSync({ syncers, schedule = SCHEDULE, env = process.env } = {}) {
  if (!adsEnabled(env)) return false;
  let running = false;
  cron.schedule(schedule, async () => {
    if (running) return;
    running = true;
    try {
      await runAdsSync({ syncers });
    } catch (err) {
      logger.error({ err: err?.message }, '[ads-sync] run crashed');
    } finally {
      running = false;
    }
  });
  logger.info({ schedule }, '[ads-sync] daily sync scheduled');
  return true;
}
