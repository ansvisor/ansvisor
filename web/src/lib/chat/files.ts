import { TRIAL_STORAGE_GB } from '@/config/plans';

/**
 * Files (CHAT-06): the work Chat finished, filed for the workspace in the
 * private bucket chat-files (00411), and the storage it may keep (items
 * 26–29). No server code here: the answer's actions and the Files page
 * read these too.
 */

export const CHAT_FILES_BUCKET = 'chat-files';

export const GB = 1024 ** 3;

/** A workspace's Files: what they hold, and what it may keep (null: no cap). */
export interface ChatStorage {
  usedBytes: number;
  limitBytes: number | null;
  fileCount: number;
}

/**
 * What a workspace may keep (item 26): its plan's GB (the free trial's
 * TRIAL_STORAGE_GB, whatever the plan), plus the storage packs it pays
 * for; null on a plan without a cap (self-host).
 */
export function storageLimitBytes(
  plan: { isTrial: boolean; maxStorageGb: number },
  grantBytes: number,
): number | null {
  if (plan.maxStorageGb < 0) return null;
  const included = (plan.isTrial ? TRIAL_STORAGE_GB : plan.maxStorageGb) * GB;
  return included + Math.max(0, grantBytes);
}

/** The meter's tone (items 27–29): the warning color from 80%, full at the limit. */
export function storageTone(storage: ChatStorage): 'ok' | 'warning' | 'full' {
  if (storage.limitBytes === null) return 'ok';
  if (storage.usedBytes >= storage.limitBytes) return 'full';
  return storage.usedBytes >= storage.limitBytes * 0.8 ? 'warning' : 'ok';
}

/** Whether a file this size still fits (item 29: a full workspace files nothing new). */
export function storageFits(storage: ChatStorage, bytes: number): boolean {
  return storage.limitBytes === null || storage.usedBytes + bytes <= storage.limitBytes;
}

/** GB as the meter shows it: one decimal, "0.1" for a little, never dollars. */
export function gbLabel(bytes: number): string {
  if (bytes <= 0) return '0';
  const gb = bytes / GB;
  return gb < 0.1 ? '0.1' : String(Math.round(gb * 10) / 10);
}
