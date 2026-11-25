import { chatGptSyncer } from './chatgpt-sync.js';

/** Each platform's part of the daily sync (lib/ads/sync.js), by ads_accounts.platform. */
export function adsSyncers() {
  return { chatgpt: chatGptSyncer() };
}
