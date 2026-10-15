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
