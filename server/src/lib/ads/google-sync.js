import supabaseAdmin from '../../config/supabase.js';
import { GOOGLE_ADS } from './google-accounts.js';
import { campaignDays, searchTermDays } from './google-ads.js';
import { AdsSyncError, writeSearchTermDays } from './sync.js';

/**
 * Google Ads' part of the daily sync (G3, lib/ads/sync.js): each window's
 * campaign days and search terms, read through the brand's Google Ads
 * sign-in (the account's integration_accounts row) with Composio's GAQL tool.
 *
 * The sign-in only counts when it is the account's workspace's and Google
 * Ads': nothing in the database ties integration_accounts to the brand's
 * organization (#2672's review). An account whose sign-in was deleted
 * (integration_account_id set null by 00560's foreign key) is marked
 * 'disconnected', not retried every night; a sign-in that is there but not
 * connected (expired, revoked) is 'error', and read again once it is back.
 */

/** Per account object (one run): what Composio calls run as. */
const runState = new WeakMap();

/** The account's live sign-in as a Composio target, or an AdsSyncError. */
export async function googleTarget(account, { db = supabaseAdmin } = {}) {
  if (!account.integration_account_id) throw new AdsSyncError('signin_gone', 'disconnected');
  const { data, error } = await db
    .from('integration_accounts')
    .select('id, composio_entity_id, composio_account_id, status')
    .eq('id', account.integration_account_id)
    .eq('organization_id', account.organization_id)
    .eq('provider', GOOGLE_ADS)
    .maybeSingle();
  if (error) throw new Error(`integration_accounts read: ${error.code ?? 'error'}`);
  if (!data) throw new AdsSyncError('signin_gone', 'disconnected');
  if (data.status !== 'connected' || !data.composio_entity_id || !data.composio_account_id) {
    throw new AdsSyncError('signin_gone');
  }
  return { entityId: data.composio_entity_id, accountId: data.composio_account_id };
}

/** The syncer for platform 'google'. */
export function googleSyncer({
  readCampaigns = campaignDays,
  readSearchTerms = searchTermDays,
  writeTerms = writeSearchTermDays,
} = {}) {
  return async ({ account, window, writeDays, db }) => {
    let target = runState.get(account);
    if (!target) {
      target = await googleTarget(account, { db });
      runState.set(account, target);
    }
    let campaigns;
    let terms;
    try {
      campaigns = await readCampaigns(target, account.external_id, window);
      terms = await readSearchTerms(target, account.external_id, window);
    } catch {
      // Composio or Google Ads failing: its message may carry the account's
      // details, so only the code is kept.
      throw new AdsSyncError('upstream');
    }
    await writeDays(
      campaigns.map((row) => ({
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        campaignStatus: row.campaign_status,
        day: row.day,
        impressions: row.impressions,
        clicks: row.clicks,
        costMicros: row.cost_micros,
        conversions: row.conversions,
        conversionValue: row.conversion_value,
      })),
    );
    await writeTerms(
      account.id,
      terms.map((row) => ({
        campaignId: row.campaign_id,
        searchTerm: row.search_term,
        day: row.day,
        impressions: row.impressions,
        clicks: row.clicks,
        costMicros: row.cost_micros,
        conversions: row.conversions,
      })),
      { db },
    );
  };
}
