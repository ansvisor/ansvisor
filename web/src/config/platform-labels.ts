/**
 * Every engine's display name, by the platform id answers are stored under
 * (`prompt_results.platform`, `prompts.platforms`): the one place an engine's
 * name is written (GL-05, D10). Every screen, export and e-mail reads it from
 * here, so `gemini-web` is "Gemini" everywhere. The ids never change.
 *
 * The API-model platforms (`chatgpt`, `gemini`, `claude`, see
 * resolveModelPlatform in the tracking worker) carry an " API" suffix, so
 * "ChatGPT API" stands beside the ChatGPT app, never two plain "ChatGPT"s.
 *
 * The server keeps a copy for its e-mails and model prompts,
 * `server/src/config/engine-names.json`; platform-labels.test.ts keeps the
 * two the same.
 */
export const ENGINE_NAMES: Readonly<Record<string, string>> = {
  // Tracked scraper platform slugs.
  'chatgpt-web': 'ChatGPT',
  'chatgpt-shopping': 'ChatGPT Shopping',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'perplexity-web': 'Perplexity',
  'gemini-web': 'Gemini',

  // API-model platforms.
  chatgpt: 'ChatGPT API',
  gemini: 'Gemini API',
  claude: 'Claude API',

  // Older generic platform slugs.
  perplexity: 'Perplexity',
  grok: 'Grok',
  copilot: 'Microsoft Copilot',
  'meta-ai': 'Meta AI',
  'google-ai-overviews': 'Google AI Overviews',
  'google-ai-mode': 'Google AI Mode',
};

/**
 * Platform display-name map: the engines above plus a few model slugs.
 *
 * Centralized here so the insights charts, the page-level labels, and the CSV
 * export all render the same human-readable names instead of raw slugs. Always
 * look up with a fallback (`PLATFORM_LABELS[slug] ?? slug`, or `platformLabel`)
 * so unknown platforms stay visible rather than disappearing.
 *
 * The model slugs are here because a couple of chart/progress spots reuse
 * this map to label models when no platform is available.
 */
export const PLATFORM_LABELS: Record<string, string> = {
  ...ENGINE_NAMES,

  // Model slugs reused as a fallback label in a few chart/progress spots.
  'gpt-5-chat-latest': 'GPT-5',
  'gpt-5-mini': 'GPT-5 Mini',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};

/** A platform's display name, or its id when it isn't known. */
export function platformLabel(id: string): string {
  return PLATFORM_LABELS[id] ?? id;
}

/**
 * Model slug → provider-level display name ("claude-sonnet-5" → "Claude").
 * Used where rows are grouped per engine and the exact model variant is
 * noise: insights, citations, prompt detail (#435 — was copy-pasted on each
 * page). Look up with a fallback chain, e.g.
 * `MODEL_PROVIDER_LABELS[slug] ?? PLATFORM_LABELS[slug] ?? slug`.
 */
export const MODEL_PROVIDER_LABELS: Record<string, string> = {
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-5-chat-latest': 'ChatGPT',
  'claude-sonnet-5': 'Claude',
  'claude-sonnet-4-6': 'Claude',
  'claude-opus-4-6': 'Claude',
  'claude-haiku-4-5': 'Claude',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'grok-3': 'Grok',
  'grok-4-auto': 'Grok',
  'chatgpt-web': ENGINE_NAMES['chatgpt-web'],
  'perplexity-web': ENGINE_NAMES['perplexity-web'],
  'google-aio': ENGINE_NAMES['google-aio'],
  'google-aimode': ENGINE_NAMES['google-aimode'],
  'copilot-web': ENGINE_NAMES['copilot-web'],
  'grok-web': ENGINE_NAMES['grok-web'],
  'gemini-web': ENGINE_NAMES['gemini-web'],
  // Claude's API platform, so it names the family its models are in.
  claude: 'Claude',
};

/**
 * Model slug → model-level display name ("claude-sonnet-5" → "Claude Sonnet
 * 5"). Used where the model variant matters, e.g. the competitors page's
 * head-to-head badges. Only the Claude entries differ from the
 * provider-level map today; keep the two in sync when adding slugs.
 */
export const MODEL_LABELS: Record<string, string> = {
  ...MODEL_PROVIDER_LABELS,
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-sonnet-4-6': 'Claude Sonnet',
  'claude-opus-4-6': 'Claude Opus',
  'claude-haiku-4-5': 'Claude Haiku',
};
