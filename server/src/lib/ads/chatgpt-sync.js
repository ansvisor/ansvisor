import { readChatGptKey } from './accounts.js';
import {
  ChatGptAdsKeyError,
  ChatGptAdsUnavailableError,
  fetchCampaignDays,
  fetchCampaignStatuses,
} from './chatgpt-ads.js';
import { AdsSyncError } from './sync.js';

/**
 * ChatGPT Ads' part of the daily sync (C3, lib/ads/sync.js): each window's
 * campaign days, read with the account's own key. The key is opened once per
 * account and run, and the campaigns' statuses read once with it.
 */

/** Per account object (one run): its key and campaign statuses. */
const runState = new WeakMap();

async function stateOf(account, { db, readKey, options }) {
  let state = runState.get(account);
  if (!state) {
    const key = await readKey(account.id, { db });
    if (!key) {
      throw new AdsSyncError('key_missing', 'disconnected');
    }
    state = { key, statuses: await fetchCampaignStatuses(key, options) };
    runState.set(account, state);
  }
  return state;
}

/** The syncer for platform 'chatgpt'. */
export function chatGptSyncer({ readKey = readChatGptKey, fetchImpl } = {}) {
  const options = fetchImpl ? { fetchImpl } : undefined;
  return async ({ account, window, writeDays, db }) => {
    try {
      const { key, statuses } = await stateOf(account, { db, readKey, options });
      const days = await fetchCampaignDays(key, window, options);
      await writeDays(
        days.map((day) => ({ ...day, campaignStatus: statuses.get(String(day.campaignId)) })),
      );
    } catch (err) {
      if (err instanceof ChatGptAdsKeyError) {
        throw new AdsSyncError('key_refused');
      }
      if (err instanceof ChatGptAdsUnavailableError) {
        throw new AdsSyncError('upstream');
      }
      throw err;
    }
  };
}
