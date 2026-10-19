/**
 * GA4 session-source classification (#704).
 *
 * Deliberately an explicit list rather than a pattern. Real data from a
 * connected property shows why both halves of that matter:
 *
 *   - One engine arrives under several source strings. `chatgpt.com`,
 *     `chatgpt` and `openai` are the same product; a list keyed on the exact
 *     string collapses them without guessing.
 *   - Substring matching is actively wrong. A `*.workers.dev` subdomain with
 *     "claude" in its name showed up as an ordinary referrer — a `includes()`
 *     check would have booked it as AI traffic and inflated the number nobody
 *     can then verify.
 *
 * Values are the same host-style identifiers the tracking snippet records in
 * ai_traffic_logs.source_platform, so the two origins name the same engine the
 * same way. They are still counted separately everywhere — matching names is
 * for comparison, never for summing.
 */

/**
 * Raw GA4 `sessionSource` → platform. Keys are matched exactly after
 * lowercasing and trimming; add observed variants here rather than loosening
 * the match.
 */
export const GA_SOURCE_PLATFORMS = {
  // OpenAI
  'chatgpt.com': 'chatgpt.com',
  'chat.openai.com': 'chatgpt.com',
  'search.chatgpt.com': 'chatgpt.com',
  chatgpt: 'chatgpt.com',
  openai: 'chatgpt.com',
  'openai.com': 'chatgpt.com',
  // Perplexity
  'perplexity.ai': 'perplexity.ai',
  'www.perplexity.ai': 'perplexity.ai',
  perplexity: 'perplexity.ai',
  // Anthropic
  'claude.ai': 'claude.ai',
  claude: 'claude.ai',
  // Google
  'gemini.google.com': 'gemini.google.com',
  gemini: 'gemini.google.com',
  'bard.google.com': 'gemini.google.com',
  // Microsoft
  'copilot.microsoft.com': 'copilot.microsoft.com',
  copilot: 'copilot.microsoft.com',
  // Others the snippet already knows about
  'you.com': 'you.com',
  'phind.com': 'phind.com',
  'meta.ai': 'meta.ai',
  'poe.com': 'poe.com',
  // Newer assistants, listed before they show up rather than after
  'grok.com': 'grok.com',
  grok: 'grok.com',
  'deepseek.com': 'deepseek.com',
  'chat.deepseek.com': 'deepseek.com',
  deepseek: 'deepseek.com',
};

/** Every raw source string worth asking GA4 for. */
export const GA_AI_SOURCE_VALUES = Object.keys(GA_SOURCE_PLATFORMS);

/**
 * The platform behind a raw GA4 source string, or null when unrecognised.
 * Unrecognised is a normal outcome — the caller stores the raw value so the
 * list above can grow from what customers actually receive.
 */
export function classifyGaSource(raw) {
  if (typeof raw !== 'string') return null;
  return GA_SOURCE_PLATFORMS[raw.trim().toLowerCase()] ?? null;
}
