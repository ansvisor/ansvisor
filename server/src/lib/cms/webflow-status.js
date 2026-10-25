import supabaseAdmin from '../../config/supabase.js';
import { isSubscriptionActive } from '../../config/plans.js';
import { logger } from '../logger.js';
import { isWebflowConfigured } from '../composio.js';
import { markDeliveryPublished } from '../content-published.js';
import { WebflowError, getItem, listCollections, listSites } from './webflow.js';

/**
 * Pages sent to Webflow, published there since (Send to CMS #1331, phase
 * 2): nothing calls back when a Webflow item goes live, so Ansvisor reads
 * the items its sends made, and marks each one live published at the
 * page's address on the site: its host, the collection's slug and the
 * item's (the collection page Webflow makes). Read when the Library opens
 * (a brand at a time, throttled by its route) and once a day for all.
 */

/** Items one check reads at most: the most recent sends first. */
export const ITEMS_PER_CHECK = 25;
/** Sends older than this aren't read again: a draft left that long stays one. */
const LOOK_BACK_MS = 60 * 24 * 60 * 60 * 1000;
/** Brands the daily sweep checks, and for how long. */
export const SWEEP_LIMIT = 200;
const SWEEP_DEADLINE_MS = 10 * 60 * 1000;

const none = { checked: 0, published: [] };

/** The token was refused while reading: Settings asks for a new one. */
async function markRefused(connection) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('brand_id', connection.brand_id)
    .eq('provider', 'webflow')
    .eq('composio_account_id', connection.composio_account_id);
  if (error) logger.warn({ err: error }, '[webflow-status] refusal not kept');
}

/**
 * Reads the brand's pages sent to Webflow and not yet seen live (each
 * page's latest such send, up to ITEMS_PER_CHECK), and marks the live ones
 * published. A token refused stops the check and marks the connection.
 *
 * @returns {Promise<{ checked: number, published: { draftId: string|null, url: string }[] }>}
 */
export async function checkWebflowPublished(brandId) {
  if (!isWebflowConfigured()) return none;
  const { data: connection, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('brand_id, composio_account_id, composio_entity_id, status, site_id')
    .eq('brand_id', brandId)
    .eq('provider', 'webflow')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection || connection.status !== 'connected' || !connection.site_id) return none;

  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, draft_id, status, published_url, external_id, target_collection')
    .eq('brand_id', brandId)
    .eq('target', 'webflow')
    .eq('status', 'sent')
    .not('external_id', 'is', null)
    .not('target_collection', 'is', null)
    .gte('sent_at', new Date(Date.now() - LOOK_BACK_MS).toISOString())
    .order('sent_at', { ascending: false })
    .limit(ITEMS_PER_CHECK * 4);
  if (rowsError) throw new Error(rowsError.message);
  // A page's latest send: an earlier one made the same item, updated since.
  const seen = new Set();
  const sends = [];
  for (const row of rows ?? []) {
    const key = row.draft_id ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    sends.push(row);
    if (sends.length === ITEMS_PER_CHECK) break;
  }
  if (!sends.length) return none;

  const account = {
    entityId: connection.composio_entity_id,
    accountId: connection.composio_account_id,
  };
  const published = [];
  let checked = 0;
  try {
    const site = (await listSites(account)).find((s) => s.id === connection.site_id);
    if (!site?.host) return none;
    // A send to a collection since removed, or on another site, isn't read.
    const slugOf = new Map(
      (await listCollections(account, site.id)).filter((c) => c.slug).map((c) => [c.id, c.slug]),
    );
    for (const send of sends) {
      const collection = slugOf.get(send.target_collection);
      if (!collection) continue;
      const item = await getItem(account, send.target_collection, send.external_id);
      checked++;
      if (!item?.live || !item.slug) continue;
      const url = `https://${site.host}/${encodeURIComponent(collection)}/${encodeURIComponent(item.slug)}`;
      await markDeliveryPublished(send, url);
      published.push({ draftId: send.draft_id, url });
    }
  } catch (err) {
    if (err instanceof WebflowError && err.code === 'auth_failed') {
      await markRefused(connection);
      return { checked, published };
    }
    throw err;
  }
  return { checked, published };
}

/**
 * The daily check, for every brand with Webflow connected (on an active
 * subscription), one at a time until its deadline. A brand's failure is
 * logged and the next goes on.
 */
export async function sweepWebflowPublished() {
  if (!isWebflowConfigured()) return { brands: 0, published: 0 };
  const started = Date.now();
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('brand_id, brands!inner(organizations!inner(subscription_status))')
    .eq('provider', 'webflow')
    .eq('status', 'connected')
    .not('site_id', 'is', null)
    .limit(SWEEP_LIMIT);
  if (error) throw new Error(`brand_cms_connections read: ${error.message}`);
  let brands = 0;
  let published = 0;
  for (const row of data ?? []) {
    if (Date.now() - started > SWEEP_DEADLINE_MS) break;
    if (!isSubscriptionActive(row.brands?.organizations?.subscription_status)) continue;
    try {
      const result = await checkWebflowPublished(row.brand_id);
      brands++;
      published += result.published.length;
    } catch (err) {
      logger.error(
        { err: { name: err?.name }, brandId: row.brand_id },
        '[webflow-status] check failed',
      );
    }
  }
  return { brands, published };
}
