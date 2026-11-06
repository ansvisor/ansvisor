/**
 * The prompts and pages a nightly action's work is about (AC-ACTION-PLAN
 * spec §10 item 1, P-3), kept on its payload as it opens: `promptIds` and
 * `pages`, as an action sent from Content, Insights or Product Visibility
 * already carries them. Without them, "Start now" and the Tasks tab's
 * Create content opened an empty draft: no prompts for its sources and
 * brief, and no page to optimize.
 *
 *   - promptIds: the prompts the action targets, or the prompts of the
 *     topics it targets (G16, C09), MAX_SCOPE_PROMPTS at most, the active
 *     ones first;
 *   - pages: the pages it targets (a path read on the brand's primary
 *     domain), else the pages its prompts are mapped to (prompt_target_urls),
 *     MAX_SCOPE_PAGES at most.
 *
 * Only the brand's own rows are read. A payload that names either already
 * keeps its own. Reads only; no AI call.
 */

import supabaseAdmin from '../../config/supabase.js';
import { selectInChunks } from '../chunked-in.js';
import { UUID, primaryHost } from './validate.js';

/** Prompts an action's payload lists by id, as Product Visibility's sends do (MAX_PROMPTS). */
export const MAX_SCOPE_PROMPTS = 50;
/** Pages it lists: each opens its own draft, so a handful. */
export const MAX_SCOPE_PAGES = 10;

/** The keys a payload counts its targets by: every one (`targetIds`) when it shows fewer. */
function targetKeys(payload) {
  const listed = Array.isArray(payload.targetIds)
    ? payload.targetIds
    : (Array.isArray(payload.targets) ? payload.targets : []).map((t) => t?.id);
  return [...new Set(listed.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim()))];
}

/** Whether the payload names prompts or pages of its own already. */
const named = (value) => Array.isArray(value) && value.length > 0;

/**
 * What the payload's targets say, before anything is read: its prompt ids,
 * its topic ids, and its pages (full addresses, and paths to read on the
 * brand's domain).
 */
export function scopeOf(payload = {}) {
  const keys = targetKeys(payload);
  const entity = payload.targetEntity;
  const topicIds = entity === 'topics' ? keys.filter((k) => UUID.test(k)) : [];
  if (typeof payload.topicId === 'string' && UUID.test(payload.topicId)) {
    topicIds.push(payload.topicId);
  }
  return {
    promptIds: entity === 'prompts' ? keys.filter((k) => UUID.test(k)) : [],
    topicIds: [...new Set(topicIds)],
    urls: entity === 'pages' ? keys.filter((k) => /^https?:\/\//i.test(k)) : [],
    paths: entity === 'pages' ? keys.filter((k) => k.startsWith('/')) : [],
  };
}

/** Pages once each, in order, by their address without a trailing slash or fragment. */
export function distinctPages(urls, max = MAX_SCOPE_PAGES) {
  const seen = new Set();
  const pages = [];
  for (const url of urls) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
    const key = url.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push(url);
    if (pages.length >= max) break;
  }
  return pages;
}

/** The topics' prompts, the active ones first, MAX_SCOPE_PROMPTS at most. */
async function topicPrompts(db, brandId, topicIds) {
  if (!topicIds.length) return [];
  const { data, error } = await db
    .from('prompts')
    .select('id, is_active, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .in('topic_id', topicIds)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(MAX_SCOPE_PROMPTS);
  if (error) throw new Error(`prompts read: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}

/** The pages the prompts are mapped to, in the prompts' order. */
async function mappedPages(db, promptIds) {
  if (!promptIds.length) return [];
  const { data, error } = await selectInChunks(promptIds, (chunk) =>
    db.from('prompt_target_urls').select('prompt_id, url').in('prompt_id', chunk),
  );
  if (error) throw new Error(`prompt_target_urls read: ${error.message}`);
  const order = new Map(promptIds.map((id, i) => [id, i]));
  return [...(data ?? [])]
    .sort((a, b) => (order.get(a.prompt_id) ?? 0) - (order.get(b.prompt_id) ?? 0))
    .map((row) => row.url);
}

/**
 * The payload with its work's prompts and pages (above), each added only
 * where it names none and one is found. Throws on a failed read: the caller
 * opens the action without them rather than not at all.
 *
 * @param {string} brandId
 * @param {Record<string, unknown>} payload
 * @param {{ db?: object }} [options]
 */
export async function withWorkScope(brandId, payload, { db = supabaseAdmin } = {}) {
  const wantsPrompts = !named(payload.promptIds);
  const wantsPages = !named(payload.pages);
  if (!wantsPrompts && !wantsPages) return payload;
  const scope = scopeOf(payload);

  let promptIds = wantsPrompts ? scope.promptIds.slice(0, MAX_SCOPE_PROMPTS) : payload.promptIds;
  if (wantsPrompts && !promptIds.length && scope.topicIds.length) {
    promptIds = await topicPrompts(db, brandId, scope.topicIds);
  }

  let pages = [];
  if (wantsPages) {
    const host = scope.paths.length ? await primaryHost(brandId, { db }) : null;
    const targeted = [
      ...scope.urls,
      ...(host ? scope.paths.map((path) => `https://${host}${path}`) : []),
    ];
    pages = distinctPages(
      targeted.length
        ? targeted
        : await mappedPages(
            db,
            promptIds.filter((id) => UUID.test(id)),
          ),
    );
  }

  return {
    ...payload,
    ...(wantsPrompts && promptIds.length ? { promptIds } : {}),
    ...(pages.length ? { pages } : {}),
  };
}
