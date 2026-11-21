/**
 * The Pulse's words shared by its e-mail (email.js) and its Slack message
 * (lib/slack/blocks/pulse.js, #2139). Pure.
 */

import { engineName } from '../../config/engine-names.js';

/** A platform slug's display name in the Pulse's copy. */
export function platformLabel(slug) {
  return engineName(slug);
}

/** A change with its sign, to one decimal: "+2.1", "-4", "0". */
export function signed(n, suffix = '') {
  const v = Math.round(n * 10) / 10;
  if (v > 0) return `+${v}${suffix}`;
  return `${v}${suffix}`;
}
