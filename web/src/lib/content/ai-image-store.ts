import { randomUUID } from 'node:crypto';
import type { GeneratedImage } from '@/lib/chat/images/provider';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  IMAGE_UPLOAD_BUCKET,
  IMAGE_UPLOAD_MAX_BYTES,
  imageUploadExtension,
} from './image-upload-types';

/**
 * Where the Content Editor's AI image options wait (CHAT-25 §9, W4-09): the
 * content-images bucket an upload goes to (00272), in the organization's
 * own folder, under ai-options/. The server stores each option as it is
 * made, so the browser gets addresses, never the images' bytes (a response
 * stays far under the host's body limit).
 *
 * Only ai-options/ is ever deleted from, so no image a page shows can be:
 * - Use this image moves the picked one to the folder's top, the path an
 *   upload gets ({organization_id}/{id}.{ext}), and drops the others.
 * - Regenerate drops the earlier set once the new one is in.
 * - Closing the dialog drops what is left, best effort (the browser asks
 *   on its way out; a tab closed or a call lost asks nothing).
 *
 * A missed drop leaves options in {organization_id}/ai-options/: public by
 * an address only the person who made them was given, linked from no page,
 * a few MB each. Nothing reads that folder, so a later sweep of anything
 * older than a day there can remove them; none runs yet.
 *
 * The options don't count toward the day's uploads (content_image_uploads):
 * each costs its share of the AI limit, which bounds them.
 */

const OPTIONS_FOLDER = 'ai-options';

/** An option's id, as the browser gets it and sends it back: its file name. */
export const AI_OPTION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/;

/** An option made and stored: its id and its public address. */
export interface StoredOption {
  id: string;
  url: string;
}

const bucket = () => supabaseAdmin.storage.from(IMAGE_UPLOAD_BUCKET);
const optionPath = (organizationId: string, id: string) =>
  `${organizationId}/${OPTIONS_FOLDER}/${id}`;
const publicUrl = (path: string) => bucket().getPublicUrl(path).data.publicUrl;

/** Stores one image as an option; null when it can't be (its type, its size, or the upload). */
async function storeOne(
  organizationId: string,
  image: GeneratedImage,
): Promise<StoredOption | null> {
  try {
    const type = image.mimeType.toLowerCase();
    const ext = imageUploadExtension(type);
    if (!ext) return null;
    const bytes = Buffer.from(image.base64, 'base64');
    if (bytes.length === 0 || bytes.length > IMAGE_UPLOAD_MAX_BYTES) return null;
    const id = `${randomUUID()}.${ext}`;
    const path = optionPath(organizationId, id);
    const { error } = await bucket().upload(path, bytes, {
      contentType: type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      console.error('[content/ai-images] could not store an option:', error.message);
      return null;
    }
    return { id, url: publicUrl(path) };
  } catch (error) {
    console.error('[content/ai-images] could not store an option:', error);
    return null;
  }
}

/**
 * Stores a request's images as options, in their order. Never throws: what
 * didn't go up is counted in `failed`, for the panel to say.
 */
export async function storeAiImageOptions(
  organizationId: string,
  images: readonly GeneratedImage[],
): Promise<{ stored: StoredOption[]; failed: number }> {
  const results = await Promise.all(images.map((image) => storeOne(organizationId, image)));
  const stored = results.filter((option): option is StoredOption => option !== null);
  return { stored, failed: results.length - stored.length };
}

/**
 * Drops options that weren't picked. Best effort: an id that isn't an
 * option's is ignored, and a failure is logged, never thrown.
 */
export async function dropAiImageOptions(
  organizationId: string,
  ids: readonly string[],
): Promise<void> {
  const paths = [...new Set(ids)]
    .filter((id) => AI_OPTION_ID.test(id))
    .map((id) => optionPath(organizationId, id));
  if (paths.length === 0) return;
  try {
    const { error } = await bucket().remove(paths);
    if (error) console.error('[content/ai-images] could not drop options:', error.message);
  } catch (error) {
    console.error('[content/ai-images] could not drop options:', error);
  }
}

/**
 * Use this image: the picked option moves to the path an upload gets, out
 * of ai-options/ (so no drop can reach it), and the others go. Its public
 * address, or null when it couldn't move (then nothing is dropped, and the
 * person can try again).
 */
export async function keepAiImageOption(
  organizationId: string,
  keep: string,
  drop: readonly string[],
): Promise<{ url: string } | null> {
  if (!AI_OPTION_ID.test(keep)) return null;
  const kept = `${organizationId}/${keep}`;
  try {
    const { error } = await bucket().move(optionPath(organizationId, keep), kept);
    if (error) {
      console.error('[content/ai-images] could not keep the option:', error.message);
      return null;
    }
  } catch (error) {
    console.error('[content/ai-images] could not keep the option:', error);
    return null;
  }
  await dropAiImageOptions(
    organizationId,
    drop.filter((id) => id !== keep),
  );
  return { url: publicUrl(kept) };
}
