/**
 * Each Ads channel's character limits for a draft's fields (ADS-01 §3.2;
 * owner decision 5, 2026-11-11), in one place, read by the claims gate
 * (lib/ads/claims.js).
 *
 * A limit is a number only when it was read on the channel's official spec
 * page, whose URL is cited beside it. Any other limit is null, "to confirm":
 * never a number from memory, a blog or a guess. A draft for a channel with
 * an unconfirmed field is still saved, with gate.limits 'unconfirmed' and the
 * fields named (gate.unconfirmed), so nothing pretends it was checked.
 *
 * To confirm (2026-11-14): none is confirmed yet. The build session could
 * not open the official pages (support.google.com and learn.microsoft.com
 * are outside its network allowlist, and OpenAI's ads documentation wasn't
 * tried after those two failed). Ops reads each page below, sets the
 * numbers with the page's URL and the date read, and how the channel counts
 * characters (wide characters count twice on some):
 *   - google: Google Ads Help, responsive search ads (headline, description);
 *   - microsoft: Microsoft Advertising Help, responsive search ads;
 *   - chatgpt: OpenAI's ads specs for ChatGPT, if they publish any
 *     (headline, description, context hint).
 */

/** The fields each channel's draft has; their limits in characters, null until confirmed. */
export const AD_LIMITS = Object.freeze({
  // To confirm: OpenAI's ads specs for ChatGPT, if any are published.
  chatgpt: Object.freeze({ headline: null, description: null, contextHint: null }),
  // To confirm: Google Ads Help, responsive search ads.
  google: Object.freeze({ headline: null, description: null }),
  // To confirm: Microsoft Advertising Help, responsive search ads.
  microsoft: Object.freeze({ headline: null, description: null }),
});

/** The channels drafts are written for, in the order the Pay card shows them (ADS-01 §10 A3). */
export const AD_CHANNELS = Object.freeze(['chatgpt', 'google', 'microsoft']);
