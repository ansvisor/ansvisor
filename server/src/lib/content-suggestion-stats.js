import supabaseAdmin from '../config/supabase.js';

/**
 * What a brand does with the Content Agent's suggestions, by rule (learning
 * B6, 00367). Each suggestion names the rules it fixes and keeps whether a
 * person accepted or rejected it; summed over the last DECISION_WINDOW_DAYS,
 * a rule whose suggestions people there mostly reject is one the agent
 * treats carefully: a change only where the rule can't be met without it,
 * as small as it allows. One brand's own decisions, never another's.
 */

/** How far back a brand's decisions count: its habits now, not a year ago. */
export const DECISION_WINDOW_DAYS = 90;
/** Decided suggestions for a rule before its share means anything. */
export const CAREFUL_MIN_DECIDED = 5;
/** The share rejected past which the agent is careful with a rule. */
export const CAREFUL_REJECT_SHARE = 0.7;
/** Rules named at most, the most rejected first. */
const CAREFUL_MAX = 5;

const DAY_MS = 86_400_000;

/**
 * The rules the brand mostly rejects the agent's suggestions for, each with
 * its counts, the most rejected first: `[{ key, accepted, rejected }]`.
 * Empty when it has decided too few to tell.
 */
export async function carefulRules(brandId, { now = new Date(), db = supabaseAdmin } = {}) {
  const since = new Date(now.getTime() - DECISION_WINDOW_DAYS * DAY_MS).toISOString();
  const { data, error } = await db.rpc('content_suggestion_decisions', {
    p_brand_id: brandId,
    p_since: since,
  });
  if (error) throw new Error(`content_suggestion_decisions: ${error.message}`);
  return (data ?? [])
    .map((row) => ({
      key: String(row.rule_key ?? ''),
      accepted: Number(row.accepted) || 0,
      rejected: Number(row.rejected) || 0,
    }))
    .filter(({ key, accepted, rejected }) => {
      const decided = accepted + rejected;
      return key && decided >= CAREFUL_MIN_DECIDED && rejected / decided >= CAREFUL_REJECT_SHARE;
    })
    .sort((a, b) => b.rejected - a.rejected || a.key.localeCompare(b.key))
    .slice(0, CAREFUL_MAX);
}

/**
 * What the agent is told about the rules it fixes now that people at this
 * brand mostly reject its changes for; '' with none.
 */
export function carefulLine(careful) {
  if (!careful.length) return '';
  const list = careful
    .map(({ key, accepted, rejected }) => `${key} (${rejected} of ${accepted + rejected} rejected)`)
    .join(', ');
  return `People at this brand reject most of the changes suggested for these rules: ${list}. For them, suggest a change only where the rule can't be met without it, and keep it as small as the rule allows: the fewest words, no new section.`;
}
