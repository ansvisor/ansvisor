/**
 * Ansvisor's colors for AI platforms: one palette for every chart that colors
 * a platform, so a platform has the same color on AI Traffic and on Prompts ›
 * Insights. A plain module (no 'use server'): import it anywhere.
 *
 * In the brand's colors rather than the platforms' own: the most common
 * engine in ink (the theme's primary, black on light and near-white on dark),
 * the others in warm, earthy tones that read on both themes and apart from
 * one another.
 */

/** A platform the palette doesn't know: a warm grey. */
export const PLATFORM_FALLBACK_COLOR = '#a8a29a';

/**
 * By platform key. The domains are the AI source list's
 * (`server/src/lib/ai-sources.json`), which the tracking snippet and the
 * Analytics sync both store: every key there needs a color here and a name in
 * `@/lib/traffic-platforms`, otherwise it renders as a grey raw hostname
 * (traffic-platforms.test.ts checks). The other ChatGPT hosts are kept for
 * rows from before the list (AT-004), and `unknown` for rows that predate
 * #288 (null source_platform). AI Traffic's colors as they were; its tests
 * hold them.
 *
 * Google Search's two AI answers send no referrer of their own, so they have
 * keys, not domains (the Prompt Volumes chart's): a rose clay and a heather,
 * apart from Gemini's ochre and from every color above (OKLab ΔE ≥ 8), from
 * each other and from the bars beside them on the chart (ΔE ≥ 15), and at
 * 3:1 or more on the card in both themes (platform-colors.test.ts checks).
 */
export const PLATFORM_COLORS: Readonly<Record<string, string>> = {
  'chatgpt.com': 'var(--primary)',
  'chat.openai.com': 'var(--primary)',
  'search.chatgpt.com': 'var(--primary)',
  'perplexity.ai': '#3f6f68',
  'claude.ai': '#c2603f',
  'gemini.google.com': '#c9973b',
  'copilot.microsoft.com': '#5f7f9a',
  'you.com': '#7a8450',
  'phind.com': '#c9b79c',
  'meta.ai': '#8c5e73',
  'poe.com': '#9a4a2e',
  'labs.google': '#d4b26a',
  'bing.com': '#6b8a99',
  'grok.com': '#a08c74',
  'deepseek.com': '#4f6f8f',
  unknown: PLATFORM_FALLBACK_COLOR,
  'google-ai-overviews': '#c47989',
  'google-ai-mode': '#7a62a6',
};

/**
 * The other names a platform goes by, lower-cased, to its key above: the
 * engine names the Prompt Volumes chart and the rest of the product show
 * (`@/config/platform-labels`, `@/lib/traffic-platforms`), the tracked
 * platforms' slugs (`prompt_results.platform`) and the AI source list's
 * aliases.
 */
const PLATFORM_ALIASES: Readonly<Record<string, string>> = {
  chatgpt: 'chatgpt.com',
  'chatgpt api': 'chatgpt.com',
  'chatgpt-web': 'chatgpt.com',
  'chatgpt-shopping': 'chatgpt.com',
  'chatgpt shopping': 'chatgpt.com',
  openai: 'chatgpt.com',
  'openai.com': 'chatgpt.com',
  'google ai overviews': 'google-ai-overviews',
  'ai overviews': 'google-ai-overviews',
  'google-aio': 'google-ai-overviews',
  'google ai mode': 'google-ai-mode',
  'ai mode': 'google-ai-mode',
  'google-aimode': 'google-ai-mode',
  gemini: 'gemini.google.com',
  'gemini api': 'gemini.google.com',
  'google gemini': 'gemini.google.com',
  'gemini-web': 'gemini.google.com',
  bard: 'gemini.google.com',
  'bard.google.com': 'gemini.google.com',
  copilot: 'copilot.microsoft.com',
  'microsoft copilot': 'copilot.microsoft.com',
  'copilot-web': 'copilot.microsoft.com',
  'copilot.com': 'copilot.microsoft.com',
  perplexity: 'perplexity.ai',
  'perplexity-web': 'perplexity.ai',
  claude: 'claude.ai',
  'claude api': 'claude.ai',
  grok: 'grok.com',
  'grok-web': 'grok.com',
  deepseek: 'deepseek.com',
  'meta ai': 'meta.ai',
  'meta-ai': 'meta.ai',
  phind: 'phind.com',
  poe: 'poe.com',
  'google labs': 'labs.google',
  bing: 'bing.com',
};

/** The palette's key for a platform's key, domain or name, or null when it has none. */
export function platformColorKey(platform: string): string | null {
  if (Object.hasOwn(PLATFORM_COLORS, platform)) return platform;
  const name = platform.trim().toLowerCase();
  if (Object.hasOwn(PLATFORM_COLORS, name)) return name;
  return Object.hasOwn(PLATFORM_ALIASES, name) ? PLATFORM_ALIASES[name] : null;
}

/** A platform's color, by its key, domain or name; the fallback grey for one the palette doesn't know. */
export function getPlatformColor(platform: string): string {
  const key = platformColorKey(platform);
  return key === null ? PLATFORM_FALLBACK_COLOR : PLATFORM_COLORS[key];
}
