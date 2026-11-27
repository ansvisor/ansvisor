import { slotPlatform } from '@/config/tracking-slots';
import { promptLocationCount } from '@/lib/prompt-locations';

/**
 * Tracking slots per platform (00564), as a workspace's prompts use them. A
 * slot is one prompt tracked in one location on one platform: a prompt with
 * three locations on ChatGPT and Gemini uses three of each. Pure.
 */

/** A prompt as slots read it. */
export interface SlottedPrompt {
  id: string;
  platforms: readonly string[];
  waiting_platforms?: readonly string[] | null;
  models?: readonly string[] | null;
  regions: readonly unknown[] | null;
}

/** Slots used per platform by these (tracked) prompts. Only platforms slots are sold for. */
export function slotUsage(prompts: readonly SlottedPrompt[]): Map<string, number> {
  const used = new Map<string, number>();
  for (const prompt of prompts) {
    const locations = promptLocationCount(prompt.regions);
    for (const platform of new Set(prompt.platforms)) {
      if (!slotPlatform(platform)) continue;
      used.set(platform, (used.get(platform) ?? 0) + locations);
    }
  }
  return used;
}

/** A platform's slots: what the plan gives it, 0 when it gives none; -1 is no limit. */
export function slotLimit(slots: Readonly<Record<string, number>>, platform: string): number {
  return slots[platform] ?? 0;
}

/** The slots still free on a platform (Infinity with no limit). */
export function freeSlots(
  slots: Readonly<Record<string, number>>,
  used: ReadonlyMap<string, number>,
  platform: string,
): number {
  const limit = slotLimit(slots, platform);
  if (limit < 0) return Infinity;
  return Math.max(0, limit - (used.get(platform) ?? 0));
}

/**
 * Which platforms of which prompts wait so every platform fits its slots: on
 * a platform over its slots, the newest prompts' locations wait first, until
 * what stays fits. Nothing else changes. Keyed by prompt id.
 */
export function platformsToWait(
  newestFirst: readonly SlottedPrompt[],
  slots: Readonly<Record<string, number>>,
): Map<string, string[]> {
  const moves = new Map<string, string[]>();
  for (const [platform, used] of slotUsage(newestFirst)) {
    const limit = slotLimit(slots, platform);
    if (limit < 0 || used <= limit) continue;
    let over = used - limit;
    for (const prompt of newestFirst) {
      if (over <= 0) break;
      if (!prompt.platforms.includes(platform)) continue;
      moves.set(prompt.id, [...(moves.get(prompt.id) ?? []), platform]);
      over -= promptLocationCount(prompt.regions);
    }
  }
  return moves;
}

/** A prompt after some of its platforms wait. */
export interface SettledPrompt {
  platforms: string[];
  waiting_platforms: string[];
  /** Nothing left to run: no platform (ChatGPT Shopping alone doesn't count) and no model. */
  idle: boolean;
}

/** The prompt once `waiting` of its platforms wait; a platform is never in both lists. */
export function settlePrompt(prompt: SlottedPrompt, waiting: readonly string[]): SettledPrompt {
  const moved = new Set(waiting);
  const platforms = prompt.platforms.filter((p) => !moved.has(p));
  const kept = new Set(platforms);
  const waitingPlatforms = [...new Set([...(prompt.waiting_platforms ?? []), ...waiting])].filter(
    (p) => !kept.has(p),
  );
  const engines = platforms.filter((p) => p !== 'chatgpt-shopping');
  return {
    platforms,
    waiting_platforms: waitingPlatforms,
    idle: engines.length === 0 && (prompt.models ?? []).length === 0,
  };
}

/** The waiting platforms once `platforms` run: none of them still waits. */
export function stillWaiting(
  waiting: readonly string[] | null | undefined,
  platforms: readonly string[],
): string[] {
  const running = new Set(platforms);
  return (waiting ?? []).filter((p) => !running.has(p));
}
