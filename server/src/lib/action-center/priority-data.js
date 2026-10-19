/**
 * What the priority score reads from the database (AC-006): the demand and
 * intent of the prompts an action's evidence names. Everything else it needs
 * — the action, its signals — the caller has in hand already.
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { priorityColumns, promptIdsOf, scorePriority } from './priority.js';

/** Prompt ids per request, so the filter stays well inside a URL's length. */
const CHUNK = 150;

/** Rows per page: a prompt has a row per location and fetch, past the 1,000 a response holds. */
const PAGE = 1000;

/**
 * Per prompt, its estimated monthly AI searches and its intent. A prompt can
 * have a row per location and per fetch: the largest volume counts, as in
 * the detectors' reads (`ae_prompt_stats`), and the newest intent.
 *
 * @param {string[]} promptIds
 * @returns {Promise<Map<string, { volume: number|null, intent: string|null }>>}
 */
export async function loadPromptDemand(promptIds) {
  const demand = new Map();
  const ids = [...new Set(promptIds)];
  const rows = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('prompt_volumes')
        .select('prompt_id, est_ai_volume, intent, fetched_at')
        .in('prompt_id', ids.slice(i, i + CHUNK))
        .order('fetched_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`prompt demand read failed: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
  }
  // Each prompt's rows sit in one chunk, newest first: its first row has its newest intent.
  for (const row of rows) {
    const volume = row.est_ai_volume === null ? null : Number(row.est_ai_volume);
    const known = demand.get(row.prompt_id);
    if (!known) {
      demand.set(row.prompt_id, { volume, intent: row.intent ?? null });
    } else if (volume !== null && (known.volume === null || volume > known.volume)) {
      known.volume = volume;
    }
  }
  return demand;
}

/**
 * The priority columns for an action a person sends (from Content or the
 * Improve tab), worked out as it is written; the nightly pass refreshes them
 * after. Without the prompts' demand it is still scored, with demand unknown:
 * the action is not held back for it.
 *
 * @param {{ kind: string, category: string, impact: string, payload: object }} action
 */
export async function priorityOnCreate(action, now = new Date()) {
  let prompts = new Map();
  try {
    prompts = await loadPromptDemand(promptIdsOf([action.payload]));
  } catch (err) {
    logger.warn({ err: err.message, kind: action.kind }, '[actions] prompt demand unavailable');
  }
  const priority = scorePriority(
    { action: { ...action, created_at: now.toISOString() }, signals: [], prompts },
    now,
  );
  return priorityColumns(priority, now);
}

/** An action still being worked on: its priority is kept current. */
const ACTIVE_STATUSES = ['new', 'in_progress', 'on_hold'];
/** A signal that still supports its action. */
const OPEN_SIGNAL_STATUSES = ['new', 'acknowledged'];

/**
 * An active action's priority, worked out again from its open signals as
 * they stand now, as the nightly pass would. Best effort: a score that can't
 * be read or saved is logged and left for the night.
 *
 * @param {{ id: string, kind: string, category: string, impact: string, payload?: object, created_at?: string }} action
 * @returns {Promise<boolean>} whether the score was saved
 */
export async function rescoreAction(action, now = new Date()) {
  const { data: signals, error } = await supabaseAdmin
    .from('signals')
    .select('id, kind, impact, payload, current_value, source, detected_at')
    .eq('action_id', action.id)
    .in('status', OPEN_SIGNAL_STATUSES)
    .limit(1000);
  if (error) {
    logger.warn({ actionId: action.id, err: error.message }, '[actions] rescore read failed');
    return false;
  }
  let prompts = new Map();
  try {
    prompts = await loadPromptDemand(
      promptIdsOf([action.payload, ...(signals ?? []).map((signal) => signal.payload)]),
    );
  } catch (err) {
    logger.warn({ actionId: action.id, err: err.message }, '[actions] prompt demand unavailable');
  }
  const priority = scorePriority({ action, signals: signals ?? [], prompts }, now);
  const { error: saveErr } = await supabaseAdmin
    .from('actions')
    .update(priorityColumns(priority, now))
    .eq('id', action.id);
  if (saveErr) {
    logger.warn({ actionId: action.id, err: saveErr.message }, '[actions] priority not saved');
    return false;
  }
  return true;
}

/**
 * A brand's actions scored again in one go, as the nightly pass's generator
 * does: their open signals and the prompts' demand are read once, not per
 * action. For the nights the generator doesn't run (a signal pass skipped
 * for no fresh results) and for the one-off backfill of actions opened
 * before scores existed (scripts/rescore-actions.js).
 *
 * @param {string} brandId
 * @param {{ now?: Date, statuses?: string[] | null, unscored?: boolean }} [options]
 *   statuses: the actions' statuses, null for all. unscored: only actions with no score yet.
 * @returns {Promise<number>} how many actions were scored
 */
export async function rescoreBrandActions(
  brandId,
  { now = new Date(), statuses = ACTIVE_STATUSES, unscored = false } = {},
) {
  let query = supabaseAdmin
    .from('actions')
    .select('id, kind, category, impact, payload, created_at')
    .eq('brand_id', brandId);
  if (statuses) query = query.in('status', statuses);
  if (unscored) query = query.is('priority_score', null);
  const { data: actions, error } = await query.limit(1000);
  if (error) throw new Error(error.message);
  if ((actions ?? []).length === 0) return 0;

  const { data: signals, error: signalsErr } = await supabaseAdmin
    .from('signals')
    .select('id, kind, impact, payload, current_value, source, detected_at, action_id')
    .eq('brand_id', brandId)
    .in('status', OPEN_SIGNAL_STATUSES)
    .not('action_id', 'is', null)
    .limit(1000);
  if (signalsErr) throw new Error(signalsErr.message);

  let prompts = new Map();
  try {
    prompts = await loadPromptDemand(
      promptIdsOf([
        ...actions.map((action) => action.payload),
        ...(signals ?? []).map((signal) => signal.payload),
      ]),
    );
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[actions] prompt demand unavailable');
  }

  const evidence = new Map();
  for (const signal of signals ?? []) {
    if (!evidence.has(signal.action_id)) evidence.set(signal.action_id, []);
    evidence.get(signal.action_id).push(signal);
  }

  let scored = 0;
  for (const action of actions) {
    const priority = scorePriority(
      { action, signals: evidence.get(action.id) ?? [], prompts },
      now,
    );
    const { error: saveErr } = await supabaseAdmin
      .from('actions')
      .update(priorityColumns(priority, now))
      .eq('id', action.id);
    if (saveErr) {
      logger.warn({ actionId: action.id, err: saveErr.message }, '[actions] priority not saved');
      continue;
    }
    scored += 1;
  }
  return scored;
}

/**
 * Every active action a signal supports, scored again (AC-007): resolving,
 * dismissing or reopening a signal changes its actions' support and
 * confidence at once, not the next night.
 *
 * @returns {Promise<number>} how many actions were rescored
 */
export async function rescoreActionsForSignal(signalId, now = new Date()) {
  const { data: links, error } = await supabaseAdmin
    .from('action_signals')
    .select('action_id')
    .eq('signal_id', signalId);
  if (error) throw new Error(error.message);
  const ids = [...new Set((links ?? []).map((link) => link.action_id))];
  if (ids.length === 0) return 0;

  const { data: actions, error: actionsErr } = await supabaseAdmin
    .from('actions')
    .select('id, kind, category, impact, payload, created_at')
    .in('id', ids)
    .in('status', ACTIVE_STATUSES);
  if (actionsErr) throw new Error(actionsErr.message);

  let rescored = 0;
  for (const action of actions ?? []) {
    if (await rescoreAction(action, now)) rescored += 1;
  }
  return rescored;
}
