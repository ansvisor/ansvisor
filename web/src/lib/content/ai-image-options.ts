/**
 * The Content Editor's Generate with AI (CHAT-25 §9, W4-09): its choices,
 * for the browser and the server alike. No keys or prices here.
 */

/** The style chips: the brand's look, an illustration, or a photo-like image. */
export const DRAFT_IMAGE_STYLES = ['brand', 'illustration', 'photo'] as const;
export type DraftImageStyle = (typeof DRAFT_IMAGE_STYLES)[number];

/** The shapes offered: a cover, a square, a classic one. */
export const DRAFT_IMAGE_RATIOS = ['16:9', '1:1', '4:3'] as const;
export type DraftImageRatio = (typeof DRAFT_IMAGE_RATIOS)[number];

/** A share of the monthly AI limit as the editor says it: two decimals under 1%, one under 10%. */
export function formatShare(percent: number): string {
  if (percent < 1) return String(Math.round(percent * 100) / 100);
  if (percent < 10) return String(Math.round(percent * 10) / 10);
  return String(Math.round(percent));
}
