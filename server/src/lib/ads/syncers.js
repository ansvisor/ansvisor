import { chatGptSyncer } from './chatgpt-sync.js';
import { googleSyncer } from './google-sync.js';

/** Each platform's part of the daily sync (lib/ads/sync.js), by ads_accounts.platform. */
export function adsSyncers() {
  return { chatgpt: chatGptSyncer(), google: googleSyncer() };
}
