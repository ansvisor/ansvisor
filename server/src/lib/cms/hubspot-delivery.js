import supabaseAdmin from '../../config/supabase.js';
import { getPlan, hasFeature } from '../../config/plans.js';
import { logger } from '../logger.js';
import { applyPlanOverrides } from '../plan-guard.js';
import { HubspotError, hubspotClient } from '../hubspot/client.js';
import { markSignInRefused } from '../hubspot/connection.js';
import { createDraftPost, postOf, updateDraftPost } from './hubspot-blog.js';

/**
 * Send to CMS to HubSpot (#2140; 00522): a page goes to the brand's HubSpot
 * blog as a draft post, or updates the draft of the post its last HubSpot
 * send made on that blog. A live post keeps what people read until the
 * person publishes the changes in HubSpot. content-delivery.js reserves,
 * writes and batches the deliveries as it does for the other CMSs.
 *
 * The page's title, slug, meta title and meta description go as the post's
 * own; its JSON-LD goes to the post's head; its featured image, when it has
 * one, as the post's featured image. Images in the body stay, as links.
 */

/** Our words for HubSpot's refusals of a send. */
const FAILURES = {
  scopes:
    "HubSpot didn't give Ansvisor access to blog posts (the content scope). Connect HubSpot again in Settings › Integrations.",
  forbidden: "HubSpot refused to write the blog post. Check the HubSpot user's blog permissions.",
  invalid: "HubSpot didn't take the post as it is.",
  conflict: 'HubSpot already has a post with this slug. Change the slug and send again.',
  rate_limited: 'HubSpot asked to wait. Send again in a minute.',
};

/**
 * The post the page's last HubSpot send made on this blog, if any, whatever
 * became of that send. The blog is its id (the delivery's target_collection).
 */
async function lastPost(draftId, blogId, deliveryId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, external_id')
    .eq('draft_id', draftId)
    .eq('target', 'hubspot')
    .eq('target_collection', blogId)
    .not('external_id', 'is', null)
    .neq('id', deliveryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.external_id ? data : null;
}

/**
 * Whether the brand's plan has HubSpot (crm_integrations, Growth and above):
 * the API server's own check, as the routes' requireFeature is the person's.
 */
export async function brandPlanHasHubspot(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('organizations!inner(plan, plan_overrides)')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const org = data?.organizations;
  if (!org) return false;
  return hasFeature(applyPlanOverrides(getPlan(org.plan), org), 'crm_integrations');
}

/**
 * Sends one page to the brand's HubSpot blog. What went wrong is said in our
 * words; HubSpot refusing the sign-in marks it for reconnecting.
 *
 * @param {{ delivery: { id: string }, page: object, html: string, jsonLd?: object[],
 *   connection: { accountId: string|null, composioAccountId: string, blogId: string },
 *   request?: Function }} input `request`: the tests' stand-in for the HubSpot client
 * @returns {Promise<{ taken: boolean, failure?: string, refused?: boolean, externalId?: string,
 *   collectionId?: string, updated?: boolean, live?: boolean, changed?: object }>}
 */
export async function sendToHubspot({ delivery, page, html, jsonLd = [], connection, request }) {
  const call = request ?? hubspotClient(connection.composioAccountId);
  const blogId = connection.blogId;
  try {
    const post = postOf({ page, html, jsonLd, blogId });
    const last = await lastPost(page.draftId, blogId, delivery.id);
    let written = null;
    if (last) {
      try {
        written = await updateDraftPost(call, last.external_id, post);
      } catch (err) {
        // Deleted in HubSpot: the page goes as a new post.
        if (!(err instanceof HubspotError && err.code === 'not_found')) throw err;
      }
    }
    const updated = Boolean(written);
    written ??= await createDraftPost(call, post);
    const externalId = written?.id ?? (updated ? last.external_id : null);
    if (!externalId) {
      return { taken: false, failure: "HubSpot didn't say which post it made" };
    }
    return {
      taken: true,
      externalId: String(externalId),
      collectionId: blogId,
      updated,
      live: false,
      changed: {},
    };
  } catch (err) {
    if (err instanceof HubspotError) {
      if (err.code === 'auth' || err.code === 'no_sign_in') {
        if (connection.accountId) await markSignInRefused(connection.accountId);
        return {
          taken: false,
          failure: 'HubSpot refused the sign-in. Connect it again in Settings › Integrations.',
          refused: true,
        };
      }
      // A missing scope stops the batch too: no page of it can go.
      if (err.code === 'scopes') return { taken: false, failure: FAILURES.scopes, refused: true };
      return { taken: false, failure: FAILURES[err.code] ?? 'HubSpot answered an error' };
    }
    logger.warn(
      { err: { name: err?.name }, deliveryId: delivery.id },
      '[content-delivery] hubspot send failed',
    );
    return { taken: false, failure: 'HubSpot could not be reached' };
  }
}
