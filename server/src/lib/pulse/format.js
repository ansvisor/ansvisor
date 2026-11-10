/**
 * The Pulse's words shared by its e-mail (email.js) and its Slack message
 * (lib/slack/blocks/pulse.js, #2139). Pure.
 */

// Display names for platform slugs used in the Pulse's copy. Keep in sync with
// PLATFORM_LABELS in web/src/config/platform-labels.ts.
const PLATFORM_LABELS = {
  'chatgpt-web': 'ChatGPT',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'perplexity-web': 'Perplexity',
  'gemini-web': 'Google Gemini',
};

export function platformLabel(slug) {
  return PLATFORM_LABELS[slug] ?? slug;
}

/** A change with its sign, to one decimal: "+2.1", "-4", "0". */
export function signed(n, suffix = '') {
  const v = Math.round(n * 10) / 10;
  if (v > 0) return `+${v}${suffix}`;
  return `${v}${suffix}`;
}
