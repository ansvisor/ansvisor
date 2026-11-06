import { readChatStorage } from '@/lib/chat/file-output';
import { storageFits } from '@/lib/chat/files';

/** What one AI image may take, as Chat's images reckon it before they are made. */
export const AI_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Whether `bytes` more fit the workspace's storage (00490): Chat's files
 * and its content images against its plan and storage packs. A read that
 * fails lets the image go on, as before images counted, and is logged.
 * Server only.
 */
export async function imageStorageFits(organizationId: string, bytes: number): Promise<boolean> {
  try {
    return storageFits(await readChatStorage(organizationId), bytes);
  } catch (error) {
    console.error('[content/images] could not read the workspace storage:', error);
    return true;
  }
}
