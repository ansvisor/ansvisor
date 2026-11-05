/**
 * The Action Center's Today card (AC-011, ROADMAP-plan §06): what a person
 * does today on a brand, and the Next 7 after it.
 *
 * Ranked as the Inbox's daily suggestion is (CHAT-26), with its rule and its
 * reads (chat-suggestions/rules.js rankActions, reads.js), so the two never
 * disagree: the open actions (new, in progress) that are unassigned or the
 * person's own, by Priority Score plus the lift for days waiting and for
 * work "Start now" opens. The one the Inbox suggested to the person today
 * comes first, unless they removed it or put it off: it's that day's pick,
 * with the Inbox's own rules (variety, what was suggested before) behind it.
 * Nothing here ranks on its own.
 *
 * Reads only; no AI call. The person's today is the day the nightly job
 * dates their suggestion in (rules.js resolveZones): the zone they picked,
 * else their Chat answers', else the workspace's.
 */

import { chatAgenticEnabled } from '../chat-flag.js';
import {
  SuggestionsDbError,
  loadAnswerZones,
  loadCandidates,
  loadStartNow,
} from '../chat-suggestions/reads.js';
import { localClock, rankActions, resolveZones } from '../chat-suggestions/rules.js';

/** The Today card's items (at most), and the Next 7 under it. */
export const TODAY_ITEMS = 3;
export const NEXT_ITEMS = 7;

/**
 * The action the Inbox suggested to the person on this brand today, or null:
 * none sent today, or removed or put off since.
 *
 * @returns {Promise<string | null>}
 */
export async function todaysSuggestion(db, { orgId, brandId, userId, now }) {
  const [profile, answers] = await Promise.all([
    db.from('profiles').select('time_zone').eq('id', userId).maybeSingle(),
    loadAnswerZones(db, orgId, now),
  ]);
  if (profile.error) throw new SuggestionsDbError('profile read', profile.error);
  const zone = resolveZones(answers, [
    { id: userId, time_zone: profile.data?.time_zone ?? null },
  ]).ofPerson(userId);
  const { data, error } = await db
    .from('chat_suggestions')
    .select('action_id, snoozed_until, removed_at')
    .eq('user_id', userId)
    .eq('brand_id', brandId)
    .eq('sent_on', localClock(now, zone).day)
    .maybeSingle();
  if (error) throw new SuggestionsDbError('suggestion read', error);
  if (!data || data.removed_at) return null;
  if (data.snoozed_until && Date.parse(data.snoozed_until) > now.getTime()) return null;
  return data.action_id;
}

/**
 * Today's actions for a person on a brand, best first: TODAY_ITEMS for the
 * card, then the NEXT_ITEMS after them. `suggested` marks the Inbox's pick.
 * The Inbox is read only where Chat is on (CHAT_AGENTIC): elsewhere nothing
 * writes it.
 *
 * @param {object} db the service-role client; the caller checked brand access
 * @param {{ orgId: string, brandId: string, userId: string, now?: Date }} input
 * @returns {Promise<{ today: Array<{ id: string, suggested: boolean }>,
 *   next: Array<{ id: string }> }>}
 */
export async function readToday(db, { orgId, brandId, userId, now = new Date() }) {
  const actions = await loadCandidates(db, brandId, [userId]);
  if (actions.length === 0) return { today: [], next: [] };
  const [startNow, suggested] = await Promise.all([
    loadStartNow(
      db,
      actions.map((action) => action.id),
    ),
    chatAgenticEnabled(orgId) ? todaysSuggestion(db, { orgId, brandId, userId, now }) : null,
  ]);
  const ranked = rankActions({ actions, userId, startNow, now });
  const at = suggested ? ranked.findIndex((entry) => entry.action.id === suggested) : -1;
  const order = at > 0 ? [ranked[at], ...ranked.slice(0, at), ...ranked.slice(at + 1)] : ranked;
  return {
    today: order.slice(0, TODAY_ITEMS).map(({ action }) => ({
      id: action.id,
      suggested: action.id === suggested,
    })),
    next: order.slice(TODAY_ITEMS, TODAY_ITEMS + NEXT_ITEMS).map(({ action }) => ({
      id: action.id,
    })),
  };
}
