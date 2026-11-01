import type { StartSiteAuditsResult } from '@/lib/actions/audits';
import { auditStartRequest, auditStartResult } from '@/lib/audit/start-answer';
import type { ContentOpportunity } from '@/types';
import { assertWritableFor, isManagerFor, type RunActor } from './access';
import { actingRefusalOf, apiAs, type ActingRefusal } from './api';

/**
 * Chat's writes through the API server for a run with no session behind it
 * (update_opportunity, dismiss_prompt_suggestion, run_site_audit runFor):
 * the same requests as updateOpportunityStatus, dismissSuggestion and
 * startSiteAudits, sent as the run's person (api.ts). The API checks them
 * as their session (the demo brand, the plan, the brand, the route's role);
 * what the session's action checks before it sends is checked here too. A
 * refusal of the acting way comes back as a value the engine says. Server
 * only, and never a server action: the person is the caller's word.
 */

/** updateOpportunityStatus for the run's person: the opportunity, or why the way refused. */
export async function updateOpportunityStatusFor(
  actor: RunActor,
  id: string,
  status: string,
  reason?: 'not_relevant' | 'wrong_angle',
): Promise<ContentOpportunity | ActingRefusal> {
  try {
    const res = await apiAs(actor, `/api/content/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { status, ...(reason ? { reason } : {}) },
    });
    if (!res.ok) throw new Error(String(res.body.error || `Server error: ${res.status}`));
    return res.body as unknown as ContentOpportunity;
  } catch (err) {
    const refused = actingRefusalOf(err);
    if (refused) return refused;
    throw err;
  }
}

/** dismissSuggestion for the run's person. */
export async function dismissSuggestionFor(
  actor: RunActor,
  suggestionId: string,
): Promise<{ success: boolean } | ActingRefusal> {
  try {
    const res = await apiAs(
      actor,
      `/api/prompts/suggestions/${encodeURIComponent(suggestionId)}/dismiss`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error(String(res.body.error || `Server error: ${res.status}`));
    return res.body as { success: boolean };
  } catch (err) {
    const refused = actingRefusalOf(err);
    if (refused) return refused;
    throw err;
  }
}

/** startSiteAudits for the run's person: an Admin's or a Manager's, on a brand it may write. */
export async function startSiteAuditsFor(
  actor: RunActor,
  brandId: string,
  urls: string[],
  options: { force?: boolean } = {},
): Promise<StartSiteAuditsResult | ActingRefusal> {
  try {
    await assertWritableFor(actor, brandId);
    if (!(await isManagerFor(actor, actor.organizationId))) {
      return {
        ok: false,
        reason: 'forbidden_role',
        message: 'Only an admin or a manager can start audits from Chat.',
      };
    }
    const { path, body } = auditStartRequest(brandId, urls, options.force === true);
    const res = await apiAs(actor, path, { method: 'POST', body });
    return auditStartResult(urls, res, res.body);
  } catch (err) {
    const refused = actingRefusalOf(err);
    if (refused) return refused;
    console.error('Failed to start the audits:', err);
    return { ok: false, reason: 'failed', message: 'The audits couldn’t be started. Try again.' };
  }
}
