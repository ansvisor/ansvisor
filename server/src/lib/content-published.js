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
    if (latest?.id === delivery.id) {
      const { error: draftError } = await supabaseAdmin
        .from('content_drafts')
        .update({ status: 'published', published_url: url, published_at: now })
        .eq('id', delivery.draft_id);
      if (draftError) throw new Error(draftError.message);
      // The page as published, in History (00215 keeps "publish" for the
      // server), unless History's latest version is already this page.
      const { error: keepError } = await supabaseAdmin.rpc('content_draft_snapshot', {
        p_draft_id: delivery.draft_id,
        p_origin: 'publish',
      });
      if (keepError) {
        logger.warn({ err: keepError }, '[content-published] publish version not kept');
      }
    }
  }
  const { error: deliveryError } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'published', published_url: url, published_at: now, ...own })
    .eq('id', delivery.id);
  if (deliveryError) throw new Error(deliveryError.message);
}
