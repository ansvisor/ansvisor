/**
 * Shipped changes into the impact ledger (CHAT-22 §2 items 1–2, 00421),
 * behind CHAT_AGENTIC: a ship event and its measurement, Pending, with the
 * targets it is measured on frozen as it ships.
 *
 *   * resolveTargets: the prompts (at most MAX_TARGET_PROMPTS) and pages a
 *     change is measured on, as AffectedEntity[]: its action's frozen
 *     targets as Action Center's own measure reads them, else its draft's
 *     prompts; the action's pages and the live address beside them. Only
 *     the brand's own prompts.
 *   * seedMeasurements: one Pending measurement per ship event that has
 *     none, first read at day 7. The nightly job (job.js) seeds what a
 *     writer didn't, so a ship event written anywhere is measured.
 *   * recordCmsPublish: a publish the CMS confirmed (Send to CMS: the
 *     webhook's callback or the CMS's own status), written once per send,
 *     and once for a draft published again within REPUBLISH_DAYS.
 *
 * Batched reads, 1000 rows a page; logs carry codes and counts, never a
 * customer's names, addresses or texts.
 */

import supabaseAdmin from '../../config/supabase.js';
import { chatAgenticDeployed, chatAgenticEnabled } from '../chat-flag.js';
import { chunkIds } from '../chunked-in.js';
import { basketScope } from '../action-center/basket-metrics.js';
import { targetScope } from '../action-center/validate.js';
import { logger } from '../logger.js';
import { MAX_TARGET_PROMPTS, checkAt } from './method.js';

/** Rows a read pages through at a time (PostgREST's max_rows). */
export const PAGE = 1000;
/** Most pages a change's targets name. */
export const MAX_TARGET_PAGES = 20;
/** Measurements written per insert. */
const SEED_CHUNK = 500;
const DAY_MS = 86_400_000;

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
 * by ship event id: its action's, as Action Center's own measure reads them
 * (basketScope: payload.promptIds, or an older action's opportunity
 * clusters or topic; targetScope: the night engine's targetEntity and
 * targetIds), else its draft's prompts; the action's pages and the live
 * address beside them. Only the brand's own prompts, at most
 * MAX_TARGET_PROMPTS. Actions, drafts and prompts are read in batches; only
 * an older action's opportunity or topic, or a page written as a path, reads
 * on its own.
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
        db.from('actions').select('id, brand_id, kind, payload').in('id', chunk).order('id'),
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

  const wanted = [];
  for (const ship of ships) {
    const action = actions.get(ship.action_id);
    let promptIds = [];
    let pages = [];
    if (action?.brand_id === ship.brand_id) {
      const own = { ...action, payload: action.payload ?? {} };
      const basket = await basketScope(own);
      const named = await targetScope(own);
      promptIds = basket.promptIds.length ? basket.promptIds : (named?.promptIds ?? []);
      pages = [...basket.pages, ...(named?.pages ?? [])];
    }
    const draft = drafts.get(ship.content_draft_id);
    if (!promptIds.length && draft?.brand_id === ship.brand_id) {
      promptIds = strings(draft.prompt_ids);
    }
    wanted.push({
      ship,
      promptIds: [...new Set(strings(promptIds))],
      pages: [...new Set([...pages, ship.url].map(pageAddress).filter(Boolean))].slice(
        0,
        MAX_TARGET_PAGES,
      ),
    });
  }

  const promptOf = new Map(
    (
      await readChunks(
        'target prompts read',
        wanted.flatMap((w) => w.promptIds),
        (chunk) =>
          db
            .from('prompts')
            .select('id, text, prompt_sets!inner(brand_id)')
            .in('id', chunk)
            .order('id'),
      )
    ).map((p) => [p.id, p]),
  );

  const targets = new Map();
  for (const { ship, promptIds, pages } of wanted) {
    const prompts = promptIds
      .map((id) => promptOf.get(id))
      .filter((p) => p?.prompt_sets?.brand_id === ship.brand_id);
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

/** A draft live again within this many days is the same shipped change, still measured (00425). */
export const REPUBLISH_DAYS = 90;

/**
 * A page the CMS confirmed live (markDeliveryPublished): a ship event
 * (cms_publish, from the Content Editor, a content change, assisted when a
 * person sent it, automated when nobody did) and its Pending measurement.
 *
 *   * One per send (00425): written with an upsert on its send that ignores
 *     a second, so a confirmation read twice, or by two servers at once,
 *     writes one.
 *   * The same draft live again within REPUBLISH_DAYS of its ship event (a
 *     post updated in place, sent again): no second ship event; the first
 *     notes it (republished_at) and its measurement goes on, as two on the
 *     same targets would make each other Not measurable.
 *
 * Off with CHAT_AGENTIC, or for a workspace it isn't on for, it writes
 * nothing, and with it off reads nothing either. Never throws: a ship event
 * that fails is logged, and the page stays published.
 *
 * @returns {Promise<string|null>} the ship event's id
 */
export async function recordCmsPublish({ deliveryId, url, publishedAt, db = supabaseAdmin }) {
  if (!chatAgenticDeployed()) return null;
  try {
    const { data: delivery, error } = await db
      .from('content_draft_deliveries')
      .select('id, organization_id, brand_id, draft_id, sent_by, title')
      .eq('id', deliveryId)
      .maybeSingle();
    if (error) throw new ImpactDbError('delivery read', error);
    if (!delivery || !chatAgenticEnabled(delivery.organization_id)) return null;

    let draft = null;
    if (delivery.draft_id) {
      const since = new Date(Date.parse(publishedAt) - REPUBLISH_DAYS * DAY_MS).toISOString();
      const { data: earlier, error: earlierError } = await db
        .from('ship_events')
        .select('id, content_draft_delivery_id')
        .eq('brand_id', delivery.brand_id)
        .eq('content_draft_id', delivery.draft_id)
        .gte('shipped_at', since)
        .order('shipped_at', { ascending: false })
        .limit(1);
      if (earlierError) throw new ImpactDbError('ship events read', earlierError);
      const first = earlier?.[0];
      if (first) {
        if (first.content_draft_delivery_id !== delivery.id) {
          const { error: noteError } = await db
            .from('ship_events')
            .update({ republished_at: publishedAt })
            .eq('id', first.id);
          if (noteError) throw new ImpactDbError('republish note', noteError);
        }
        return first.id;
      }
      const { data, error: draftError } = await db
        .from('content_drafts')
        .select('id, title, action_id')
        .eq('id', delivery.draft_id)
        .maybeSingle();
      if (draftError) throw new ImpactDbError('draft read', draftError);
      draft = data;
    }

    const title = clip(draft?.title || delivery.title, 200) || 'Page';
    const columns = 'id, brand_id, action_id, content_draft_id, url, shipped_at';
    const { data: inserted, error: insertError } = await db
      .from('ship_events')
      .upsert(
        {
          organization_id: delivery.organization_id,
          brand_id: delivery.brand_id,
          kind: 'cms_publish',
          title,
          content_draft_id: delivery.draft_id ?? null,
          content_draft_delivery_id: delivery.id,
          url: pageAddress(url),
          action_id: draft?.action_id ?? null,
          source: 'content_editor',
          change_type: 'content',
          shipped_at: publishedAt,
          shipped_by: delivery.sent_by ?? null,
          execution_mode: delivery.sent_by ? 'assisted' : 'automated',
        },
        { onConflict: 'content_draft_delivery_id', ignoreDuplicates: true },
      )
      .select(columns);
    if (insertError) throw new ImpactDbError('ship event insert', insertError);
    const ship = inserted?.[0];
    if (!ship) {
      // Another confirmation of the send wrote it first: that one is seeded.
      const { data: kept, error: keptError } = await db
        .from('ship_events')
        .select('id')
        .eq('content_draft_delivery_id', delivery.id)
        .maybeSingle();
      if (keptError) throw new ImpactDbError('ship event read', keptError);
      return kept?.id ?? null;
    }
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
