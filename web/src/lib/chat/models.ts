/**
 * The models Chat's model menu offers (CHAT-16 §A, W4-01): Auto, and the
 * models that passed Chat's tests on its rules (structured answers, the
 * guardrails, no made-up numbers). At launch that is Claude's three (Wave 4
 * decision 1 B); another model joins only once it passes the persona and
 * permission test set (W1-22). Each has its id in OpenRouter's catalog, which
 * the API server prices and labels by (lib/model-menu.js), and its id in its
 * provider's own API. Shared by the browser and the server: no keys here.
 */

/** What a run's `model` is when the person picked nothing: Haiku reads, Sonnet writes. */
export const AUTO_MODEL = 'auto';

/** The providers an offered model runs on, by their own API. */
export type OfferedModelProvider = 'anthropic';

export interface OfferedModel {
  /** The catalog's id ("anthropic/claude-sonnet-5.5"): what a run keeps as its model. */
  id: string;
  /** The provider's own API id ("claude-sonnet-5-5"). */
  api: string;
  provider: OfferedModelProvider;
}

export const OFFERED_MODELS: readonly OfferedModel[] = [
  { id: 'anthropic/claude-haiku-5.5', api: 'claude-haiku-5-5', provider: 'anthropic' },
  { id: 'anthropic/claude-sonnet-5.5', api: 'claude-sonnet-5-5', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-5.5', api: 'claude-opus-5-5', provider: 'anthropic' },
];

/** An offered model by its catalog id; null for Auto or one not offered. */
export function offeredModel(id: string | null | undefined): OfferedModel | null {
  return OFFERED_MODELS.find((model) => model.id === id) ?? null;
}

/** Whether a value is a model a run may ask for: Auto or an offered model. */
export function isChatModelChoice(value: unknown): value is string {
  return value === AUTO_MODEL || (typeof value === 'string' && offeredModel(value) !== null);
}

/** A model id as the catalog writes it ("provider/model"), offered or not. */
export function isCatalogId(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[A-Za-z0-9._~:-]{1,100}\/[A-Za-z0-9._~:-]{1,100}$/.test(value)
  );
}
