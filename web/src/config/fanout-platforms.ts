/**
 * Which tracked platforms can carry observed query fan-out (#332), as our data
 * provider (Cloro) documents it. The Query Fan-out page uses this to tell
 * "this engine shares its searches, but none arrived" (worth flagging) apart
 * from "this engine never shares them" (nothing to wait for). The server's
 * daily health report keeps the same sharing list, and judges ChatGPT by its
 * sampling (server/src/lib/health/report.js).
 */

/** Platforms whose answers come with the searches the engine ran. */
export const FANOUT_SHARING_PLATFORMS: readonly string[] = ['copilot-web', 'perplexity-web'];

/**
 * Platforms whose answers never come with their searches: those our provider
 * documents no fan-out for, and the API models (`claude`, `gemini`,
 * `chatgpt`, see resolveModelPlatform in the tracking worker), whose searches
 * we don't capture.
 *
 * ChatGPT (`chatgpt-web`) is in neither list. Its default interface carries no
 * query text since 2026-09-30 (#1119); the server asks its legacy interface on
 * one day a week per prompt (CLORO_CHATGPT_FANOUT, off unless set on
 * self-host). So a window may hold some of its searches or none, and neither
 * is news: it reads as an ordinary engine, never flagged.
 */
export const FANOUT_NOT_SHARED_PLATFORMS: readonly string[] = [
  'google-aio',
  'google-aimode',
  'gemini-web',
  'claude',
  'gemini',
  'chatgpt',
];

/**
 * Answers an engine needs in the window before "it shared none" means
 * something. An engine can share searches on only some of its answers, so a
 * few answers with none is ordinary chance on a small brand.
 */
export const FANOUT_MIN_SILENT_ANSWERS = 20;

/** The API-model platforms, whose labels match a scraper's ("ChatGPT"). */
export const API_MODEL_PLATFORMS: readonly string[] = ['claude', 'gemini', 'chatgpt'];

export type FanoutSharing = 'shares' | 'not-shared' | 'unknown';

export function fanoutSharing(platform: string): FanoutSharing {
  if (FANOUT_SHARING_PLATFORMS.includes(platform)) return 'shares';
  if (FANOUT_NOT_SHARED_PLATFORMS.includes(platform)) return 'not-shared';
  return 'unknown';
}
