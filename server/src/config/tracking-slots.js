/**
 * Tracking slots per platform (00564). A copy of web/src/config/tracking-slots.ts,
 * which is the source; a web test keeps tracking-slots.json the same.
 *
 * A slot is one prompt tracked in one location on one platform. A plan
 * includes slots on its own platforms (its `allowedScrapers`, else the
 * standard five); a workspace buys more per platform
 * (organizations.add_on_slots).
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const SLOTS = require('./tracking-slots.json');

/** The platforms a paid plan's own prompt locations run on, when it names none. */
export const STANDARD_SLOT_PLATFORMS = Object.freeze([...SLOTS.standard]);

/** Every platform slots are sold for. */
export const SLOT_PLATFORM_IDS = Object.freeze(SLOTS.platforms.map((p) => p.id));

/**
 * The platforms a plan and its bought slots let run: its own platforms while
 * it has prompt locations, and each platform the workspace bought slots for.
 * Null when nothing is limited (self-hosted, or no plan read).
 *
 * @param {{ limits: { maxPrompts: number, allowedScrapers?: string[] } } | null} plan
 * @param {Record<string, unknown> | null | undefined} addOnSlots
 * @returns {Set<string> | null}
 */
export function slottedPlatforms(plan, addOnSlots) {
  if (!plan) return null;
  const { maxPrompts, allowedScrapers } = plan.limits;
  if (maxPrompts < 0) return null;
  const slotted = new Set();
  if (maxPrompts > 0) for (const id of allowedScrapers ?? STANDARD_SLOT_PLATFORMS) slotted.add(id);
  if (addOnSlots && typeof addOnSlots === 'object' && !Array.isArray(addOnSlots)) {
    for (const [id, slots] of Object.entries(addOnSlots)) {
      if (Number.isFinite(Number(slots)) && Number(slots) > 0) slotted.add(id);
    }
  }
  return slotted;
}
