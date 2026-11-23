/**
 * New prompt suggestions when the opportunities run out.
 *
 * Each need (prompt cluster) gets one content opportunity, so once every
 * need with answers has one, the nightly run writes none: new opportunities
 * only come from new needs, that is new prompts. On such a night the brand's
 * prompt suggestions are refreshed by themselves (Prompts › Suggestions, whose
 * menu dot then turns yellow), so there is something to add.
 *
 * Sparingly: at most once every AUTO_SUGGEST_EVERY_DAYS, never over
 * suggestions still waiting for a decision (a refresh replaces those), only
 * on a plan with prompt suggestions and for a brand with a topic.
 */

import supabaseAdmin from '../config/supabase.js';
import { hasFeature } from '../config/plans.js';
import { BUSINESS_HUB_SOURCE } from './business-hub/topic-prompts.js';
import { refreshBrandSuggestions } from './prompt-suggestion-refresh.js';

/** Days between two refreshes of the brand's suggestions, by hand or by night. */
export const AUTO_SUGGEST_EVERY_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * Whether a nightly opportunity run left no need without an opportunity:
 * it wrote none, wasn't held back by the monthly limit, and every need in
 * its scope with answers is covered (generateContentOpportunities' `scope`).
 *
 * @param {{ generated?: number, limited?: boolean, scope?: { needs: number, covered: number, noAnswers: number } } | null | undefined} result
 */
export function everyNeedCovered(result) {
  if (!result || result.limited || (result.generated ?? 0) > 0 || !result.scope) return false;
  const { needs, covered, noAnswers } = result.scope;
  return needs > 0 && needs - covered - noAnswers <= 0;
}

/**
 * Whether the brand's suggestions are due a refresh: none still waiting for a
 * decision, and the last batch at least AUTO_SUGGEST_EVERY_DAYS old.
 *
 * @param {{ waiting: number, lastGeneratedAt: string | null, now?: number }} input
 */
export function suggestionsDue({ waiting, lastGeneratedAt, now = Date.now() }) {
  if (waiting > 0) return false;
  if (!lastGeneratedAt) return true;
  const last = Date.parse(lastGeneratedAt);
  return !Number.isFinite(last) || now - last >= AUTO_SUGGEST_EVERY_DAYS * DAY_MS;
}

/**
 * Refreshes the brand's prompt suggestions after a nightly opportunity run
 * that found every need covered, when they're due. Never throws: a failure
 * is logged, and the next such night tries again.
 *
 * @param {string} brandId
 * @param {{ orgId: string, plan: object, result: object, log: import('pino').Logger, now?: number }} opts
 * @returns {Promise<{ refreshed: boolean, count?: number }>}
 */
export async function autoSuggestPrompts(brandId, { orgId, plan, result, log, now = Date.now() }) {
  try {
    if (!everyNeedCovered(result) || !hasFeature(plan, 'prompt_suggestions')) {
      return { refreshed: false };
    }
    const nowIso = new Date(now).toISOString();
    const [topicsRead, waitingRead, lastRead] = await Promise.all([
      supabaseAdmin
        .from('topics')
        .select('id')
        .eq('brand_id', brandId)
        .eq('is_active', true)
        .limit(1),
      supabaseAdmin
        .from('prompt_suggestions')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('status', 'new')
        .neq('source', BUSINESS_HUB_SOURCE)
        .gt('expires_at', nowIso),
      supabaseAdmin
        .from('prompt_suggestions')
        .select('generated_at')
        .eq('brand_id', brandId)
        .neq('source', BUSINESS_HUB_SOURCE)
        .order('generated_at', { ascending: false })
        .limit(1),
    ]);
    for (const read of [topicsRead, waitingRead, lastRead]) {
      if (read.error) throw read.error;
    }
    if (!(topicsRead.data ?? []).length) return { refreshed: false };
    const due = suggestionsDue({
      waiting: waitingRead.count ?? 0,
      lastGeneratedAt: lastRead.data?.[0]?.generated_at ?? null,
      now,
    });
    if (!due) return { refreshed: false };

    const suggestions = await refreshBrandSuggestions(brandId, { orgId, log });
    log.info(
      { brandId, count: suggestions.length },
      '[auto-suggestions] every need covered: suggestions refreshed',
    );
    return { refreshed: true, count: suggestions.length };
  } catch (err) {
    log.error({ err, brandId }, '[auto-suggestions] refresh failed');
    return { refreshed: false };
  }
}
