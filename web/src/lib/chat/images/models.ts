/**
 * The image models Chat offers (CHAT-15 §E, Karar 4: Nano Banana 2 Lite,
 * Nano Banana 2, Nano Banana Pro and GPT-5 Image Mini, through OpenRouter),
 * by their catalog ids. The default is the cheapest of them by the price
 * data (owner decision 2026-11-03): the one whose image takes the smallest
 * share of the monthly limit (budget.ts readImageShares), the list's first
 * when no share is known. Four images a request in Chat, two to four in the
 * editor, at 1K. Shared by the browser and the server: no keys or prices.
 */

export interface ImageModel {
  /** OpenRouter's id. */
  id: string;
  /** Its product name. */
  label: string;
  /** Its key under chatEngine.images.models in messages/en.json: what it is good at. */
  key: string;
}

export const IMAGE_MODELS: readonly ImageModel[] = [
  { id: 'google/gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite', key: 'nanoBanana2Lite' },
  { id: 'google/gemini-3.1-flash-image', label: 'Nano Banana 2', key: 'nanoBanana2' },
  { id: 'google/gemini-3-pro-image', label: 'Nano Banana Pro', key: 'nanoBananaPro' },
  { id: 'openai/gpt-5-image-mini', label: 'GPT-5 Image Mini', key: 'gpt5ImageMini' },
];

/** Images one request makes in Chat (Karar 4). */
export const CHAT_IMAGE_VARIANTS = 4;
/** The editor's choice: 2 to 4. */
export const EDITOR_IMAGE_VARIANTS = { min: 2, max: 4 } as const;

export const isImageModel = (id: unknown): id is string =>
  IMAGE_MODELS.some((model) => model.id === id);

/**
 * The default image model: the one whose image is the smallest share of the
 * monthly limit (its price), among those with a share; the list's first
 * when none has one (no limit, or no prices read).
 */
export function defaultImageModel(
  shares: readonly { model: string; percent: number | null }[],
): ImageModel {
  let best: { model: ImageModel; percent: number } | null = null;
  for (const model of IMAGE_MODELS) {
    const percent = shares.find((share) => share.model === model.id)?.percent;
    if (typeof percent !== 'number' || !Number.isFinite(percent)) continue;
    if (!best || percent < best.percent) best = { model, percent };
  }
  return best?.model ?? IMAGE_MODELS[0];
}
