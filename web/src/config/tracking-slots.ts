/**
 * Tracking slots per platform (owner's decision, 26–27 Nov 2026).
 *
 * A slot is one prompt tracked in one location on one platform, every day.
 * A plan includes slots on its standard platforms; a workspace buys more on
 * any platform below, in units of 100 (`SLOT_UNIT`), monthly or yearly
 * (yearly = 10 × monthly). Each platform is one Stripe price per interval,
 * found by its lookup key (`slotLookupKey`), never by price id: the ids differ
 * between the sandbox and live, the lookup keys don't.
 *
 * The prices follow what each platform costs to track. The UI never shows the
 * group or a weight; the price per 100 slots already says it.
 *
 * The server keeps a copy, `server/src/config/tracking-slots.json`;
 * tracking-slots.test.ts keeps the two the same.
 */

/** How many slots one Stripe unit adds. */
export const SLOT_UNIT = 100;

export type SlotGroup = 'standard' | 'mid' | 'signed_in';
export type SlotInterval = 'month' | 'year';

export interface SlotPlatform {
  /** The platform id answers are stored under (`prompts.platforms`). */
  id: string;
  /** The same id as Stripe's lookup keys and metadata write it. */
  stripeId: string;
  group: SlotGroup;
  /** List price of 100 slots for a month, in US cents. */
  centsPer100: number;
}

export const SLOT_PLATFORMS: readonly SlotPlatform[] = [
  { id: 'chatgpt-web', stripeId: 'chatgpt_web', group: 'standard', centsPer100: 1500 },
  { id: 'gemini-web', stripeId: 'gemini_web', group: 'standard', centsPer100: 1500 },
  { id: 'google-aio', stripeId: 'google_aio', group: 'standard', centsPer100: 1500 },
  { id: 'google-aimode', stripeId: 'google_aimode', group: 'standard', centsPer100: 1500 },
  { id: 'copilot-web', stripeId: 'copilot_web', group: 'standard', centsPer100: 1500 },
  { id: 'naver-web', stripeId: 'naver_web', group: 'standard', centsPer100: 1500 },
  { id: 'wenxin-web', stripeId: 'wenxin_web', group: 'standard', centsPer100: 1500 },
  { id: 'chatgpt-ads', stripeId: 'chatgpt_ads', group: 'mid', centsPer100: 4500 },
  { id: 'meta-ai-web', stripeId: 'meta_ai_web', group: 'mid', centsPer100: 4500 },
  { id: 'perplexity-web', stripeId: 'perplexity_web', group: 'signed_in', centsPer100: 6000 },
  { id: 'claude-web', stripeId: 'claude_web', group: 'signed_in', centsPer100: 6000 },
  { id: 'grok-web', stripeId: 'grok_web', group: 'signed_in', centsPer100: 6000 },
  { id: 'copilot-app', stripeId: 'copilot_app', group: 'signed_in', centsPer100: 6000 },
];

/**
 * The platforms a paid plan's own prompt locations run on (Growth and
 * Enterprise). Starter runs on its `allowedScrapers` instead.
 */
export const STANDARD_SLOT_PLATFORMS: readonly string[] = [
  'chatgpt-web',
  'gemini-web',
  'google-aio',
  'google-aimode',
  'copilot-web',
];

const BY_ID = new Map(SLOT_PLATFORMS.map((p) => [p.id, p]));
const BY_STRIPE_ID = new Map(SLOT_PLATFORMS.map((p) => [p.stripeId, p]));

/** The slot platform for a platform id, or null when slots aren't sold for it. */
export function slotPlatform(id: string): SlotPlatform | null {
  return BY_ID.get(id) ?? null;
}

/** The slot platform for Stripe's id (`chatgpt_web`), or null. */
export function slotPlatformFromStripe(stripeId: string): SlotPlatform | null {
  return BY_STRIPE_ID.get(stripeId) ?? null;
}

/** The Stripe price's lookup key: `addon_slots_chatgpt_web_month`. */
export function slotLookupKey(platformId: string, interval: SlotInterval): string | null {
  const platform = slotPlatform(platformId);
  return platform ? `addon_slots_${platform.stripeId}_${interval}` : null;
}

/** List price of 100 slots for one interval, in cents (yearly = 10 × monthly). */
export function slotUnitCents(platformId: string, interval: SlotInterval): number | null {
  const platform = slotPlatform(platformId);
  if (!platform) return null;
  return interval === 'year' ? platform.centsPer100 * 10 : platform.centsPer100;
}

/**
 * The slots a plan includes on each platform: its prompt locations
 * (`maxPrompts`) on each of its own platforms, 0 elsewhere. Starter's own
 * platforms are its `allowedScrapers`; Growth's and Enterprise's are the
 * standard five. -1 (no limit, self-hosted) carries through.
 */
export function includedSlots(limits: {
  maxPrompts: number;
  allowedScrapers?: readonly string[];
}): Record<string, number> {
  const own = limits.allowedScrapers ?? STANDARD_SLOT_PLATFORMS;
  const included: Record<string, number> = {};
  for (const id of own) included[id] = limits.maxPrompts;
  return included;
}
