import supabaseAdmin from '../../config/supabase.js';
import { selectInChunks } from '../chunked-in.js';
import { logger } from '../logger.js';

/**
 * What moved in a brand's Opportunities since the last week compared
 * (ADS-01 §6: the weekly Paid Opportunity agent flags what is new; 00531's
 * weekly snapshots, which only the server reads). Each row the plan shows
 * is compared with the brand's latest snapshot week before this one:
 *   - newPrompts: a buying-intent prompt that had no row that week;
 *   - moved: the rule's decision changed, Earn to Pay say (from, decision);
 *   - rivalPays: a rival pays on the prompt now, and didn't (or wasn't
 *     measured) then. Where the brand leads (rule `defend`), a rival pays on
 *     its name.
 * The rule's decisions on both sides (`recommended`, the snapshot's): a
 * person's own decision is theirs, not news. Only the rows the plan shows
 * are read, so a locked row says nothing through this.
 */

/** A row's rule decision now: `recommended` beside a person's decision, else its own. */
const ruleDecision = (row) => row.recommended ?? row.decision;

/**
 * @param {Array<{ promptId: string, text: string, decision: string, recommended?: string,
 *   rule?: string, rivalPays?: boolean | null }>} rows the rows the plan shows, now
 * @param {Array<{ prompt_id: string, decision: string, inputs?: object }>} before
 *   their snapshots of the week compared with
 */
export function weekChanges(rows, before) {
  const then = new Map(before.map((snapshot) => [snapshot.prompt_id, snapshot]));
  const changes = { newPrompts: [], moved: [], rivalPays: [] };
  for (const row of rows) {
    const was = then.get(row.promptId);
    const now = { promptId: row.promptId, text: row.text, decision: ruleDecision(row) };
    if (!was) {
      changes.newPrompts.push(now);
      continue;
    }
    if (was.decision !== now.decision) changes.moved.push({ ...now, from: was.decision });
    if (row.rivalPays === true && was.inputs?.rivalPays !== true) {
      changes.rivalPays.push({ ...now, rule: row.rule ?? null });
    }
  }
  return changes;
}

/**
 * The changes since the brand's latest snapshot week before `week` (ISO
 * weeks sort as text), for `rows`: { since, newPrompts, moved, rivalPays },
 * or null when there is no earlier week yet. A read that fails is logged,
 * and the Opportunities read still answers (null).
 */
export async function readSinceLastWeek(brandId, rows, week) {
  try {
    const last = await supabaseAdmin
      .from('ads_opportunity_snapshots')
      .select('iso_week')
      .eq('brand_id', brandId)
      .lt('iso_week', week)
      .order('iso_week', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last.error) throw new Error(last.error.message);
    if (!last.data) return null;
    const since = last.data.iso_week;
    const { data, error } = await selectInChunks(
      rows.map((row) => row.promptId),
      (ids) =>
        supabaseAdmin
          .from('ads_opportunity_snapshots')
          .select('prompt_id, decision, inputs')
          .eq('brand_id', brandId)
          .eq('iso_week', since)
          .in('prompt_id', ids),
    );
    if (error) throw new Error(error.message);
    return { since, ...weekChanges(rows, data ?? []) };
  } catch (err) {
    logger.warn({ brandId, week, err: err.message }, '[ads] last week could not be compared');
    return null;
  }
}
