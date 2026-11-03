import { z } from 'zod';
import { reserveDraftImages } from '@/lib/chat/budget';
import { imageKey } from '@/lib/chat/images/access';
import { EDITOR_IMAGE_VARIANTS, IMAGE_MODELS } from '@/lib/chat/images/models';
import { generateImages } from '@/lib/chat/images/provider';
import { OwnKeyUnreadableError } from '@/lib/chat/key';
import { DRAFT_IMAGE_RATIOS, DRAFT_IMAGE_STYLES } from './ai-image-options';

/**
 * Images made in the Content Editor (CHAT-25 §9, W4-09), on the server: the
 * prompt the image model gets, with the editor's rules, and a request held
 * on the AI budget for the draft, made at 1K and charged at what OpenRouter
 * said it cost (no markup). The person picks one; only that one is uploaded
 * (content-images, as an upload is) and goes into the page, marked as AI's.
 */

export const draftImagesInput = z.strictObject({
  prompt: z.string().trim().min(3).max(1000),
  style: z.enum(DRAFT_IMAGE_STYLES).default('brand'),
  aspectRatio: z.enum(DRAFT_IMAGE_RATIOS).default('16:9'),
  model: z.enum(IMAGE_MODELS.map((model) => model.id) as [string, ...string[]]),
  count: z
    .number()
    .int()
    .min(EDITOR_IMAGE_VARIANTS.min)
    .max(EDITOR_IMAGE_VARIANTS.max)
    .default(EDITOR_IMAGE_VARIANTS.min),
});
export type DraftImagesInput = z.output<typeof draftImagesInput>;

/**
 * What every editor image keeps to (CHAT-25 §9; owner, 2026-11-02): no
 * product interface, no realistic people, no chart with numbers nobody gave,
 * no text unless asked. Appended to every prompt, after the person's words.
 */
export const DRAFT_IMAGE_RULES =
  "Rules: don't show a screenshot or mock-up of a product's interface; no realistic people or faces; no charts, graphs or figures with numbers; no text, letters or logos in the image unless the description above asks for them.";

/** The prompt the image model gets: the person's words, the style, then the rules. */
export function draftImagePrompt(
  input: Pick<DraftImagesInput, 'prompt' | 'style'>,
  brandName: string,
): string {
  const style =
    input.style === 'illustration'
      ? 'Style: a clean, flat illustration.'
      : input.style === 'photo'
        ? 'Style: photo-like, natural light, no people.'
        : `Style: clean and modern, to sit on ${brandName || 'the brand'}'s website.`;
  return [input.prompt, style, DRAFT_IMAGE_RULES].join('\n\n');
}

/** Why a request made no image: the person can act on each. */
export type DraftImagesFailure =
  | { code: 'unavailable' }
  | { code: 'own_key' }
  | { code: 'ai_limit'; trial: boolean }
  | { code: 'refused'; why: string };

export type DraftImagesResult =
  | { ok: true; images: { dataUrl: string }[] }
  | ({ ok: false } & DraftImagesFailure);

/**
 * A request for a draft of the workspace's (CHAT-25 §9): held on the AI
 * budget (each image at the model's price, the row on the draft), made at
 * 1K, charged at the provider's own cost. The images come back as data
 * addresses: nothing is kept until the person picks one.
 */
export async function makeDraftImages(job: {
  organizationId: string;
  draftId: string;
  brandName: string;
  input: DraftImagesInput;
}): Promise<DraftImagesResult> {
  let key;
  try {
    key = await imageKey(job.organizationId);
  } catch (err) {
    if (err instanceof OwnKeyUnreadableError) return { ok: false, code: 'own_key' };
    throw err;
  }
  if (!key) return { ok: false, code: 'unavailable' };

  const held = await reserveDraftImages({
    organizationId: job.organizationId,
    draftId: job.draftId,
    model: job.input.model,
    images: job.input.count,
    source: key.source,
  });
  if (!held.ok) {
    return held.refusal === 'ai_limit' || held.refusal === 'plan_limit'
      ? { ok: false, code: 'ai_limit', trial: held.trial }
      : { ok: false, code: 'unavailable' };
  }

  let made;
  try {
    made = await generateImages({
      model: job.input.model,
      prompt: draftImagePrompt(job.input, job.brandName),
      count: job.input.count,
      size: '1K',
      key: key.key,
      aspectRatio: job.input.aspectRatio,
    });
  } catch (err) {
    await held.budget.release();
    throw err;
  }
  await held.budget.charge({ produced: made.images.length, costUsd: made.costUsd });
  if (made.images.length === 0) {
    const why = (made.refusals[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return { ok: false, code: 'refused', why };
  }
  return {
    ok: true,
    images: made.images.map((image) => ({
      dataUrl: `data:${image.mimeType};base64,${image.base64}`,
    })),
  };
}
