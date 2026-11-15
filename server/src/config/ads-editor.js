/**
 * The columns of Ads' Google Ads Editor CSV (ADS-01 §3.2, §9.3), in one
 * place, read by lib/ads/export.js.
 *
 * TO CONFIRM against Google's page and a real Editor export. Every header
 * and value below is a placeholder until then: the names Google Ads Editor
 * is widely documented to use, not read from Google. The build session
 * could not open "Import a CSV file in Google Ads Editor"
 * (https://support.google.com/google-ads/editor/answer/30564):
 * support.google.com is outside its network allowlist (2026-11-14). Ops
 * reads the page, checks each name against a CSV exported by a real Editor
 * install (the plan's QA for §9.3), fixes any that differ, and sets
 * EDITOR_CONFIRMED to the date read.
 */

/** The date the names below were checked on Google's page and a real export; null until then. */
export const EDITOR_CONFIRMED = null;

/** Placeholders, to confirm (see above). */
export const EDITOR = Object.freeze({
  campaign: 'Campaign',
  adGroup: 'Ad group',
  status: 'Status',
  keyword: 'Keyword',
  /** The keyword's match type, in its own column: the keyword cell holds its words only. */
  matchType: 'Criterion Type',
  headline: (n) => `Headline ${n}`,
  description: (n) => `Description ${n}`,
  finalUrl: 'Final URL',
  /** Every row's status: nothing imported can serve before a person turns it on. */
  paused: 'Paused',
  /**
   * The match type of every keyword: Phrase, a product choice (the owner
   * may change it). Seeds and fan-outs are searches people and AI ran;
   * Exact would miss their variants, Broad reaches past the prompt.
   */
  match: 'Phrase',
});

/**
 * Ansvisor's own column, not Editor's: what Ads left out of a row (a final
 * URL off the brand's domains) and which channel's draft an ad is. To
 * confirm in QA that Editor ignores a column it doesn't know on import.
 */
export const NOTE_COLUMN = 'Ansvisor note';
