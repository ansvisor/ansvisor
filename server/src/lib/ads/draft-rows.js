import supabaseAdmin from '../../config/supabase.js';
import { AD_CHANNELS } from '../../config/ad-limits.js';

/**
 * Ads' saved ad drafts (00532) as the API answers them, read with the service
 * role, always by the organization and the brand: a session reads no row
 * (the table is the server's), so the drawer's read (opportunity.js) serves
 * them with the rows the plan opens. Written by drafts.js.
 */

export const DRAFT_COLUMNS =
  'id, channel, headlines, descriptions, context_hint, keywords, fact_ids, gate, status, source, created_at';

/** A row as the API answers it. */
export const draftOf = (row) => ({
  id: row.id,
  channel: row.channel,
  headlines: row.headlines ?? [],
  descriptions: row.descriptions ?? [],
  contextHint: row.context_hint ?? null,
  keywords: row.keywords ?? [],
  factIds: row.fact_ids ?? [],
  gate: row.gate ?? {},
  status: row.status,
  source: row.source,
  createdAt: row.created_at,
});

/** Newest first, ChatGPT, Google, then Microsoft. */
const byChannel = (a, b) => AD_CHANNELS.indexOf(a.channel) - AD_CHANNELS.indexOf(b.channel);

const drafts = (orgId, brandId, promptId) =>
  supabaseAdmin
    .from('ads_ad_drafts')
    .select(DRAFT_COLUMNS)
    .eq('organization_id', orgId)
    .eq('brand_id', brandId)
    .eq('prompt_id', promptId);

/** The prompt's latest draft of each channel (not one set aside), ChatGPT first. */
export async function readAdDrafts({ orgId, brandId, promptId }) {
  const { data, error } = await drafts(orgId, brandId, promptId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(AD_CHANNELS.length * 10);
  if (error) throw new Error(`ads_ad_drafts: ${error.message}`);
  const latest = new Map();
  for (const row of data ?? []) if (!latest.has(row.channel)) latest.set(row.channel, row);
  return [...latest.values()].map(draftOf).sort(byChannel);
}

/** The drafts a request's key made for the prompt, ChatGPT first; none when it made none. */
export async function draftsOfKey({ orgId, brandId, promptId, key }) {
  const { data, error } = await drafts(orgId, brandId, promptId).eq('request_key', key);
  if (error) throw new Error(`ads_ad_drafts: ${error.message}`);
  return (data ?? []).map(draftOf).sort(byChannel);
}
