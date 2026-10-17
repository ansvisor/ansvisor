/**
 * AI referrers by the name their platform goes by. Keys are what the
 * tracking snippet (`server/src/public/t.js`) and the Analytics sync
 * (`server/src/lib/ga-sources.js`) store; `unknown` is kept only for
 * historical rows that predate #288 (null source_platform).
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
