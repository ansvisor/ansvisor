import { createClient } from '@/lib/supabase/client';

/**
 * Upload an image instead of pasting its address (00272): most people have
 * the screenshot or photo on their computer. The browser sends it straight
 * to the content-images bucket (no server action's body limit), under the
 * member's organization's folder, and the page and the CMS show it by its
 * public address.
 */

export const IMAGE_UPLOAD_BUCKET = 'content-images';
/** The bucket's own limit: 5 MB a file. */
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** The types the bucket takes, with the extension each is saved under. */
export const IMAGE_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
/** The file picker's filter. */
export const IMAGE_UPLOAD_ACCEPT = Object.keys(IMAGE_UPLOAD_TYPES).join(',');

export type ImageUploadError = 'type' | 'size' | 'failed';

/** Why a file can't go up, before it is sent, or null. */
export function imageUploadProblem(file: File): ImageUploadError | null {
  if (!(file.type in IMAGE_UPLOAD_TYPES)) return 'type';
  if (file.size > IMAGE_UPLOAD_MAX_BYTES) return 'size';
  return null;
}

/**
 * A new file name: randomUUID, or 16 random bytes in hex where the browser
 * lacks it (it needs https or localhost; a self-host may run on plain http).
 */
function newName(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/** Uploads one image: its public address, or why it didn't go up. */
export async function uploadContentImage(
  file: File,
): Promise<{ url: string } | { error: ImageUploadError }> {
  const problem = imageUploadProblem(file);
  if (problem) return { error: problem };
  const supabase = createClient();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: 'failed' };
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.organization_id) return { error: 'failed' };
    // A new name each time: nothing already up is overwritten.
    const path = `${profile.organization_id}/${newName()}.${IMAGE_UPLOAD_TYPES[file.type]}`;
    const { error } = await supabase.storage.from(IMAGE_UPLOAD_BUCKET).upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      console.error('Failed to upload the image:', error.message);
      return { error: 'failed' };
    }
    return { url: supabase.storage.from(IMAGE_UPLOAD_BUCKET).getPublicUrl(path).data.publicUrl };
  } catch (err) {
    console.error('Failed to upload the image:', err);
    return { error: 'failed' };
  }
}
