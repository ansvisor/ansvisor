import supabaseAdmin from '../config/supabase.js';
import { chunkIds } from './chunked-in.js';
import { logger } from './logger.js';

/**
 * The Content Editor's AI image options (W4-09) wait in the public bucket
 * content-images under {organization_id}/ai-options/ until the person picks
 * one (web/src/lib/content/ai-image-store.ts). Use this image moves the
 * picked one out of that folder; the rest are dropped then, on Regenerate
 * or when the dialog closes, best effort. A drop that never came (a tab
 * closed, a call lost) leaves files nothing links to. The daily run removes
 * those here once they're a day old: nothing else in the bucket is touched,
 * and a picked image has already left ai-options/.
 */

/** The bucket the options are in (web: IMAGE_UPLOAD_BUCKET, 00272). */
export const CONTENT_IMAGE_BUCKET = 'content-images';
/** Each organization's folder for its options (web: ai-image-store.ts). */
export const OPTIONS_FOLDER = 'ai-options';
/** An option older than this is left over: nobody keeps the dialog open a day. */
export const OPTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Entries a listing returns per page (storage's own default). */
export const LIST_PAGE = 100;
/** Paths one remove call takes at most (storage's limit is 1000). */
export const REMOVE_BATCH = 1000;

/** The only paths this sweep removes: a file directly in an organization's ai-options/. */
const OPTION_PATH = new RegExp(`^[^/]+/${OPTIONS_FOLDER}/[^/]+$`);

/** A name the listing gave that is one path segment, not a way out of its folder. */
const isSegment = (name) =>
  typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !name.includes('/');

/** Every entry under a prefix, a page at a time (the listing is by name, so offsets stay put). */
async function listAll(bucket, prefix) {
  const entries = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(prefix, {
      limit: LIST_PAGE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    const page = data ?? [];
    entries.push(...page);
    if (page.length < LIST_PAGE) return entries;
  }
}

/**
 * True for a file (a folder has no id) whose created_at and updated_at are
 * both before the cutoff. A file with neither readable is kept.
 */
function isStale(entry, cutoff) {
  if (entry?.id == null) return false;
  const times = [entry.created_at, entry.updated_at]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter(Number.isFinite);
  return times.length > 0 && Math.max(...times) < cutoff;
}

/**
 * Removes one organization's options past the cutoff, counting the files
 * gone into `result.removed`. Throws on a storage error.
 */
async function sweepOrganization(bucket, organizationId, cutoff, result) {
  const folder = `${organizationId}/${OPTIONS_FOLDER}`;
  const paths = (await listAll(bucket, folder))
    .filter((entry) => isSegment(entry?.name) && isStale(entry, cutoff))
    .map((entry) => `${folder}/${entry.name}`)
    .filter((path) => OPTION_PATH.test(path));
  for (const batch of chunkIds(paths, REMOVE_BATCH)) {
    const { data, error } = await bucket.remove(batch);
    if (error) throw new Error(`remove: ${error.message}`);
    // Storage answers with what it removed: one the dialog dropped meanwhile isn't counted.
    result.removed += Array.isArray(data) ? data.length : batch.length;
  }
}

/**
 * Removes the AI image options nobody kept: every file in each
 * organization's content-images/{id}/ai-options/ made more than a day ago.
 * The organizations' folders are listed first (removing a folder's last
 * file takes the folder out of that listing), then each one's options, and
 * the old ones go in batches. An organization storage fails for is logged
 * and waits a day; the others go on. Never throws.
 *
 * @param {{ db?: object, now?: Date }} [options]
 * @returns {Promise<{ removed: number, organizations: number, failed: number }>}
 */
export async function sweepAiImageOptions({ db = supabaseAdmin, now = new Date() } = {}) {
  const cutoff = now.getTime() - OPTION_MAX_AGE_MS;
  const result = { removed: 0, organizations: 0, failed: 0 };
  let bucket;
  let organizationIds;
  try {
    bucket = db.storage.from(CONTENT_IMAGE_BUCKET);
    organizationIds = (await listAll(bucket, ''))
      .filter((entry) => entry?.id == null && isSegment(entry?.name))
      .map((entry) => entry.name);
  } catch (err) {
    logger.warn(
      { err: { name: err?.name, message: err?.message } },
      '[content-images] AI image options sweep could not list the organizations; it runs again tomorrow',
    );
    return result;
  }

  for (const organizationId of organizationIds) {
    result.organizations += 1;
    try {
      await sweepOrganization(bucket, organizationId, cutoff, result);
    } catch (err) {
      result.failed += 1;
      logger.warn(
        { err: { name: err?.name, message: err?.message }, organizationId },
        '[content-images] AI image options of an organization not swept; they go tomorrow',
      );
    }
  }

  logger.info(result, '[content-images] AI image options nobody kept swept');
  return result;
}
