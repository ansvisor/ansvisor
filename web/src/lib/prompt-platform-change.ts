import { slotPlatform } from '@/config/tracking-slots';
import { promptLocationCount } from '@/lib/prompt-locations';

/**
 * Adding or removing platforms across a selection of prompts (00564), as
 * the bulk location and tag changes work: add or remove, never "set every
 * prompt to this list". Adding a platform a prompt waits on runs it again
 * (it leaves `waiting_platforms`); removing takes it off both lists. A
 * prompt that removing would leave with nothing to run is skipped and
 * counted, never emptied. Pure: the preview and the save run the same
 * arithmetic.
 */

/** A prompt as the change reads it. */
export interface PlatformChangeRow {
  id: string;
  platforms: readonly string[];
  waiting_platforms?: readonly string[] | null;
  models?: readonly string[] | null;
  regions: readonly unknown[] | null;
  /** Paused prompts use no slots. */
  is_active: boolean;
}

export interface PlatformChange {
  changes: { promptId: string; platforms: string[]; waiting_platforms: string[] }[];
  /** Already had every added platform, or none of the removed ones. */
  unchanged: number;
  /** Skipped: removing would leave nothing to run. */
  blocked: number;
  /** Slots the added platforms take, per platform (active prompts' locations). */
  needed: Map<string, number>;
}

export function planBulkPlatformChange(
  rows: readonly PlatformChangeRow[],
  action: 'add' | 'remove',
  platforms: readonly string[],
): PlatformChange {
  const picked = [...new Set(platforms)];
  const result: PlatformChange = { changes: [], unchanged: 0, blocked: 0, needed: new Map() };
  for (const row of rows) {
    const waiting = row.waiting_platforms ?? [];
    if (action === 'add') {
      const adding = picked.filter((p) => !row.platforms.includes(p));
      if (!adding.length) {
        result.unchanged += 1;
        continue;
      }
      if (row.is_active) {
        const locations = promptLocationCount(row.regions);
        for (const p of adding) {
          if (slotPlatform(p)) result.needed.set(p, (result.needed.get(p) ?? 0) + locations);
        }
      }
      result.changes.push({
        promptId: row.id,
        platforms: [...row.platforms, ...adding],
        waiting_platforms: waiting.filter((p) => !adding.includes(p)),
      });
      continue;
    }
    const removing = new Set(picked);
    const kept = row.platforms.filter((p) => !removing.has(p));
    const keptWaiting = waiting.filter((p) => !removing.has(p));
    if (kept.length === row.platforms.length && keptWaiting.length === waiting.length) {
      result.unchanged += 1;
      continue;
    }
    // ChatGPT Shopping alone runs nothing; a model still does.
    const engines = kept.filter((p) => p !== 'chatgpt-shopping');
    if (!engines.length && !(row.models ?? []).length) {
      result.blocked += 1;
      continue;
    }
    result.changes.push({ promptId: row.id, platforms: kept, waiting_platforms: keptWaiting });
  }
  return result;
}
