import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { WebflowError, createItem, updateItem } from './webflow.js';
import { fieldDataFor, toWebflowRichText, webflowSlug } from './webflow-items.js';

/**
 * Send to CMS to Webflow (#1331, phase 2): a page goes to the brand's
 * Webflow collection (00283) as a draft item, or updates the item its last
 * Webflow send made in that collection. Nothing is published: Webflow's own
 * publish puts an item live. content-delivery.js reserves, writes and
 * batches the deliveries as it does for the webhook.
 */

/**
 * The item the page's last Webflow send made in this collection, if any,
 * whatever became of that send: one closed as "Removed in Webflow" is tried
 * too, as a wrong "removed" costs nothing (updateItem's not_found makes a
 * new item).
 */
async function lastItem(draftId, collectionId, deliveryId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('external_id')
    .eq('draft_id', draftId)
    .eq('target', 'webflow')
    .eq('target_collection', collectionId)
    .not('external_id', 'is', null)
    .neq('id', deliveryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.external_id ?? null;
}

/** The token the send was refused with: Settings asks for a new one. */
async function markRefused(connection) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('brand_id', connection.brand_id)
    .eq('provider', 'webflow')
    .eq('composio_account_id', connection.composio_account_id);
  if (error) logger.warn({ err: error }, '[content-delivery] webflow refusal not kept');
}

/**
 * Sends one page to the brand's Webflow collection: the item its last send
 * made there is updated (a new one is made when it was deleted in Webflow),
 * else a new draft item is made. What went wrong is said in our words.
 *
 * @returns {Promise<{ taken: boolean, failure?: string, refused?: boolean, externalId?: string,
 *   collectionId?: string, updated?: boolean, changed?: { tables: number, images: number } }>}
 */
export async function sendToWebflow({ delivery, page, html, jsonLd, connection }) {
  const account = {
    entityId: connection.composio_entity_id,
    accountId: connection.composio_account_id,
  };
  const collectionId = connection.collection_id;
  const { html: body, changed } = toWebflowRichText(html);
  // A slug in another script has nothing left: the draft's own, the same every send.
  const slug = webflowSlug(page.slug) ?? webflowSlug(page.title) ?? `page-${page.draftId}`;
  const fieldMap = connection.field_map ?? {};
  const fieldData = fieldDataFor({ page, slug, body, jsonLd }, fieldMap);
  try {
    const before = await lastItem(page.draftId, collectionId, delivery.id);
    let itemId = null;
    if (before) {
      try {
        itemId = await updateItem(account, collectionId, before, fieldData);
      } catch (err) {
        if (!(err instanceof WebflowError && err.code === 'not_found')) throw err;
      }
    }
    const updated = Boolean(itemId);
    // Only a new item is given the day it's sent: one sent again keeps its date.
    itemId ??= await createItem(
      account,
      collectionId,
      fieldDataFor({ page, slug, body, jsonLd, sentAt: new Date() }, fieldMap),
    );
    return { taken: true, externalId: itemId, collectionId, updated, changed };
  } catch (err) {
    if (err instanceof WebflowError) {
      if (err.code === 'auth_failed') {
        await markRefused(connection);
        return { taken: false, failure: err.message, refused: true };
      }
      return { taken: false, failure: err.message };
    }
    logger.warn(
      { err: { name: err?.name }, deliveryId: delivery.id },
      '[content-delivery] webflow send failed',
    );
    return { taken: false, failure: 'Webflow could not be reached' };
  }
}
