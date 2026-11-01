/**
 * Stale actions: New for a long time with nobody touching them.
 *
 * Candidates go stale when nothing detects them any more (generate.js); an
 * action had no such rule, so a list could hold months-old actions still
 * "New", side by side with last night's. Each night an action that is still
 * New and has had no one's event (an assignment, an edit, a task's status, a
 * send) for staleAfterDays is marked stale (`stale_at`, 00432). It is not
 * closed or dismissed: the list shows it as Stale, and Still relevant clears
 * it and starts the clock again (its History line is the event that does).
 * An action that left New, or that someone touched since, is no longer stale.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/action-engine.js';
import { selectInChunks } from '../chunked-in.js';

/**
 * Actions one brand's nightly pass looks at, oldest first: a backlog bigger
 * than this is worked through over the following nights.
 */
export const STALE_CHECKS_PER_BRAND = 500;

const DAY_MS = 86_400_000;

/**
 * Which actions to mark stale and which to clear.
 *
 * @param {{ id: string, status: string, created_at: string, stale_at: string | null }[]} actions
 * @param {Set<string>} touched - actions someone had an event on since `since`
 * @param {Date} since - now minus staleAfterDays
 * @returns {{ mark: string[], clear: string[] }}
 */
export function staleChanges(actions, touched, since) {
  const mark = [];
  const clear = [];
  for (const a of actions) {
    const quiet =
      a.status === 'new' && !touched.has(a.id) && Date.parse(a.created_at) < since.getTime();
    if (quiet && !a.stale_at) mark.push(a.id);
    else if (!quiet && a.stale_at) clear.push(a.id);
  }
  return { mark, clear };
}

/**
 * Marks the brand's quiet New actions stale and clears the ones that no
 * longer are. Part of the nightly pass (signals/pass.js).
 *
 * @returns {Promise<{ marked: number, cleared: number }>}
 */
export async function sweepStaleActions(
  brandId,
  { now = new Date(), thresholds = resolve() } = {},
) {
  const { data: actions, error } = await supabaseAdmin
    .from('actions')
    .select('id, status, created_at, stale_at')
    .eq('brand_id', brandId)
    .is('deleted_at', null)
    .or('status.eq.new,stale_at.not.is.null')
    .order('created_at', { ascending: true })
    .limit(STALE_CHECKS_PER_BRAND);
  if (error) throw new Error(error.message);
  if (!actions?.length) return { marked: 0, cleared: 0 };

  const since = new Date(now.getTime() - thresholds.noise.staleAfterDays * DAY_MS);
  // Someone's event: what a person did, as the History shows it. The engine's
  // own lines (new signals linked, a result measured) carry no actor.
  const { data: events, error: eventsError } = await selectInChunks(
    actions.map((a) => a.id),
    (chunk) =>
      supabaseAdmin
        .from('action_events')
        .select('action_id')
        .in('action_id', chunk)
        .not('actor_id', 'is', null)
        .gte('created_at', since.toISOString()),
  );
  if (eventsError) throw new Error(eventsError.message);

  const { mark, clear } = staleChanges(
    actions,
    new Set((events ?? []).map((e) => e.action_id)),
    since,
  );
  if (mark.length) {
    const { error: markError } = await supabaseAdmin
      .from('actions')
      .update({ stale_at: now.toISOString() })
      .in('id', mark)
      .eq('status', 'new')
      .is('stale_at', null);
    if (markError) throw new Error(markError.message);
  }
  if (clear.length) {
    const { error: clearError } = await supabaseAdmin
      .from('actions')
      .update({ stale_at: null })
      .in('id', clear);
    if (clearError) throw new Error(clearError.message);
  }
  return { marked: mark.length, cleared: clear.length };
}
