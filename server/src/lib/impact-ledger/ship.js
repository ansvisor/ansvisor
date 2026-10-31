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
 *   * shipCmsPublish: a publish the CMS confirmed (Send to CMS: the
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
/**
 * A text cut to `max` characters by code point, never through a pair: a
 * lone surrogate is no text Postgres takes, in a text or a jsonb.
 */
export const clip = (text, max) =>
  Array.from(String(text ?? ''))
    .slice(0, max)
    .join('');

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
      const basket = await basketScope(own, { db });
      const named = await targetScope(own, { db });
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

/**
 * A draft live again within this many days is the same shipped change,
 * still measured (00425, 00428): ship_cms_publish takes it as
 * p_republish_days, so this is the one place it is set.
 */
export const REPUBLISH_DAYS = 90;
/** Most sends a ship event notes by id (republished_delivery_ids, 00428): past it, by date only. */
export const MAX_REPUBLISHED_IDS = 50;

/**
 * The cms_publish of a draft a send published at `sentAt` is noted on, as
 * ship_cms_publish (00428) chooses it among the draft's: within
 * REPUBLISH_DAYS, the latest shipped before it, else the nearest after
 * it; null when none is.
 *
 * @param {Array<{ shipped_at: string }>} ships the draft's cms_publish ship events
 */
export function republishOf(ships, sentAt) {
  const at = Date.parse(sentAt);
  const within = REPUBLISH_DAYS * 86_400_000;
  let best = null;
  for (const ship of ships) {
    const t = Date.parse(ship.shipped_at);
    if (Math.abs(t - at) > within) continue;
    const rank = [Number(t > at), Math.abs(t - at)];
    if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) {
      best = { ship, rank };
    }
  }
  return best?.ship ?? null;
}

/**
 * A page the CMS confirmed live (markDeliveryPublished): a ship event
 * (cms_publish, from the Content Editor, a content change, assisted when a
 * person sent it, automated when nobody did) and its Pending measurement.
 *
 *   * One per send (00425), written by ship_cms_publish (00428) in one
 *     transaction under a lock on the draft, so a confirmation read twice,
 *     or two sends of one draft confirmed by two servers at once, write one.
 *   * The same draft live again within REPUBLISH_DAYS of its latest
 *     cms_publish (a post updated in place, sent again): no second ship
 *     event; that one notes it (republished_at, only ever forward: a later
 *     publish than the one noted, or than the ship itself; the send in
 *     republished_delivery_ids) and its measurement goes on, as two on the
 *     same targets would make each other Not measurable. A send older than
 *     the draft's cms_publish (filled in late by the nightly job) is noted
 *     on the nearest one after it within REPUBLISH_DAYS, for the same
 *     reason (republishOf). A ship event of another kind on the same draft
 *     (Mark as shipped, Chat) takes no send.
 *
 * Off with CHAT_AGENTIC, or for a workspace it isn't on for, it writes
 * nothing, and with it off reads nothing either. Never throws: a ship event
 * that fails is logged, and the page stays published.
 *
 * @returns {Promise<{ id: string|null, created: boolean, failed: boolean }>} the ship
 *   event's id, whether this call wrote it (not one written before, nor a
 *   draft's first noted as published again), and whether something failed
 *   on the way (logged; the nightly job counts it)
 */
export async function shipCmsPublish({ deliveryId, url, publishedAt, db = supabaseAdmin }) {
  const none = { id: null, created: false, failed: false };
  if (!chatAgenticDeployed()) return none;
  try {
    const { data: delivery, error } = await db
      .from('content_draft_deliveries')
      .select('id, organization_id, brand_id, draft_id, sent_by, title')
      .eq('id', deliveryId)
      .maybeSingle();
    if (error) throw new ImpactDbError('delivery read', error);
    if (!delivery || !chatAgenticEnabled(delivery.organization_id)) return none;

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

    // The decision and its write in one transaction, under a lock on the
    // draft (00428): two sends of one draft confirmed at once write one.
    const ship = {
      brand_id: delivery.brand_id,
      action_id: draft?.action_id ?? null,
      content_draft_id: delivery.draft_id ?? null,
      url: pageAddress(url),
      shipped_at: publishedAt,
    };
    const { data: shipped, error: shipError } = await db.rpc('ship_cms_publish', {
      p_delivery_id: delivery.id,
      p_organization_id: delivery.organization_id,
      p_brand_id: ship.brand_id,
      p_content_draft_id: ship.content_draft_id,
      p_title: clip(draft?.title || delivery.title, 200) || 'Page',
      p_url: ship.url,
      p_action_id: ship.action_id,
      p_shipped_at: publishedAt,
      p_shipped_by: delivery.sent_by ?? null,
      p_execution_mode: delivery.sent_by ? 'assisted' : 'automated',
      p_republish_days: REPUBLISH_DAYS,
    });
    if (shipError) throw new ImpactDbError('ship event write', shipError);
    const row = (Array.isArray(shipped) ? shipped : [shipped]).find(Boolean);
    if (!row?.created) return { id: row?.ship_event_id ?? null, created: false, failed: false };
    ship.id = row.ship_event_id;
    // The nightly job seeds it if this fails.
    try {
      await seedMeasurements(db, [ship]);
    } catch (err) {
      logger.warn(
        { err: { name: err?.name, code: err?.code ?? null } },
        '[impact-ledger] measurement not seeded',
      );
      return { id: ship.id, created: true, failed: true };
    }
    return { id: ship.id, created: true, failed: false };
  } catch (err) {
    logger.warn(
      { err: { name: err?.name, code: err?.code ?? null } },
      '[impact-ledger] cms publish not recorded',
    );
    return { id: null, created: false, failed: true };
  }
}
