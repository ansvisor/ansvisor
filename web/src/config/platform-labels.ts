export const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: 'ChatGPT',
  'chatgpt-web': 'ChatGPT',
  'chatgpt-shopping': 'ChatGPT Shopping',
  'gpt-4o': 'ChatGPT',
  'gpt-5-mini': 'ChatGPT',
  'gpt-5-chat-latest': 'ChatGPT',
  perplexity: 'Perplexity',
  gemini: 'Gemini',
  claude: 'Claude',
  copilot: 'Copilot',
  'google-ai': 'Google AI Overview',
};

export function getPlatformDisplayName(slug: string | null | undefined): string {
  if (!slug) return '';
  if (slug.startsWith('gpt-')) return 'ChatGPT';
  return PLATFORM_LABELS[slug] || slug;
}
