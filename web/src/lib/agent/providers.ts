/**
 * The AI providers an organization can add a key for in Settings › AI
 * Providers, and what each needs besides the key. Shared by the settings
 * route, Chat and the settings form — no SDK imports here.
 */

export const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'azure', 'openrouter'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * What a saved key is for (W4-06, CHAT-16): Chat's answers, and image
 * generation. Missing: Chat only, as every key saved before was. Anthropic
 * has no image models, so its key is for Chat only.
 */
export const KEY_USES = ['chat', 'images'] as const;
export type KeyUse = (typeof KEY_USES)[number];

/** What a provider keeps besides the key: Azure's endpoint and deployment, a model, its uses. */
export interface AiProviderSettings {
  endpoint?: string;
  deployment?: string;
  model?: string;
  useFor?: KeyUse[];
}

/** Whether a provider can make images with its key. */
export const makesImages = (provider: AiProvider) => provider !== 'anthropic';

/** What a saved key is used for: its settings' list, Chat when none was set. */
export function keyUsesOf(provider: AiProvider, settings: AiProviderSettings | null | undefined) {
  const set = Array.isArray(settings?.useFor) ? settings.useFor : (['chat'] as KeyUse[]);
  return KEY_USES.filter((use) => set.includes(use) && (use !== 'images' || makesImages(provider)));
}

/** A request body's uses for a provider's key; null when it names none or one it can't have. */
export function parseKeyUses(provider: AiProvider, raw: unknown): KeyUse[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > KEY_USES.length) return null;
  if (!raw.every((use) => (KEY_USES as readonly unknown[]).includes(use))) return null;
  if (raw.includes('images') && !makesImages(provider)) return null;
  return KEY_USES.filter((use) => raw.includes(use));
}

/** The model Chat uses when the settings name none (Azure uses its deployment). */
export const DEFAULT_MODELS: Record<Exclude<AiProvider, 'azure' | 'openrouter'>, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.5',
  google: 'gemini-3.5-flash',
};

/** An OpenRouter model id, shown as the example: they name the model's maker. */
export const OPENROUTER_MODEL_EXAMPLE = 'openai/gpt-5.5';

/** Hosts an Azure OpenAI endpoint may be on — the ones @ai-sdk/azure treats as Azure. */
const AZURE_HOSTS = ['.openai.azure.com', '.services.ai.azure.com', '.cognitiveservices.azure.com'];

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const DEPLOYMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

/** An Azure OpenAI endpoint as its https origin, or null when it isn't one. */
export function azureEndpoint(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  return AZURE_HOSTS.some((host) => url.hostname.endsWith(host)) ? url.origin : null;
}

export type SettingsError = 'endpoint' | 'deployment' | 'model' | 'useFor';

/**
 * The settings a provider keeps, read from a request body: only its own
 * fields, trimmed. An error names the field that is missing or malformed.
 */
export function parseProviderSettings(
  provider: AiProvider,
  raw: unknown,
): { settings: AiProviderSettings } | { error: SettingsError } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof input[key] === 'string' ? input[key].trim() : '');
  // What the key is for (W4-06), kept beside its other settings when given.
  let uses: { useFor?: KeyUse[] } = {};
  if (input.useFor !== undefined) {
    const useFor = parseKeyUses(provider, input.useFor);
    if (!useFor) return { error: 'useFor' };
    uses = { useFor };
  }

  if (provider === 'azure') {
    const endpoint = azureEndpoint(text('endpoint'));
    if (!endpoint) return { error: 'endpoint' };
    const deployment = text('deployment');
    if (!DEPLOYMENT.test(deployment)) return { error: 'deployment' };
    return { settings: { endpoint, deployment, ...uses } };
  }

  const model = text('model');
  // OpenRouter has no default: its ids name the model's maker.
  if (provider === 'openrouter' && !model.includes('/')) return { error: 'model' };
  if (!model) return { settings: { ...uses } };
  // Some SDKs put the id in the URL's path (Gemini): no `..`, and a `/` only
  // where OpenRouter's ids need one.
  if (!MODEL_ID.test(model) || model.includes('..')) return { error: 'model' };
  if (provider !== 'openrouter' && model.includes('/')) return { error: 'model' };
  return { settings: { model, ...uses } };
}

/** The model Chat calls for a provider and its settings. */
export function chatModelId(provider: AiProvider, settings: AiProviderSettings): string {
  if (provider === 'azure') return settings.deployment ?? '';
  if (provider === 'openrouter') return settings.model ?? '';
  return settings.model || DEFAULT_MODELS[provider];
}
