import { readImageShares } from '../budget';
import { chatAgenticEnabled } from '../flag';
import {
  OwnKeyUnreadableError,
  ownChatKeyProvider,
  resolveChatModelKey,
  type ChatKeySource,
} from '../key';
import { IMAGE_MODELS, defaultImageModel, type ImageModel } from './models';

/**
 * Whose key images run on and what each image model costs as a share,
 * for Chat (W4-08) and the Content Editor (W4-09) alike, on the server.
 * The key: the workspace's own OpenRouter key when Chat runs on it (it
 * bills the workspace, the AI limit doesn't move), else Ansvisor's
 * (OPENROUTER_API_KEY), on the AI limit. An own key of another provider
 * can't make these images, so they run on Ansvisor's (CHAT-16 item 25).
 * No dollar leaves the server: a model shows a multiplier and a share.
 */

/** The key images run on, and whose it is. */
export interface ImageKey {
  key: string;
  source: ChatKeySource;
}

/**
 * The key a request runs on: the workspace's own OpenRouter key when Chat
 * runs on it, else Ansvisor's. Null when there is none (Ansvisor's isn't
 * set, or Chat's engine is off for the workspace: then nothing is metered,
 * so Ansvisor's key is never used). An own OpenRouter key that can't be
 * read throws OwnKeyUnreadableError, as for Chat: never Ansvisor's in its
 * place.
 */
export async function imageKey(organizationId: string): Promise<ImageKey | null> {
  let own: string | null = null;
  try {
    const chat = await resolveChatModelKey(organizationId);
    if (chat?.source === 'own' && chat.config.provider === 'openrouter') own = chat.config.apiKey;
  } catch (err) {
    if (!(err instanceof OwnKeyUnreadableError) || err.provider === 'openrouter') throw err;
  }
  if (own) return { key: own, source: 'own' };
  if (!chatAgenticEnabled(organizationId)) return null;
  const key = process.env.OPENROUTER_API_KEY;
  return key ? { key, source: 'ansvisor' } : null;
}

/** Whose key images would run on, read without decrypting it: for the fit and the options. */
export async function imageKeySource(organizationId: string): Promise<ChatKeySource> {
  const provider = await ownChatKeyProvider(organizationId).catch(() => null);
  return provider === 'openrouter' ? 'own' : 'ansvisor';
}

/**
 * A ratio as CHAT-16 item 11 writes it: "1x", "2x", "4x", "1.1x", "0.3x":
 * whole from 2x (the shares it comes from are rounded, so 2.07 is 2x), a
 * tenth below.
 */
export function multiplierOf(ratio: number): string {
  const rounded = ratio >= 2 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  return `${rounded}x`;
}

/** A share as the options say it: two decimals under 1%, one under 10%, whole above. */
export function percentOf(percent: number): string {
  if (percent < 1) return String(Math.round(percent * 100) / 100);
  if (percent < 10) return String(Math.round(percent * 10) / 10);
  return String(Math.round(percent));
}

/** One image model as the question offers it. */
export interface ImageModelOption {
  id: string;
  label: string;
  /** Its price against the default image model's: "1x", "2x"; null without prices. */
  multiplier: string | null;
  /** One image's share of the plan's monthly AI limit; null on the own key or without a limit. */
  sharePercent: number | null;
  recommended: boolean;
}

/**
 * Every image model, the default first (the cheapest by the price data),
 * each with its multiplier against it and, on Ansvisor's key, one image's
 * share of the monthly AI limit (CHAT-16 items 11 and 25). `ownKey`: the
 * images run on the workspace's own key.
 */
export async function imageModelOptions(
  organizationId: string,
): Promise<{ models: ImageModelOption[]; ownKey: boolean }> {
  const source = await imageKeySource(organizationId);
  const shares = await readImageShares(
    organizationId,
    IMAGE_MODELS.map((model) => model.id),
  );
  const pick = defaultImageModel(shares);
  const shareOf = (model: ImageModel) =>
    shares.find((share) => share.model === model.id)?.percent ?? null;
  const base = shareOf(pick);
  const ordered = [pick, ...IMAGE_MODELS.filter((model) => model.id !== pick.id)];
  return {
    models: ordered.map((model) => {
      const percent = shareOf(model);
      return {
        id: model.id,
        label: model.label,
        multiplier: base && percent !== null ? multiplierOf(percent / base) : null,
        sharePercent: source === 'own' ? null : percent,
        recommended: model.id === pick.id,
      };
    }),
    ownKey: source === 'own',
  };
}
