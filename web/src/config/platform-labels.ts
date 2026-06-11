/**
 * Canonical platform display-name map.
 *
 * Centralized here so the insights charts, the page-level labels, and the CSV
 * export all render the same human-readable names instead of raw slugs. Always
 * look up with a fallback (`PLATFORM_LABELS[slug] ?? slug`) so unknown
 * platforms stay visible rather than disappearing.
 *
 * It also carries a few model-slug labels, because a couple of chart/progress
 * spots reuse this map to label models when no platform is available.
 */
export const PLATFORM_LABELS: Record<string, string> = {
  // Generic platform slugs.
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
  claude: 'Claude',
  grok: 'Grok',
  copilot: 'Copilot',
  'meta-ai': 'Meta AI',
  'google-ai-overviews': 'Google AI',
  'google-ai-mode': 'Google AI Mode',

  // Tracked scraper platform slugs, as stored in `prompt_results.platform`.
  'chatgpt-web': 'ChatGPT',
  'google-aio': 'Google AI Overview',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'perplexity-web': 'Perplexity',
  'gemini-web': 'Google Gemini',

  // Model slugs reused as a fallback label in a few chart/progress spots.
  'gpt-5-chat-latest': 'GPT-5',
  'gpt-5-mini': 'GPT-5 Mini',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};
