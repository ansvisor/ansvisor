import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fitImages, readImageShares, reserveImages } from '../budget';
import { fileChatImages, imageExtension, readChatStorage } from '../file-output';
import { storageFits } from '../files';
import { OwnKeyUnreadableError } from '../key';
import { PARTS_TOOL } from '../partial-limit';
import type { ChatToolContext } from '../registry/define-tool';
import {
  imageKey,
  imageKeySource,
  imageModelOn,
  imageModelOptions,
  percentOf,
  type ImageKey,
  type ImageModelOption,
} from './access';
import { IMAGE_MODELS } from './models';
import { generateImages } from './provider';

/**
 * Images in Chat (CHAT-15 §E, W4-08), on the server: the image model
 * question, how many images the AI limit left covers, and a request made,
 * metered and filed. The registry's rows (registry/image-tools.ts) call
 * these; the engine only asks how many fit (its parts check). Whose key
 * they run on, and each model's multiplier and share: access.ts.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.images' });
const costT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.costs' });

/** The image model question, ready for ask_question, and each model behind it. */
export interface ImageModelQuestion {
  question: string;
  /** As ask_question takes them: the recommended one first. */
  options: { label: string; detail: string; recommended: boolean }[];
  models: ImageModelOption[];
  ownKey: boolean;
}

/**
 * The image model question (CHAT-15 item 17, CHAT-16 items 11 and 25):
 * every image model, the default first (the cheapest by the price data),
 * each with its multiplier against it and, on Ansvisor's key, one image's
 * share of the monthly AI limit; on the workspace's own key, "Your key".
 * The question and options are ready for ask_question as they are.
 */
export async function imageModelQuestion(ctx: {
  organizationId: string | null;
}): Promise<ImageModelQuestion | { code: 'not_found' } | { code: 'off'; message: string }> {
  const organizationId = ctx.organizationId;
  if (!organizationId) return { code: 'not_found' };
  const { models, ownKey } = await imageModelOptions(organizationId);
  // Every image model's maker turned off (W4-34): nothing to ask.
  if (models.length === 0) return { code: 'off', message: t('providersOff') };
  const described = (option: ImageModelOption) => {
    const key = IMAGE_MODELS.find((model) => model.id === option.id)?.key;
    return key ? t(`models.${key}` as Parameters<typeof t>[0]) : null;
  };
  return {
    question: t('question'),
    options: models.map((model) => {
      const cost =
        model.multiplier === null
          ? null
          : ownKey
            ? t('ownKey', { multiplier: model.multiplier })
            : model.sharePercent !== null
              ? t('share', {
                  multiplier: model.multiplier,
                  percent: percentOf(model.sharePercent),
                })
              : t('plain', { multiplier: model.multiplier });
      return {
        label: model.label,
        detail: [cost, described(model)].filter(Boolean).join(' · '),
        recommended: model.recommended,
      };
    }),
    models,
    ownKey,
  };
}

/**
 * How many of `units` images on `model` the AI limit left covers (CHAT-04
 * item 17a), for the engine's parts check, and which limit binds. All of
 * them when the check gets no answer: the request's own hold still decides.
 */
export async function fitImageParts(job: {
  organizationId: string;
  model: string;
  units: number;
  agentRunId: string | null;
}): Promise<{ fits: number; limit: 'run' | 'month' }> {
  const fit = await fitImages({
    organizationId: job.organizationId,
    model: job.model,
    images: job.units,
    source: await imageKeySource(job.organizationId),
    agentRunId: job.agentRunId,
  });
  return fit.ok ? { fits: fit.fits, limit: fit.limit } : { fits: job.units, limit: 'month' };
}

/**
 * The card's line for a request (CHAT-20 §9 row 70's cost card): how many
 * images, on which model, and their share of the monthly AI limit, read
 * for the brand's workspace; on the workspace's own key, "on your own key".
 */
export async function imageCostLine(
  brandId: string,
  modelId: string,
  count: number,
): Promise<string> {
  const model = IMAGE_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  const organizationId = brand?.organization_id;
  if (!organizationId) return costT('images', { count, model });
  if ((await imageKeySource(organizationId)) === 'own') {
    return costT('imagesOwnKey', { count, model });
  }
  const [share] = await readImageShares(organizationId, [modelId]);
  return share?.percent !== null && share?.percent !== undefined
    ? costT('imagesShare', { count, model, percent: percentOf(share.percent * count) })
    : costT('images', { count, model });
}

/** What generate_image takes. */
export interface ImageRequestInput {
  brand_id: string;
  model: string;
  prompt: string;
  count: number;
  aspect_ratio?: string;
  title?: string;
}

/** A request's refusal, in the person's words (the engine's typed failure). */
const refusal = (reason: string, message: string) => ({ ok: false as const, reason, message });

/**
 * Before the card (CHAT-15 item 25, CHAT-06 item 29): Files has room for
 * the images (about 2 MB each at 1K), so none is made only to be lost; and
 * the AI limit left covers every one, or the model checks with the parts
 * check first, which asks the person, before any image is made. Null lets
 * it go on; a check that gets no answer lets it go on too (the hold
 * decides).
 */
export async function imagePrecheck(
  ctx: Pick<ChatToolContext, 'organizationId' | 'chat'>,
  input: Pick<ImageRequestInput, 'model' | 'count'>,
) {
  const organizationId = ctx.organizationId;
  if (!organizationId) return null;
  // A model whose maker an Admin turned off (W4-34): no card, nothing sent to it.
  if (!(await imageModelOn(organizationId, input.model).catch(() => false))) {
    const label = IMAGE_MODELS.find((m) => m.id === input.model)?.label ?? input.model;
    return refusal('unavailable', t('providerOff', { model: label }));
  }
  const storage = await readChatStorage(organizationId).catch(() => null);
  if (storage && !storageFits(storage, input.count * 2 * 1024 * 1024)) {
    return refusal('unavailable', t('storageFull'));
  }
  if (input.count > 1) {
    const { fits } = await fitImageParts({
      organizationId,
      model: input.model,
      units: input.count,
      agentRunId: ctx.chat?.agentRunId ?? null,
    });
    if (fits < input.count) {
      return refusal(
        'quota_exceeded',
        `The AI limit left covers ${fits} of these ${input.count} images. Call ${PARTS_TOOL} first with parts ${input.count}, unit "images" and this image_model, and follow it.`,
      );
    }
  }
  return null;
}

/**
 * A request (CHAT-15 items 21, 24–27): held on the AI budget at the model's
 * image price, made `count` at a time at 1K, charged at what OpenRouter said
 * it cost (no markup), and filed in Files as one set. A provider that makes
 * none says why in one line, for the model to offer a rephrased prompt.
 */
export async function makeChatImages(ctx: ChatToolContext, input: ImageRequestInput) {
  const organizationId = ctx.organizationId;
  const runId = ctx.chat?.runId;
  if (!organizationId || !runId) return refusal('unavailable', t('unavailable'));
  const model = IMAGE_MODELS.find((m) => m.id === input.model);
  if (!model) return refusal('invalid', t('unavailable'));
  // Its maker turned off since the card (W4-34): nothing goes to it.
  if (!(await imageModelOn(organizationId, model.id))) {
    return refusal('unavailable', t('providerOff', { model: model.label }));
  }

  let key: ImageKey | null;
  try {
    key = await imageKey(organizationId);
  } catch (err) {
    if (err instanceof OwnKeyUnreadableError) return refusal('unavailable', t('ownKeyUnreadable'));
    throw err;
  }
  if (!key) return refusal('unavailable', t('unavailable'));

  const held = await reserveImages({
    organizationId,
    runId,
    model: model.id,
    images: input.count,
    source: key.source,
    agentRunId: ctx.chat?.agentRunId ?? null,
  });
  if (!held.ok) {
    return held.refusal === 'unavailable'
      ? refusal('unavailable', t('unavailable'))
      : refusal('quota_exceeded', t('limit'));
  }

  let made;
  try {
    made = await generateImages({
      model: model.id,
      prompt: input.prompt,
      count: input.count,
      size: '1K',
      key: key.key,
      ...(input.aspect_ratio ? { aspectRatio: input.aspect_ratio } : {}),
    });
  } catch (err) {
    await held.budget.release();
    throw err;
  }
  // What it cost as the provider said, else each image made at its price (none made: nothing).
  // None made and none billed (every request refused): the hold goes, as for a step that billed
  // nothing; else what the provider said it cost, or each image made at its price.
  if (made.images.length === 0 && made.costUsd === 0) await held.budget.release();
  else await held.budget.charge({ produced: made.images.length, costUsd: made.costUsd });
  if (made.images.length === 0) {
    const why = (made.refusals[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return refusal('refused', t('refused', { why: why || '—' }));
  }

  const title =
    input.title?.trim() || t('title', { count: made.images.length, model: model.label });
  const filed = await fileChatImages({
    organizationId,
    createdBy: ctx.userId,
    brandId: input.brand_id,
    title,
    images: made.images.map((image) => ({
      bytes: new Uint8Array(Buffer.from(image.base64, 'base64')),
      mimeType: image.mimeType,
    })),
    origin: 'chat',
    conversationId: ctx.chat?.conversationId ?? null,
    messageId: null,
    runId,
    generatedAt: new Date().toISOString(),
    dataAsOf: null,
    timezone: null,
  });
  if (!filed.ok) return refusal('unavailable', t('notFiled'));
  return {
    ok: true as const,
    file_id: filed.id,
    title,
    format: imageExtension(made.images[0].mimeType),
    images: made.images.length,
    asked: input.count,
    model: model.label,
    prompt: input.prompt,
    ...(made.refusals.length > 0 ? { not_made: made.refusals.length } : {}),
  };
}
