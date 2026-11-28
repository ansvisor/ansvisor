/**
 * Action generation (Action Center, prioritization layer).
 *
 * Consolidates a brand's OPEN signals into a handful of actions — many
 * signals → one action, deterministically. A definition names the signal
 * kinds that constitute one outcome; if a brand has six open page
 * opportunities they become ONE "capture AI traffic" action with six linked
 * signals, never six rows. The count of actions therefore follows what the
 * detectors actually found: four important things yield four actions, per
 * the quality-over-quantity rule.
 *
 * This module is the matching engine and knows no definition by name. What
 * exists, what it needs, and what it puts in its payload is each definition's
 * own business — see definitions/index.js. The engine's job is the part every
 * definition shares: match, decide whether a new cycle may open, and write.
 *
 * Lifecycle across nights, mirroring signals:
 *  - an ACTIVE action keeps its scope. Newly detected signals are linked to
 *    it as evidence, but its payload is not rewritten: it is a work package
 *    someone may already be executing against, and silently changing what it
 *    covers is worse than leaving a new problem for the next cycle;
 *  - a CLOSED action — completed or dismissed — is finished. It is never
 *    written to again and never resurrected; it is the historical record of
 *    one execution cycle;
 *  - closing frees the definition's slot. Once the rest window has passed, a
 *    still firing condition opens a NEW action beside the old one, with its
 *    own baseline, tasks and outcome;
 *  - a NEW SUBJECT gets its own action: a still open action keeps its scope,
 *    and signals of its kind outside it (other prompts, another platform)
 *    open another action of that kind beside it, up to
 *    noise.maxActivePerKind open at once and when they are enough
 *    (noise.minSignalsForExtraCycle, or one of high impact). Its dedup key
 *    is the definition's with `#2`, `#3`; past the cap, or for a lone low
 *    signal, newcomers are linked as the newest action's evidence;
 *  - a STALE action (stale.js: still New, nobody's event for staleAfterDays)
 *    gives way: when its definition still matches tonight, it is dismissed
 *    as `replaced` and a new action opens from tonight's signals, the old
 *    one's still-open signals included (00563). Nobody
 *    was executing against it, so nothing is taken from anyone.
 *
 * Two questions, answered in that order (#818 phase 6). *What did we find?*
 * writes a candidate for every definition that matched, every night, whether
 * or not anything can be done about it. *What should we act on?* promotes
 * from that queue. Keeping them apart is what stopped findings disappearing:
 * a condition detected while the slot was busy used to be linked as evidence
 * and then forgotten, because the next cycle was built from whatever happened
 * to be open on the night the slot freed up.
 *
 * Three things stop a candidate being promoted, and they are counted
 * separately so a quiet night is legible: the brand lacks the data the
 * definition needs (`ineligible`), the last cycle closed too recently
 * (`resting`), or the brand has already had its day's worth (`capped`). None
 * of them loses the finding — it stays in the queue, and its wait is what
 * lifts it up the order.
 *
 * `baseline` snapshots the linked signals' measured values at creation —
 * the "before" half of the validation comparison (#818, phase 2).
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { captureWorkspaceEvent } from '../core-loop-events.js';
import { resolve } from '../../config/action-engine.js';
import { isEligible, loadDefinitions } from './definitions/index.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';
import { orderByPriority, scoreCandidate } from './candidates.js';
import { priorityColumns, promptIdsOf, scorePriority } from './priority.js';
import { kindTrackOrNone, loadPromptDemand } from './priority-data.js';
import { withWorkScope } from './work-scope.js';
import { PLAY_DEFINITIONS, categoryPagePlay, choosePlay } from './playbooks.js';
import { categoryPageFor } from './category-play.js';
import { siteTypeOf } from '../content-page-types.js';

const DAY_MS = 86_400_000;
/** The definition a store's topic action with a live category page optimizes it in (G16). */
const CATEGORY_PLAY_DEFINITION = 'create_content_for_topics';

// Thresholds live in config/action-engine.js (#818 phase 2.5).
const { noise } = resolve();

const IMPACT_RANK = { high: 3, medium: 2, low: 1 };

/** Between a definition's id and a further open cycle's number in its dedup key. */
export const CYCLE_SEPARATOR = '#';

/** Whether an active action holds one of a definition's slots (its own key, or `#n`). */
export function holdsSlot(row, definitionId) {
  const key = row.dedup_key ?? '';
  return key === definitionId || key.startsWith(`${definitionId}${CYCLE_SEPARATOR}`);
}

/** The definition a dedup key belongs to: the part before `#n`. */
export function slotDefinition(key) {
  return String(key ?? '').split(CYCLE_SEPARATOR)[0];
}

/** The first free dedup key of a definition, beside the open actions' keys. */
export function nextSlotKey(definitionId, openRows) {
  const used = new Set(openRows.map((row) => row.dedup_key));
  if (!used.has(definitionId)) return definitionId;
  for (let n = 2; ; n += 1) {
    const key = `${definitionId}${CYCLE_SEPARATOR}${n}`;
    if (!used.has(key)) return key;
  }
}

/** Whether newcomers are enough to open another action of their kind beside an open one. */
export function opensExtraCycle(signals, minSignals = noise.minSignalsForExtraCycle) {
  return signals.length >= minSignals || signals.some((signal) => signal.impact === 'high');
}

function buildBaseline(signals) {
  return {
    capturedAt: new Date().toISOString(),
    signals: signals.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      previousValue: signal.previous_value,
      currentValue: signal.current_value,
      changeValue: signal.change_value,
    })),
  };
}

function groupByKind(signals) {
  const byKind = new Map();
  for (const signal of signals) {
    byKind.set(signal.kind, [...(byKind.get(signal.kind) ?? []), signal]);
  }
  return byKind;
}

async function logEvent(actionId, event, data = {}) {
  const { error } = await supabaseAdmin
    .from('action_events')
    .insert({ action_id: actionId, event, data });
  if (error) throw new Error(error.message);
}

/**
 * Takes signals as an action's evidence (AC-007). Each becomes the action's
 * (`signals.action_id`, the signal's current action), and the link is kept
 * in `action_signals` for good: the action still lists the signal after it
 * moves on to a later cycle, and the signal lists every action it was used
 * by. The rows in hand are updated too, so the rest of the night sees them
 * as taken.
 */
async function linkSignals(actionId, signals, linkedAt) {
  if (signals.length === 0) return 0;
  const ids = signals.map((signal) => signal.id);
  // The link first: if pointing the signals at the action then fails, they
  // are not taken yet and the next night links them again. The other way
  // round, a signal could be taken with no link, and missing from the action.
  const { error: linkErr } = await supabaseAdmin.from('action_signals').upsert(
    ids.map((signalId) => ({ action_id: actionId, signal_id: signalId, linked_at: linkedAt })),
    { onConflict: 'action_id,signal_id', ignoreDuplicates: true },
  );
  if (linkErr) throw new Error(linkErr.message);
  const { error } = await supabaseAdmin
    .from('signals')
    .update({ action_id: actionId })
    .in('id', ids);
  if (error) throw new Error(error.message);
  for (const signal of signals) signal.action_id = actionId;
  return signals.length;
}

/**
 * Whether an active action gives way to a new one of its kind: stale
 * (stale.js marks only an action still New that nobody had an event on for
 * staleAfterDays, and clears the mark when someone acts) and still New.
 */
export function isReplaceable(action) {
  return action.status === 'new' && Boolean(action.stale_at);
}

/**
 * Dismisses a stale action as replaced. Only while it is still New and
 * stale: someone who acted on it since keeps it, and the replacement waits.
 * True when it was closed.
 */
async function retireStale(actionId, nowIso) {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .update({
      status: 'dismissed',
      dismiss_reason: 'replaced',
      completed_at: null,
      updated_at: nowIso,
    })
    .eq('id', actionId)
    .eq('status', 'new')
    .not('stale_at', 'is', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Puts back a stale action whose replacement could not be opened. */
async function restoreStale(actionId) {
  const { error } = await supabaseAdmin
    .from('actions')
    .update({ status: 'new', dismiss_reason: null })
    .eq('id', actionId);
  if (error) logger.warn({ actionId, err: error.message }, '[actions] stale action not restored');
}

function startOfUtcDay(now) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * The payload with the prompts and pages its work is about (work-scope.js),
 * so a draft started from it opens with them. Best effort: a failed read
 * opens the action as the night found it.
 */
async function scopedPayload(brandId, definitionId, payload) {
  try {
    return await withWorkScope(brandId, payload);
  } catch (err) {
    logger.warn(
      { brandId, definitionId, err: err.message },
      "[actions] work's prompts and pages not read",
    );
    return payload;
  }
}

/** The topics a topic action (G16) is about: its targets' ids. */
function topicIdsOf(payload) {
  if (payload.targetEntity !== 'topics') return [];
  const listed = Array.isArray(payload.targetIds)
    ? payload.targetIds
    : (Array.isArray(payload.targets) ? payload.targets : []).map((t) => t?.id);
  return [...new Set(listed.filter((id) => typeof id === 'string' && id))];
}

/**
 * The payload with the play its prompts pick (playbooks.js, AC plan §5),
 * for G15, G16 and C09: the brand's kind of site and its prompts' intents
 * and AI searches read, then chosen. On a store, a topic action whose topic
 * has a live category page optimizes that page instead (AC plan P-7,
 * category-play.js): its page, its best sellers locked into the draft's
 * shopping path, and the optimize branch of its plan; one whose category
 * has products but no page writes a buying guide (EC-1), its best sellers
 * locked in. A live category page with no buying guide yet has one also
 * worth doing, next to the page and linking it. Best effort: a failed read,
 * or no play the data supports, opens the action without one.
 */
async function playedPayload(brandId, definitionId, payload) {
  if (!PLAY_DEFINITIONS.includes(definitionId) || payload.play) return payload;
  const promptIds = Array.isArray(payload.promptIds) ? payload.promptIds : [];
  const topicIds = definitionId === CATEGORY_PLAY_DEFINITION ? topicIdsOf(payload) : [];
  if (!promptIds.length && !topicIds.length) return payload;
  try {
    const [brand, demand] = await Promise.all([
      supabaseAdmin
        .from('brands')
        .select('site_type, industry, shopping_mode_enabled')
        .eq('id', brandId)
        .maybeSingle(),
      promptIds.length ? loadPromptDemand(promptIds) : new Map(),
    ]);
    if (brand.error) throw new Error(brand.error.message);
    const siteType = siteTypeOf({
      siteType: brand.data?.site_type,
      industry: brand.data?.industry,
      shoppingModeEnabled: brand.data?.shopping_mode_enabled,
    });
    const prompts = promptIds.map((id) => ({
      id,
      intent: demand.get(id)?.intent ?? null,
      volume: demand.get(id)?.volume ?? null,
    }));
    if (siteType === 'ecommerce' && topicIds.length) {
      const found = await categoryPageFor(brandId, topicIds);
      // Its page optimized, or a buying guide written when it has none (EC-1).
      if (found?.category.url) {
        return {
          ...payload,
          play: categoryPagePlay({
            siteType,
            category: found.category,
            prompts,
            guideMissing: found.guideMissing,
          }),
          contentExists: true,
          pages: [found.category.url],
          products: found.products,
        };
      }
      if (found) {
        return {
          ...payload,
          play: categoryPagePlay({ siteType, category: found.category, prompts }),
          products: found.products,
        };
      }
    }
    if (!prompts.length) return payload;
    const play = choosePlay({ siteType, prompts });
    return play ? { ...payload, play } : payload;
  } catch (err) {
    logger.warn({ brandId, definitionId, err: err.message }, '[actions] play not chosen');
    return payload;
  }
}

async function openCycle({
  brandId,
  definition,
  signals,
  impact,
  available,
  payload: found,
  priority,
  now,
  dedupKey = definition.id,
}) {
  const payload = await playedPayload(
    brandId,
    definition.id,
    await scopedPayload(brandId, definition.id, found),
  );
  const { data: inserted, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: definition.category,
      kind: definition.id,
      definition_version: definition.version,
      impact,
      payload,
      kpi_keys: [...new Set(signals.flatMap((signal) => signal.kpi_keys ?? []))],
      baseline: buildBaseline(signals),
      dedup_key: dedupKey,
      ...priorityColumns(priority, now),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // The plan follows from what this brand has and what this action is about
  // — not from the kind alone (#818 phase 5). Two brands with the same
  // problem and different integrations get different lists here.
  const plan = planTasks(definition, { sources: available, payload, signals });
  const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
    plan.map((item) => ({
      action_id: inserted.id,
      position: item.position,
      task_key: item.taskKey,
      task_version: item.version,
      mode: item.mode,
      permission: item.permission,
      depends_on: item.dependsOn,
      title: item.title,
      title_params: item.titleParams,
      details: item.details,
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await logEvent(inserted.id, 'created', {
    impact,
    signalCount: signals.length,
    definitionVersion: definition.version,
    taskCount: plan.length,
  });
  void captureWorkspaceEvent(brandId, 'action_created', {
    source: 'signals',
    kind: definition.id,
    task_count: plan.length,
  });
  await linkSignals(inserted.id, signals, now.toISOString());
  return inserted.id;
}

export async function generateActionsForBrand(brandId, { now = new Date(), sources } = {}) {
  const definitions = await loadDefinitions();
  const available = sources ?? (await resolveBrandSources(brandId));

  const { data: openSignals, error: signalsErr } = await supabaseAdmin
    .from('signals')
    .select(
      'id, kind, impact, kpi_keys, payload, previous_value, current_value, change_value, action_id, source, detected_at',
    )
    .eq('brand_id', brandId)
    .in('status', ['new', 'acknowledged'])
    .limit(1000);
  if (signalsErr) throw new Error(signalsErr.message);

  // Only the active ones. A completed or dismissed action is a finished
  // cycle: it neither blocks a new one nor is ever written to again, so it
  // has no bearing on what happens tonight beyond the rest window below.
  const { data: activeRows, error: actionsErr } = await supabaseAdmin
    .from('actions')
    .select(
      'id, dedup_key, status, created_at, stale_at, kind, category, impact, payload, baseline',
    )
    .eq('brand_id', brandId)
    .not('status', 'in', '("completed","dismissed")')
    .limit(1000);
  if (actionsErr) throw new Error(actionsErr.message);
  // A signal is taken while an active action holds it. One whose action has
  // closed is free again: if it is still open, the condition is still firing,
  // and it is evidence for the definition's next cycle (AC-007). Before,
  // `action_id` was written once and such a signal could never start one.
  const activeIds = new Set((activeRows ?? []).map((row) => row.id));
  const taken = (signal) => Boolean(signal.action_id) && activeIds.has(signal.action_id);
  // What active actions cover: the signals each was created from. A signal
  // linked to one later is its evidence, not its scope, so it is still what
  // the next cycle is for (#818 phase 6).
  const scopeOf = (row) => (row.baseline?.signals ?? []).map((s) => s.id);
  const inScope = new Set((activeRows ?? []).flatMap(scopeOf));

  // How recently each definition was closed, so a condition that is still
  // firing does not reopen as a fresh action the very next night.
  const { data: closedRows, error: closedErr } = await supabaseAdmin
    .from('actions')
    .select('dedup_key, completed_at, updated_at, created_at')
    .eq('brand_id', brandId)
    .in('status', ['completed', 'dismissed'])
    .order('created_at', { ascending: false })
    .limit(1000);
  if (closedErr) throw new Error(closedErr.message);
  const lastClosedAt = new Map();
  for (const row of closedRows ?? []) {
    const closed = Date.parse(row.completed_at ?? row.updated_at ?? '') || 0;
    // By definition: a closed `#2` cycle rests its kind like the first.
    const slot = slotDefinition(row.dedup_key);
    if (closed > (lastClosedAt.get(slot) ?? 0)) lastClosedAt.set(slot, closed);
  }

  // The day's budget, counted from rows already fetched rather than asked
  // for separately. An action raised this morning and dismissed by lunch
  // still spent its slot: the brand was told about it.
  const dayStart = startOfUtcDay(now);
  const createdToday = [...(activeRows ?? []), ...(closedRows ?? [])].filter(
    (row) => (Date.parse(row.created_at ?? '') || 0) >= dayStart,
  ).length;

  const nowIso = now.toISOString();

  // What the queue already holds. `first_seen_at` is the only thing here that
  // cannot be recomputed — it is how long a finding has been waiting, which
  // is the term that stops a low-impact one starving behind a brand with a
  // steady stream of urgent ones.
  const { data: waitingRows, error: waitingErr } = await supabaseAdmin
    .from('action_candidates')
    .select('id, definition_id, first_seen_at, signal_ids')
    .eq('brand_id', brandId)
    .eq('status', 'waiting')
    .limit(1000);
  if (waitingErr) throw new Error(waitingErr.message);
  const waiting = new Map((waitingRows ?? []).map((row) => [row.definition_id, row]));

  // The demand and intent of every prompt the evidence names, read once for
  // the night's priority scores. Without it the scores are still worked out,
  // with demand and intent unknown: a slower read is no reason to skip them.
  let demand = new Map();
  try {
    demand = await loadPromptDemand(
      promptIdsOf([
        ...(openSignals ?? []).map((signal) => signal.payload),
        ...(activeRows ?? []).map((row) => row.payload),
      ]),
    );
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[actions] prompt demand unavailable');
  }
  // How each kind did here before (learning B4), read once for the night.
  const track = await kindTrackOrNone(brandId, now);
  const ready = [];
  const seen = new Set();
  let refreshed = 0;
  let resting = 0;
  let ineligible = 0;
  let queued = 0;

  for (const definition of definitions) {
    // Registered but switched off — the specification's slot exists, the data
    // behind it does not yet. Nothing to queue and nothing to raise.
    if (definition.enabled === false) continue;
    const matched = (openSignals ?? []).filter((signal) =>
      definition.signalKinds.includes(signal.kind),
    );
    if (matched.length === 0) continue;

    // The definition's open actions, oldest first.
    const actives = (activeRows ?? [])
      .filter((row) => holdsSlot(row, definition.id))
      .sort(
        (a, b) => (Date.parse(a.created_at ?? '') || 0) - (Date.parse(b.created_at ?? '') || 0),
      );
    // Stale and untouched: tonight's signals go to the action replacing it.
    const replacing = actives.find(isReplaceable) ?? null;
    // The newest one still being kept: where evidence goes.
    const current = actives.filter((row) => row !== replacing).at(-1) ?? null;
    // Outside every open action's scope: a new subject.
    const outside = matched.filter((signal) => !inScope.has(signal.id));
    // A new subject beside open actions of its kind gets an action of its own.
    const extraCycle =
      !replacing &&
      actives.length > 0 &&
      actives.length < noise.maxActivePerKind &&
      outside.length > 0 &&
      opensExtraCycle(outside);
    if (current && !replacing && !extraCycle) {
      // An active action keeps the scope it was created with. Signals that
      // arrived since are linked as evidence — they are why this action
      // exists — but `payload` is the work package someone may already be
      // executing against, and rewriting it nightly turned a recovery for six
      // prompts into a recovery for a different nine without telling anyone.
      //
      // Those newcomers are not dropped either: outside its scope, they stay
      // in the queue below and are what the next cycle covers.
      const linked = await linkSignals(
        current.id,
        matched.filter((signal) => !taken(signal)),
        nowIso,
      );
      if (linked > 0) {
        await supabaseAdmin.from('actions').update({ updated_at: nowIso }).eq('id', current.id);
        await logEvent(current.id, 'signals_linked', { count: linked });
      }
      refreshed += 1;
    }

    // A candidate covers exactly the matched signals no active action was
    // created from. Recomputed rather than accumulated: a signal that resolved
    // leaves the queue by itself, and one in an active action's scope is
    // already accounted for. The queue therefore cannot drift out of step
    // with what is actually true tonight — and a newcomer stays in it on the
    // nights after it was linked, not only the first.
    // A replacement covers everything that still fires, its old scope too.
    // A replacement covers what still fires in its own scope and outside any
    // other open action's: never another action's work.
    const othersScope = new Set(actives.filter((row) => row !== replacing).flatMap(scopeOf));
    const unclaimed = replacing ? matched.filter((signal) => !othersScope.has(signal.id)) : outside;
    if (unclaimed.length === 0) continue;

    const impact = unclaimed
      .map((signal) => signal.impact)
      .sort((a, b) => IMPACT_RANK[b] - IMPACT_RANK[a])[0];
    const payload = {
      signalCount: unclaimed.length,
      ...definition.payload(groupByKind(unclaimed)),
    };

    const existing = waiting.get(definition.id);
    const firstSeenAt = existing?.first_seen_at ?? nowIso;
    // The priority its action would carry (AC-006): the queue is ordered by
    // the same number the Actions list is.
    const priority = scorePriority(
      {
        action: { kind: definition.id, category: definition.category, impact, payload },
        signals: unclaimed,
        prompts: demand,
        track,
      },
      now,
    );
    const score = scoreCandidate({ priorityScore: priority.score, firstSeenAt }, now);
    const row = {
      brand_id: brandId,
      definition_id: definition.id,
      status: 'waiting',
      signal_ids: unclaimed.map((signal) => signal.id),
      impact,
      payload,
      priority: score,
      first_seen_at: firstSeenAt,
      last_seen_at: nowIso,
      updated_at: nowIso,
    };

    let candidateId = existing?.id;
    if (candidateId) {
      const { error } = await supabaseAdmin
        .from('action_candidates')
        .update(row)
        .eq('id', candidateId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from('action_candidates')
        .insert(row)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      candidateId = inserted.id;
      queued += 1;
    }
    seen.add(definition.id);

    // Whether it can be promoted tonight is a separate question from whether
    // it is real, and it is asked after the queue is written — so a finding
    // that cannot be acted on now is still recorded as found.
    if (current && !replacing && !extraCycle) continue;

    if (!isEligible(definition, available)) {
      ineligible += 1;
      continue;
    }

    // The rest window is for a cycle someone closed with none of its kind
    // left open; a replacement or a new subject beside an open one has none.
    const closedAt = replacing || extraCycle ? 0 : (lastClosedAt.get(definition.id) ?? 0);
    if (closedAt && now.getTime() - closedAt < noise.restAfterCloseDays * DAY_MS) {
      resting += 1;
      continue;
    }

    ready.push({
      candidateId,
      definitionId: definition.id,
      definition,
      signals: unclaimed,
      impact,
      payload,
      priority,
      // What the queue's order reads, beside the time waited.
      priorityScore: priority.score,
      firstSeenAt,
      replaces: replacing?.id ?? null,
      // The replaced action's key, else the definition's first free one.
      dedupKey: replacing ? replacing.dedup_key : nextSlotKey(definition.id, actives),
    });
  }

  // A candidate nothing detected tonight no longer describes anything true.
  // Stale rather than deleted: it is the record of something the engine once
  // found, and re-detection brings it back as a new waiting row with a fresh
  // clock — the same lifecycle a signal has.
  const gone = (waitingRows ?? []).filter((row) => !seen.has(row.definition_id));
  if (gone.length > 0) {
    const { error } = await supabaseAdmin
      .from('action_candidates')
      .update({ status: 'stale', updated_at: nowIso })
      .in(
        'id',
        gone.map((row) => row.id),
      );
    if (error) throw new Error(error.message);
  }

  const room = Math.max(0, noise.maxNewActionsPerDay - createdToday);
  const ordered = orderByPriority(ready, now);
  const opening = ordered.slice(0, room);

  const replaced = new Set();
  let opened = 0;
  for (const candidate of opening) {
    // The stale action steps aside first: its key is the new one's.
    if (candidate.replaces && !(await retireStale(candidate.replaces, nowIso))) continue;
    let actionId;
    try {
      actionId = await openCycle({ brandId, available, now, ...candidate });
    } catch (err) {
      if (candidate.replaces) await restoreStale(candidate.replaces);
      throw err;
    }
    opened += 1;
    if (candidate.replaces) {
      replaced.add(candidate.replaces);
      await logEvent(candidate.replaces, 'replaced', { by: actionId });
      await logEvent(actionId, 'replaces', { action: candidate.replaces });
    }
    const { error } = await supabaseAdmin
      .from('action_candidates')
      .update({
        status: 'promoted',
        promoted_at: nowIso,
        promoted_action_id: actionId,
        updated_at: nowIso,
      })
      .eq('id', candidate.candidateId);
    if (error) throw new Error(error.message);
  }

  // Every active action's priority, worked out again from tonight's evidence:
  // its open signals, how recent they are, the demand behind them. Actions
  // opened tonight were scored as they were written. Best effort: a score
  // that cannot be written is logged, never a reason to fail the night.
  let rescored = 0;
  for (const row of activeRows ?? []) {
    // Replaced tonight: closed, no longer ranked.
    if (replaced.has(row.id)) continue;
    // Including the signals linked to it tonight: the rows in hand say so.
    const evidence = (openSignals ?? []).filter((signal) => signal.action_id === row.id);
    const priority = scorePriority({ action: row, signals: evidence, prompts: demand, track }, now);
    const { error } = await supabaseAdmin
      .from('actions')
      .update(priorityColumns(priority, now))
      .eq('id', row.id);
    if (error) {
      logger.warn(
        { brandId, actionId: row.id, err: error.message },
        '[actions] priority not saved',
      );
      continue;
    }
    rescored += 1;
  }

  const summary = {
    created: opened,
    replaced: replaced.size,
    rescored,
    refreshed,
    resting,
    ineligible,
    capped: ordered.length - opening.length,
    queued,
    waiting: (waitingRows ?? []).length - gone.length + queued - opened,
    stale: gone.length,
  };
  logger.info({ brandId, ...summary }, '[actions] generated');
  return summary;
}
