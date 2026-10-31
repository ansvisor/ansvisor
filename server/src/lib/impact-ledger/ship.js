/**
 * Shipped changes into the impact ledger (CHAT-22 §2 items 1–2, 00421),
 * behind CHAT_AGENTIC: a ship event and its measurement, Pending, with the
 * targets it is measured on frozen as it ships.
 *
 *   * resolveTargets: the prompts (at most MAX_TARGET_PROMPTS) and pages a
 *     change is measured on, as AffectedEntity[]: its action's frozen
 *     targets (payload.promptIds, else its topic's prompts), else its
 *     draft's prompts; the action's pages and the live address beside them.
 *     Only the brand's own prompts.
 *   * seedMeasurements: one Pending measurement per ship event that has
 *     none, first read at day 7. The nightly job (job.js) seeds what a
 *     writer didn't, so a ship event written anywhere is measured.
 *   * recordCmsPublish: a publish the CMS confirmed (Send to CMS: the
 *     webhook's callback or the CMS's own status), written once per send.
 *
 * Batched reads, 1000 rows a page; logs carry codes and counts, never a
 * customer's names, addresses or texts.
 */

import supabaseAdmin from '../../config/supabase.js';
import { chatAgenticDeployed, chatAgenticEnabled } from '../chat-flag.js';
import { chunkIds } from '../chunked-in.js';
import { logger } from '../logger.js';
import { MAX_TARGET_PROMPTS, checkAt } from './method.js';

/** Rows a read pages through at a time (PostgREST's max_rows). */
export const PAGE = 1000;
/** Most pages a change's targets name. */
export const MAX_TARGET_PAGES = 20;
/** Measurements written per insert. */
const SEED_CHUNK = 500;

/** A failed read or write, by what it was and the database's code: never its values. */
export class ImpactDbError extends Error {
  constructor(what, error) {
    super(`${what} failed`);
    this.name = 'ImpactDbError';
    this.code = error?.code ?? null;
  }
}

/** Every row a query gives, PAGE at a time; `build` makes the query afresh for each page. */
export async function readAll(what, build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new ImpactDbError(what, error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** An `.in()` read in slices of ids, each paged: never past the URL limit, never past max_rows. */
export async function readChunks(what, ids, build) {
  const rows = [];
  for (const chunk of chunkIds(ids)) rows.push(...(await readAll(what, () => build(chunk))));
  return rows;
}

const strings = (value) =>
  Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.length > 0) : [];
const clip = (text, max) => String(text ?? '').slice(0, max);

/** A page address the ledger keeps: http(s), at most 2000 characters (00421). */
function pageAddress(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value) && value.length <= 2000
    ? value
    : null;
}

/**
 * The targets of each ship event, as AffectedEntity[] ({ type, id, label }),
 * by ship event id. In a few batched reads, whatever the number of events.
 *
 * @param {object} db
 * @param {Array<{ id: string, brand_id: string, action_id?: string|null,
 *   content_draft_id?: string|null, url?: string|null }>} ships
 * @returns {Promise<Map<string, Array<{ type: string, id: string, label: string }>>>}
 */
export async function resolveTargets(db, ships) {
  const actions = new Map(
    (
      await readChunks('actions read', ships.map((s) => s.action_id).filter(Boolean), (chunk) =>
        db.from('actions').select('id, brand_id, payload').in('id', chunk).order('id'),
      )
    ).map((a) => [a.id, a]),
  );
  const drafts = new Map(
    (
      await readChunks(
        'drafts read',
        ships.map((s) => s.content_draft_id).filter(Boolean),
        (chunk) =>
          db.from('content_drafts').select('id, brand_id, prompt_ids').in('id', chunk).order('id'),
      )
    ).map((d) => [d.id, d]),
  );

  const wanted = new Map();
  for (const ship of ships) {
    const action = actions.get(ship.action_id);
    const payload = action?.brand_id === ship.brand_id && action.payload ? action.payload : {};
    let promptIds = strings(payload.promptIds);
    const draft = drafts.get(ship.content_draft_id);
    if (!promptIds.length && draft?.brand_id === ship.brand_id) {
      promptIds = strings(draft.prompt_ids);
    }
    const topicId =
      !promptIds.length && typeof payload.topicId === 'string' ? payload.topicId : null;
    const live =
      payload.publishedPages && typeof payload.publishedPages === 'object'
        ? Object.values(payload.publishedPages)
        : [];
    const pages = [
      ...new Set([...strings(payload.pages), ...live, ship.url].map(pageAddress).filter(Boolean)),
    ].slice(0, MAX_TARGET_PAGES);
    wanted.set(ship.id, { ship, promptIds: [...new Set(promptIds)], topicId, pages });
  }

  const all = [...wanted.values()];
  const promptRows = await readChunks(
    'target prompts read',
    all.flatMap((w) => w.promptIds),
    (chunk) =>
      db
        .from('prompts')
        .select('id, text, topic_id, prompt_sets!inner(brand_id)')
        .in('id', chunk)
        .order('id'),
  );
  const topicRows = await readChunks(
    'topic prompts read',
    all.map((w) => w.topicId).filter(Boolean),
    (chunk) =>
      db
        .from('prompts')
        .select('id, text, topic_id, prompt_sets!inner(brand_id)')
        .in('topic_id', chunk)
        .order('id'),
  );
  const promptOf = new Map(promptRows.map((p) => [p.id, p]));

  const targets = new Map();
  for (const { ship, promptIds, topicId, pages } of all) {
    const ownBrand = (p) => p?.prompt_sets?.brand_id === ship.brand_id;
    let prompts = promptIds.map((id) => promptOf.get(id)).filter(ownBrand);
    if (topicId) prompts = topicRows.filter((p) => p.topic_id === topicId && ownBrand(p));
    targets.set(ship.id, [
      ...prompts.slice(0, MAX_TARGET_PROMPTS).map((p) => ({
        type: 'prompt',
        id: p.id,
        label: clip(p.text, 200),
      })),
      ...pages.map((url) => ({ type: 'url', id: url, label: url })),
    ]);
  }
  return targets;
}

/**
 * One Pending measurement per ship event that has none yet, its targets
 * frozen now, first read at day 7 (an event shipped long ago is read at
 * once). Another writer's measurement is kept as it is. Says how many it
 * wrote.
 *
 * @param {object} db
 * @param {Array<{ id: string, brand_id: string, shipped_at: string }>} ships
 */
export async function seedMeasurements(db, ships) {
  if (ships.length === 0) return 0;
  const targets = await resolveTargets(db, ships);
  let written = 0;
  const rows = ships.map((ship) => ({
    ship_event_id: ship.id,
    targets: targets.get(ship.id) ?? [],
    next_check_at: checkAt(ship.shipped_at, 7),
  }));
  for (let i = 0; i < rows.length; i += SEED_CHUNK) {
    const { data, error } = await db
      .from('impact_measurements')
      .upsert(rows.slice(i, i + SEED_CHUNK), {
        onConflict: 'ship_event_id',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) throw new ImpactDbError('measurements insert', error);
    written += (data ?? []).length;
  }
  return written;
}

/**
 * A page the CMS confirmed live (markDeliveryPublished): a ship event
 * (cms_publish, from the Content Editor, a content change, assisted when a
 * person sent it, automated when nobody did) and its Pending measurement.
 * Once per send: the same send's publish confirmed again (a retry) finds
 * its ship event and writes nothing. Off with CHAT_AGENTIC, or for a
 * workspace it isn't on for, it writes nothing, and with it off reads
 * nothing either. Never throws: a ship event that fails is logged, and the
 * page stays published.
 *
 * @returns {Promise<string|null>} the ship event's id
 */
export async function recordCmsPublish({ deliveryId, url, publishedAt, db = supabaseAdmin }) {
  if (!chatAgenticDeployed()) return null;
  try {
    const { data: delivery, error } = await db
      .from('content_draft_deliveries')
      .select('id, organization_id, brand_id, draft_id, sent_by, title, created_at')
      .eq('id', deliveryId)
      .maybeSingle();
    if (error) throw new ImpactDbError('delivery read', error);
    if (!delivery || !chatAgenticEnabled(delivery.organization_id)) return null;
    const address = pageAddress(url);

    let seen = db
      .from('ship_events')
      .select('id')
      .eq('brand_id', delivery.brand_id)
      .eq('kind', 'cms_publish')
      .gte('shipped_at', delivery.created_at);
    seen = delivery.draft_id ? seen.eq('content_draft_id', delivery.draft_id) : seen;
    seen = address ? seen.eq('url', address) : seen.is('url', null);
    const { data: before, error: seenError } = await seen.limit(1);
    if (seenError) throw new ImpactDbError('ship events read', seenError);
    if (before?.length) return before[0].id;

    let draft = null;
    if (delivery.draft_id) {
      const { data, error: draftError } = await db
        .from('content_drafts')
        .select('id, title, action_id')
        .eq('id', delivery.draft_id)
        .maybeSingle();
      if (draftError) throw new ImpactDbError('draft read', draftError);
      draft = data;
    }

    const title = clip(draft?.title || delivery.title, 200) || 'Page';
    const { data: inserted, error: insertError } = await db
      .from('ship_events')
      .insert({
        organization_id: delivery.organization_id,
        brand_id: delivery.brand_id,
        kind: 'cms_publish',
        title,
        content_draft_id: delivery.draft_id ?? null,
        url: address,
        action_id: draft?.action_id ?? null,
        source: 'content_editor',
        change_type: 'content',
        shipped_at: publishedAt,
        shipped_by: delivery.sent_by ?? null,
        execution_mode: delivery.sent_by ? 'assisted' : 'automated',
      })
      .select('id, brand_id, action_id, content_draft_id, url, shipped_at');
    if (insertError) throw new ImpactDbError('ship event insert', insertError);
    const ship = inserted?.[0];
    if (!ship) return null;
    // The nightly job seeds it if this fails.
    try {
      await seedMeasurements(db, [ship]);
    } catch (err) {
      logger.warn(
        { err: { name: err?.name, code: err?.code ?? null } },
        '[impact-ledger] measurement not seeded',
      );
    }
    return ship.id;
  } catch (err) {
    logger.warn(
      { err: { name: err?.name, code: err?.code ?? null } },
      '[impact-ledger] cms publish not recorded',
    );
    return null;
  }
}
