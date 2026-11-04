import { z } from 'zod';
import { reserveDraftImages } from '@/lib/chat/budget';
import { imageKey } from '@/lib/chat/images/access';
import { EDITOR_IMAGE_VARIANTS, IMAGE_MODELS } from '@/lib/chat/images/models';
import { generateImages } from '@/lib/chat/images/provider';
import { OwnKeyUnreadableError } from '@/lib/chat/key';
import { createClient } from '@/lib/supabase/server';
import { DRAFT_IMAGE_RATIOS, DRAFT_IMAGE_STYLES } from './ai-image-options';
import { storeAiImageOptions, type StoredOption } from './ai-image-store';

/**
 * Images made in the Content Editor (CHAT-25 §9, W4-09), on the server: the
 * prompt the image model gets, with the editor's rules, and a request held
 * on the AI budget for the draft, made at 1K and charged at what OpenRouter
 * said it cost (no markup). Each image is stored as an option at once
 * (ai-image-store.ts), and the browser gets their addresses to pick from;
 * only the picked one is kept and goes into the page, marked as AI's.
 */

/**
 * The draft, read as the person (its brand's access, CHAT-20 §15b), with
 * its brand's name; null for one they can't open. The demo brand's drafts
 * make nothing (`demo`).
 */
export async function imageDraftOf(id: string) {
  const supabase = await createClient();
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('id, brand_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) return null;
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('name, is_demo')
    .eq('id', draft.brand_id)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (!brand) return null;
  return { id: draft.id as string, brandName: (brand.name as string) ?? '', demo: !!brand.is_demo };
}

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
  'Rules: an image only, never a web page, app screen, dashboard or a mock-up of one; no realistic people or faces; no charts, graphs or numbers; no words, letters, labels or logos anywhere in it unless the description above asks for them.';

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
        : `Style: clean, modern and warm, in colors that suit ${brandName || 'the brand'}.`;
  return [input.prompt, style, DRAFT_IMAGE_RULES].join('\n\n');
}

/** Why a request gave no image to pick: the person can act on each. */
export type DraftImagesFailure =
  | { code: 'unavailable' }
  | { code: 'own_key' }
  | { code: 'ai_limit'; trial: boolean }
  | { code: 'refused'; why: string }
  // Made, and charged, but none could be stored: the panel says so.
  | { code: 'not_saved'; made: number };

/**
 * The options to pick from, by address (never their bytes), and how many
 * images were made and charged but couldn't be stored.
 */
export type DraftImagesResult =
  | { ok: true; images: StoredOption[]; failed: number }
  | ({ ok: false } & DraftImagesFailure);

/**
 * A request for a draft of the workspace's (CHAT-25 §9): held on the AI
 * budget (each image at the model's price, the row on the draft), made at
 * 1K, charged at the provider's own cost, then stored as options. The
 * options come back as addresses; the picked one is kept and the others
 * dropped (ai-image-store.ts).
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
  // Settled before anything is stored: what the provider billed is charged
  // once, whatever the storage does next.
  await held.budget.charge({ produced: made.images.length, costUsd: made.costUsd });
  if (made.images.length === 0) {
    const why = (made.refusals[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return { ok: false, code: 'refused', why };
  }
  // Those that couldn't be stored stay charged (they were made), and the
  // panel says how many; the others are there to pick from.
  const { stored, failed } = await storeAiImageOptions(job.organizationId, made.images);
  if (stored.length === 0) return { ok: false, code: 'not_saved', made: made.images.length };
  return { ok: true, images: stored, failed };
}
