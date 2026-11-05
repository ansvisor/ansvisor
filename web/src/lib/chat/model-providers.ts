/**
 * The model providers a workspace lets Chat use (W4-34; owner decision
 * 2026-11-02 evening): the company that makes a model, read from its
 * catalog id ("openai/gpt-6.1-sol" → openai). An Admin turns each on or off
 * in Settings › Chat (chat_settings.model_providers, 00469); a provider
 * not chosen takes its default here. Anthropic is always on: Auto runs on
 * its models. DeepSeek starts off, and runs only on providers hosted in the
 * US or the EU (lib/agent/openrouter.ts). A provider not listed here is off.
 * Shared by the browser and the server: no database here.
 */

/** Each provider, its product name, its default, and whether it can be turned off. */
export const MODEL_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', defaultOn: true, locked: true },
  { id: 'openai', name: 'OpenAI', defaultOn: true, locked: false },
  { id: 'google', name: 'Google', defaultOn: true, locked: false },
  { id: 'deepseek', name: 'DeepSeek', defaultOn: false, locked: false },
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number]['id'];

/** The Admin's choices, by provider. */
export type ModelProviderChoices = Partial<Record<ModelProvider, boolean>>;

export function isModelProvider(value: unknown): value is ModelProvider {
  return MODEL_PROVIDERS.some((provider) => provider.id === value);
}

/** The provider of a model by its catalog id; null for Auto or an id without one. */
export function providerOfModel(modelId: string | null | undefined): string | null {
  if (!modelId || !modelId.includes('/')) return null;
  return modelId.split('/')[0].toLowerCase();
}

/**
 * The maker of the model a workspace's own key runs, by the key's provider
 * and model id (Settings › AI Providers): OpenRouter by the id's prefix,
 * Azure as OpenAI (it runs OpenAI's models); null when it can't be told.
 */
export function keyModelProvider(keyProvider: string, modelId: string): string | null {
  if (keyProvider === 'openrouter') return providerOfModel(modelId);
  if (keyProvider === 'azure') return 'openai';
  return keyProvider;
}

/**
 * The choices to run on when they can't be read: every provider that can be
 * turned off reads as off, never as its default.
 */
export const PROVIDERS_OFF: ModelProviderChoices = Object.fromEntries(
  MODEL_PROVIDERS.filter((p) => !p.locked).map((p) => [p.id, false]),
);

/** The choices kept on chat_settings, read leniently: known providers and booleans only. */
export function parseProviderChoices(raw: unknown): ModelProviderChoices {
  const choices: ModelProviderChoices = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return choices;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isModelProvider(key) && typeof value === 'boolean') choices[key] = value;
  }
  return choices;
}

/** Whether Chat may use a provider's models: Anthropic always; else the choice, or the default. */
export function providerOn(choices: ModelProviderChoices, provider: string | null): boolean {
  const listed = MODEL_PROVIDERS.find((p) => p.id === provider);
  if (!listed) return false;
  if (listed.locked) return true;
  return choices[listed.id] ?? listed.defaultOn;
}

/** Whether Chat may run a model: Auto always; another by its provider. */
export function modelProviderOn(choices: ModelProviderChoices, modelId: string): boolean {
  return modelId === 'auto' || providerOn(choices, providerOfModel(modelId));
}
