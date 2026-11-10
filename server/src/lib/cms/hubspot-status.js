import supabaseAdmin from '../../config/supabase.js';
import { isSubscriptionActive } from '../../config/plans.js';
import { connectedBrands } from '../brand-integrations.js';
import { selectInChunks } from '../chunked-in.js';
import { isHubspotConfigured } from '../composio.js';
import { markDeliveryPublished } from '../content-published.js';
import { logger } from '../logger.js';
import { HubspotError, hubspotClient } from '../hubspot/client.js';
import { HUBSPOT, hubspotConnection, markSignInRefused } from '../hubspot/connection.js';
import { liveUrl, readPost } from './hubspot-blog.js';
import { brandPlanHasHubspot } from './hubspot-delivery.js';

/**
 * Pages sent to HubSpot as blog posts, published there since (#2140; 00522):
 * nothing calls back when a post goes live, so Ansvisor reads the posts its
 * sends made, as Wix's are read (wix-status.js). A published post is marked
 * published at its address; one deleted closes its send. Read when the
 * Library opens (a brand's newest sends, throttled by its route) and once a
 * day for all.
 */

/** Posts the Library's check reads: the newest sends. The daily sweep reads the rest. */
export const POSTS_ON_DEMAND = 10;
/** Posts the daily sweep reads a brand. */
export const POSTS_DAILY = 100;
/** Sends older than this aren't read again: a draft left that long stays one. */
const LOOK_BACK_MS = 60 * 24 * 60 * 60 * 1000;
/** Post reads that fail in a row before a check stops: HubSpot is down. */
const FAILURES_IN_A_ROW = 3;
const SWEEP_DEADLINE_MS = 10 * 60 * 1000;

const none = { checked: 0, published: [] };
const logged = (err) => ({ name: err?.name, code: err?.code });

/** A send whose post is gone from HubSpot: closed. The page's next send makes a new post. */
async function closeRemoved(send) {
  const { error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'failed', error: 'Removed in HubSpot' })
    .eq('id', send.id)
    .eq('status', 'sent');
  if (error) {
    logger.warn({ err: error, deliveryId: send.id }, '[hubspot-status] removal not kept');
  }
}

/**
 * Reads the brand's pages sent to its HubSpot blog and not yet seen live
 * (each page's latest such send, newest first, up to `limit`), and marks the
 * published ones published. Nothing without the plan's HubSpot, a live
 * sign-in and a blog picked; a sign-in refused stops the check and is marked.
 *
 * @returns {Promise<{ checked: number, published: { draftId: string|null, url: string }[] }>}
 */
export async function checkHubspotPublished(brandId, { limit = POSTS_ON_DEMAND, request } = {}) {
  if (!isHubspotConfigured()) return none;
  const connection = await hubspotConnection(brandId);
  const blogId = connection?.settings?.blog?.id ?? null;
  if (!connection?.connected || !blogId) return none;
  if (!(await brandPlanHasHubspot(brandId))) return none;
  const { data: rows, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, draft_id, status, published_url, external_id, target_collection, sent_at')
    .eq('brand_id', brandId)
    .eq('target', 'hubspot')
    .eq('target_collection', blogId)
    .eq('status', 'sent')
    .not('external_id', 'is', null)
    .gte('sent_at', new Date(Date.now() - LOOK_BACK_MS).toISOString())
    .order('sent_at', { ascending: false })
    .limit(limit * 4);
  if (error) throw new Error(error.message);
  // A page's latest send: an earlier one made the same post, updated since.
  const seen = new Set();
  const sends = [];
  for (const row of rows ?? []) {
    const key = row.draft_id ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    sends.push(row);
    if (sends.length === limit) break;
  }
  if (!sends.length) return none;

  const call = request ?? hubspotClient(connection.composioAccountId);
  const published = [];
  let checked = 0;
  let failures = 0;
  for (const send of sends) {
    let post;
    try {
      post = await readPost(call, send.external_id);
    } catch (err) {
      if (err instanceof HubspotError && err.code === 'auth') {
        if (connection.accountId) await markSignInRefused(connection.accountId);
        return { checked, published };
      }
      logger.warn({ err: logged(err), deliveryId: send.id }, '[hubspot-status] post not read');
      if (++failures === FAILURES_IN_A_ROW) break;
      continue;
    }
    failures = 0;
    checked++;
    if (!post || post.archivedInDashboard === true) {
      await closeRemoved(send);
      continue;
    }
    const url = liveUrl(post);
    if (!url) continue;
    await markDeliveryPublished(send, url);
    published.push({ draftId: send.draft_id, url });
  }
  return { checked, published };
}

/**
 * The daily check, for brands with HubSpot connected (on an active
 * subscription; the demo brand never), in a shuffled order so the deadline
 * leaves out different brands each day; one brand's failure is logged and
 * the next goes on.
 */
export async function sweepHubspotPublished() {
  if (!isHubspotConfigured()) return { brands: 0, published: 0 };
  const started = Date.now();
  const connections = await connectedBrands(HUBSPOT);
  if (!connections.length) return { brands: 0, published: 0 };
  const { data, error } = await selectInChunks(
    connections.map((c) => c.brandId),
    (ids) =>
      supabaseAdmin
        .from('brands')
        .select('id, organizations!inner(subscription_status)')
        .eq('is_demo', false)
        .in('id', ids),
  );
  if (error) throw new Error(`brands read: ${error.message}`);
  const due = (data ?? [])
    .filter((row) => isSubscriptionActive(row.organizations?.subscription_status))
    .map((row) => row.id);
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }
  let brands = 0;
  let published = 0;
  for (const brandId of due) {
    if (Date.now() - started > SWEEP_DEADLINE_MS) break;
    try {
      const result = await checkHubspotPublished(brandId, { limit: POSTS_DAILY });
      brands++;
      published += result.published.length;
    } catch (err) {
      logger.error({ err: logged(err), brandId }, '[hubspot-status] check failed');
    }
  }
  return { brands, published };
}
