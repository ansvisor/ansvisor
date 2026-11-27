import supabaseAdmin from '../../config/supabase.js';
import { ADS_PERIODS } from './standing.js';

/**
 * Ads › Campaigns on real data (Ads Phase 1, P1): each campaign of the
 * brand's connected ad accounts over the period, from the days the daily
 * sync keeps (ads_campaign_daily, lib/ads/sync.js), whatever the platform.
 *
 * Read only, and only the brand's accounts in the route's workspace
 * (CLAUDE.md rule 3: the tables bypass row-level security). Money stays in
 * each account's own currency: nothing is converted or added across
 * currencies.
 */

/** Rows one read asks for: PostgREST answers 1,000 at most. */
const PAGE = 1000;
/** A guard far above a brand's campaign days over 90 days. */
const MAX_ROWS = 200_000;

const ACCOUNT_COLUMNS =
  'id, platform, external_id, name, currency_code, status, last_error, last_synced_at, synced_through';

/** Google's ENABLED/PAUSED/REMOVED and ChatGPT's active/paused/archived, as one set. */
export function campaignStatus(value) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'enabled' || status === 'active') return 'active';
  if (status === 'paused') return 'paused';
  if (status === 'removed' || status === 'archived') return 'ended';
  return null;
}

/** The period's days, both ends included, ending today (UTC). */
export function periodRange(period, now = new Date()) {
  const days = ADS_PERIODS[period] ?? ADS_PERIODS['30d'];
  const day = (ago) => new Date(now.getTime() - ago * 86_400_000).toISOString().slice(0, 10);
  return { from: day(days - 1), to: day(0) };
}

/** Rounds to cents; null when it can't be computed (no clicks, no conversions). */
const ratio = (micros, n) => (n > 0 ? Math.round(micros / n / 10_000) / 100 : null);

/**
 * The campaigns' totals, most spent first, from campaign days: one row per
 * account and campaign, its name and status from its latest day.
 */
export function campaignTotals(days, accountsById) {
  const byCampaign = new Map();
  for (const day of days) {
    const account = accountsById.get(day.account_id);
    if (!account) continue;
    const key = `${day.account_id}|${day.campaign_id}`;
    let row = byCampaign.get(key);
    if (!row) {
      row = {
        accountId: day.account_id,
        campaignId: day.campaign_id,
        platform: account.platform,
        currencyCode: account.currency_code ?? null,
        name: null,
        status: null,
        lastDay: '',
        impressions: 0,
        clicks: 0,
        costMicros: 0,
        conversions: 0,
        conversionValue: 0,
      };
      byCampaign.set(key, row);
    }
    if (day.day >= row.lastDay) {
      row.lastDay = day.day;
      row.name = day.campaign_name ?? row.name;
      row.status = campaignStatus(day.campaign_status) ?? row.status;
    }
    row.impressions += Number(day.impressions) || 0;
    row.clicks += Number(day.clicks) || 0;
    row.costMicros += Number(day.cost_micros) || 0;
    row.conversions += Number(day.conversions) || 0;
    row.conversionValue += Number(day.conversion_value) || 0;
  }
  return [...byCampaign.values()]
    .map(({ lastDay: _lastDay, ...row }) => ({
      ...row,
      conversions: Math.round(row.conversions * 100) / 100,
      conversionValue: Math.round(row.conversionValue * 100) / 100,
      spend: Math.round(row.costMicros / 10_000) / 100,
      cpc: ratio(row.costMicros, row.clicks),
      costPerConversion: ratio(row.costMicros, row.conversions),
    }))
    .sort((a, b) => b.costMicros - a.costMicros || a.campaignId.localeCompare(b.campaignId));
}

/**
 * The brand's accounts (what each read last) and its campaigns over the
 * period. No account: both lists empty, and the tab shows how to connect one.
 */
export async function readCampaigns(
  { orgId, brandId, period },
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const range = periodRange(period, now);
  const { data: accounts, error } = await db
    .from('ads_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('organization_id', orgId)
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`ads_accounts read: ${error.code ?? 'error'}`);
  if (!accounts?.length) return { range, accounts: [], campaigns: [] };

  const days = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error: dayError } = await db
      .from('ads_campaign_daily')
      .select(
        'account_id, campaign_id, day, campaign_name, campaign_status, impressions, clicks, cost_micros, conversions, conversion_value',
      )
      .in(
        'account_id',
        accounts.map((a) => a.id),
      )
      .gte('day', range.from)
      .lte('day', range.to)
      .order('account_id')
      .order('campaign_id')
      .order('day')
      .range(from, from + PAGE - 1);
    if (dayError) throw new Error(`ads_campaign_daily read: ${dayError.code ?? 'error'}`);
    days.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }

  const byId = new Map(accounts.map((a) => [a.id, a]));
  return {
    range,
    accounts: accounts.map((a) => ({
      id: a.id,
      platform: a.platform,
      externalId: a.external_id,
      name: a.name ?? null,
      currencyCode: a.currency_code ?? null,
      status: a.status,
      lastError: a.last_error ?? null,
      lastSyncedAt: a.last_synced_at ?? null,
      syncedThrough: a.synced_through ?? null,
    })),
    campaigns: campaignTotals(days, byId),
  };
}
