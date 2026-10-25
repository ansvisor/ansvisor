import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/**
 * A sent page now live at `url` (Send to CMS #1331), as a webhook's
 * callback says (phase 1) or Webflow shows (phase 2): the delivery is
 * published there, and its page too when it is the page's latest delivery
 * (an older one's late word doesn't move the page's address back), keeping
 * the page in History as a "publish" version unless History's latest
 * version is already this page.
 *
 * A delivery published at the same address already changes nothing, but a
 * CMS id it now names. A new delivery of a page live at the same address
 * (the post updated in place) is the page as published again. The delivery
 * is written last: a write before it that fails throws, and the next try,
 * finding it not yet published, does it all again.
 *
 * @param {{ id: string, draft_id: string|null, status: string, published_url: string|null }} delivery
 * @param {string} url
 * @param {{ externalId?: string|null }} [options]
 */
export async function markDeliveryPublished(delivery, url, { externalId = null } = {}) {
  const now = new Date().toISOString();
  const own = externalId ? { external_id: externalId } : {};

  if (delivery.status === 'published' && delivery.published_url === url) {
    if (externalId) {
      const { error } = await supabaseAdmin
        .from('content_draft_deliveries')
        .update(own)
        .eq('id', delivery.id);
      if (error) throw new Error(error.message);
    }
    return;
  }
  if (delivery.draft_id) {
    const { data: latest, error: latestError } = await supabaseAdmin
      .from('content_draft_deliveries')
      .select('id')
      .eq('draft_id', delivery.draft_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new Error(latestError.message);
    if (latest?.id === delivery.id) await markDraftPublished(delivery.draft_id, url, now);
  }
  const { error: deliveryError } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'published', published_url: url, published_at: now, ...own })
    .eq('id', delivery.id);
  if (deliveryError) throw new Error(deliveryError.message);
}

/**
 * A page live at `url` (CE-013): Published, at that address, since `at`,
 * and kept in History as a "publish" version (00215 keeps it for the
 * server) unless History's latest version is already this page.
 */
export async function markDraftPublished(draftId, url, at = new Date().toISOString()) {
  const { error } = await supabaseAdmin
    .from('content_drafts')
    .update({ status: 'published', published_url: url, published_at: at })
    .eq('id', draftId);
  if (error) throw new Error(error.message);
  const { error: keepError } = await supabaseAdmin.rpc('content_draft_snapshot', {
    p_draft_id: draftId,
    p_origin: 'publish',
  });
  if (keepError) {
    logger.warn({ err: keepError }, '[content-published] publish version not kept');
  }
}

const MAX_URL = 2048;

/**
 * An http(s) address as the browser reads it (no stray whitespace kept),
 * without sign-in details (they'd be stored and shown as a link), or null.
 */
export function liveAddress(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href.length <= MAX_URL ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The linked action's Publish task done, once every page it names is
 * published (an action on several pages has a draft each), and the live
 * page added to what the action is measured on (validate.js basketScope):
 * a new page has its address only once it's live. A deleted action
 * (00168) is left as it is. Returns whether the task was completed.
 */
async function completePublishTask(draft, url, actorId) {
  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .select('id, payload')
    .eq('id', draft.action_id)
    .eq('brand_id', draft.brand_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!action) return false;
  const now = new Date().toISOString();
  const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  if (!pages.includes(url)) {
    const { error: pagesError } = await supabaseAdmin
      .from('actions')
      .update({ payload: { ...payload, pages: [...pages, url] }, updated_at: now })
      .eq('id', action.id);
    if (pagesError) throw new Error(pagesError.message);
  }

  const { data: others, error: othersError } = await supabaseAdmin
    .from('content_drafts')
    .select('id')
    .eq('action_id', action.id)
    .neq('id', draft.id)
    .neq('status', 'published')
    .is('archived_at', null);
  if (othersError) throw new Error(othersError.message);
  if ((others ?? []).length) return false;

  const { data: tasks, error: tasksError } = await supabaseAdmin
    .from('action_tasks')
    .select('id, status')
    .eq('action_id', action.id)
    .eq('task_key', 'publish_content');
  if (tasksError) throw new Error(tasksError.message);
  const todo = (tasks ?? []).filter((task) => task.status !== 'completed');
  for (const task of todo) {
    const { error: taskError } = await supabaseAdmin
      .from('action_tasks')
      .update({ status: 'completed', updated_at: now })
      .eq('id', task.id);
    if (taskError) throw new Error(taskError.message);
    // Best effort, as the drawer's: a missing trail entry doesn't undo the change.
    await supabaseAdmin.from('action_events').insert({
      action_id: action.id,
      event: 'task_status',
      data: { taskId: task.id, to: 'completed', draftId: draft.id, publishedUrl: url },
      actor_id: actorId,
    });
  }
  return todo.length > 0;
}

/**
 * A person marks a page live at `url` (CE-013): it becomes Published there
 * (markDraftPublished), so its Live page tab measures that address, and a
 * linked action gets its page and, with every page live, its Publish task
 * done. A page published again at another address moves there.
 *
 * @param {{ id: string, brand_id: string, action_id: string|null }} draft
 * @returns {Promise<{ publishedUrl: string, publishedAt: string, taskCompleted: boolean }>}
 */
export async function publishDraft(draft, url, actorId) {
  const at = new Date().toISOString();
  await markDraftPublished(draft.id, url, at);
  const taskCompleted = draft.action_id ? await completePublishTask(draft, url, actorId) : false;
  return { publishedUrl: url, publishedAt: at, taskCompleted };
}
