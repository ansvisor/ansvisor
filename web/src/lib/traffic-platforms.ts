/**
 * AI referrers by the name their platform goes by. Keys are the AI source
 * list's (`server/src/lib/ai-sources.json`), which the tracking snippet and
 * the Analytics sync both store (AT-004). The other ChatGPT hosts are kept
 * for rows from before the list, and `unknown` for historical rows that
 * predate #288 (null source_platform).
 */
const PLATFORM_NAMES: Record<string, string> = {
  'chatgpt.com': 'ChatGPT',
  'chat.openai.com': 'ChatGPT',
  'search.chatgpt.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'you.com': 'You.com',
  'phind.com': 'Phind',
  'meta.ai': 'Meta AI',
  'poe.com': 'Poe',
  'labs.google': 'Google Labs',
  'bing.com': 'Bing',
  'grok.com': 'Grok',
  'deepseek.com': 'DeepSeek',
  unknown: 'Unknown',
};

export function getPlatformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

/**
 * A platform the page can name. The snippet's beacon is public, so a source
 * key can be anything a caller sent. The weekly digest's isNamedPlatform
 * (platform-names.json, the same names) reads it the same way, so the two
 * name the same platform as the one that sent the most.
 */
export function isNamedPlatform(platform: string): boolean {
  return platform !== 'unknown' && Object.hasOwn(PLATFORM_NAMES, platform);
}
