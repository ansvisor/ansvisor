/**
 * Chat's model steps on the workspace's one AI budget (CHAT-04 §C items
 * 11–14, CHAT-16 items 22, 26, 29–30; DECISIONS P), behind CHAT_AGENTIC. The
 * web's Chat engine runs the models; before each model step it asks for a
 * hold here, and once the step ends it charges it, lets it go or keeps it,
 * through /api/internal/chat/budget (routes/internal-chat-budget.js).
 *
 * Every step writes one prompt_improve_usage row, named by its run and step
 * (00405):
 *   - On Ansvisor's key, the row is a hold of the step's worst case, taken
 *     by reserve_chat_ai_usage under the organization's lock only while the
 *     period's spend, holds in flight included, plus that worst case stays
 *     within the budget: runs at once can't pass it (item 13). Stricter than
 *     reserveAiBudget's, which lets a call start while anything is left.
 *   - On the workspace's own key (ownKey), the row is written without a
 *     check and never counts: the provider bills the workspace (item 26).
 *   - With no budget to hold against (self-hosted), it is written unchecked.
 * The charge then turns the row into the step's real cost: 1x, what the
 * model costs at the price in effect (generationCostUsd: the synced catalog
 * price first, for Chat's steps only, and never a $0 one for a paid model).
 * The margin on purchased AI credits (CHAT-16 30a) is never here.
 *
 * The trial's budget is the plan's in its trial (applyTrialAiBudget), over a
 * period that runs the whole trial (aiBudgetOf): it never resets.
 */

import supabaseAdmin from '../config/supabase.js';
import { chatAgenticEnabled } from './chat-flag.js';
import { generationCostUsd } from './improve-cost.js';
import { CHAT_AI_FEATURES, aiBudgetOf, aiBudgetUsedUp } from './plan-guard.js';

/** What a Chat step can be metered as: a run's model step, then agents, scheduled runs, images. */
export const CHAT_BUDGET_FEATURES = CHAT_AI_FEATURES;

/** A request about a step the server can't take (Chat off, a run not the workspace's). */
export class ChatBudgetError extends Error {
  /**
   * @param {'chat_off' | 'not_found'} code
   * @param {number} statusCode
   */
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'ChatBudgetError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * A step's worst case (item 13): its prompt at the input price in effect and
 * every token it may write at the output price. The pre-step estimate
 * assumes no prompt-cache hit (§D item 29), so a cache miss can't pass it.
 */
export function stepWorstCaseUsd(modelId, { inputTokens, maxOutputTokens }) {
  return generationCostUsd(
    modelId,
    { inputTokens, outputTokens: maxOutputTokens },
    { synced: true },
  );
}

function assertChatOn(orgId) {
  if (!chatAgenticEnabled(orgId)) {
    throw new ChatBudgetError('chat_off', 403, 'Chat is off for this workspace.');
  }
}

/**
 * Holds a step's worst case on the budget and writes its row; returns the
 * row's id, for the charge or the release. PlanLimitError 429 when the
 * budget can't cover the step (the step doesn't start), 402 without an
 * active plan; ChatBudgetError 404 when the run isn't the workspace's, or the
 * step the run's.
 */
export async function reserveChatStep(
  orgId,
  { feature = 'chat', modelId, inputTokens, maxOutputTokens, runId, stepId = null, ownKey = false },
) {
  assertChatOn(orgId);
  const { plan, budgetUsd, since } = await aiBudgetOf(orgId);
  const { data, error } = await supabaseAdmin.rpc('reserve_chat_ai_usage', {
    p_organization_id: orgId,
    p_chat_run_id: runId,
    p_chat_run_step_id: stepId,
    p_feature: feature,
    p_model: modelId,
    p_cost: stepWorstCaseUsd(modelId, { inputTokens, maxOutputTokens }),
    p_own_key: ownKey,
    p_since: since,
    p_budget: budgetUsd,
  });
  if (error) {
    if (error.code === 'P0002') {
      throw new ChatBudgetError('not_found', 404, 'Chat run not found.');
    }
    throw new Error(error.message);
  }
  if (!data) throw aiBudgetUsedUp(plan);
  return data;
}

/**
 * The step's real cost in place of its hold: what its model used, priced 1x
 * (generationCostUsd). Only the workspace's own Chat rows: ChatBudgetError
 * 404 when the row is gone (released) or isn't one. A step that called the
 * model more than once (a retry) is charged its total usage. A provider
 * that reported no usage leaves the hold as the step's cost: over, never
 * under.
 */
export async function chargeChatStep(orgId, usageId, { modelId, usage }) {
  const reported = usage?.inputTokens != null || usage?.outputTokens != null;
  const { data, error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .update(
      reported
        ? {
            model: modelId,
            input_tokens: usage.inputTokens ?? null,
            output_tokens: usage.outputTokens ?? null,
            cost_usd: generationCostUsd(modelId, usage, { synced: true }),
          }
        : { model: modelId },
    )
    .eq('id', usageId)
    .eq('organization_id', orgId)
    .in('feature', CHAT_BUDGET_FEATURES)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new ChatBudgetError('not_found', 404, 'Chat step usage not found.');
}

/**
 * A step that billed nothing (it failed before an answer): its hold goes.
 * Safe to ask more than once. A step a Stop aborted isn't released: the
 * provider bills it all the same, so its hold stays as its cost (the web's
 * keep()). Charging and releasing settle a hold already taken, so they work
 * whether or not Chat is still on.
 */
export async function releaseChatStep(orgId, usageId) {
  const { error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .delete()
    .eq('id', usageId)
    .eq('organization_id', orgId)
    .in('feature', CHAT_BUDGET_FEATURES);
  if (error) throw new Error(error.message);
}

/**
 * Each agent's share of the AI limit (CHAT-27 items 24–30), for the web's
 * Agents list and agent detail: what its runs spent on the budget and on the
 * workspace's own key, over the budget, and how many runs spent anything
 * (chat_agent_usage_shares, 00419). Since the period's start (the meter's,
 * aiBudgetOf), or over the last `days` days against the same budget. Shares
 * only: the budget stays here. No budget to share (self-hosted): unlimited,
 * no rows.
 */
export async function agentUsageShares(orgId, { days = null } = {}) {
  assertChatOn(orgId);
  const { budgetUsd, since } = await aiBudgetOf(orgId);
  if (budgetUsd === null || !(budgetUsd > 0)) return { unlimited: true, since: null, shares: [] };
  const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : since;
  const { data, error } = await supabaseAdmin.rpc('chat_agent_usage_shares', {
    p_organization_id: orgId,
    p_since: from,
    p_budget: budgetUsd,
  });
  if (error) throw new Error(error.message);
  return {
    unlimited: false,
    since: from,
    shares: (data ?? []).map((row) => ({
      agentId: row.agent_id ?? null,
      share: Number(row.share) || 0,
      ownKeyShare: Number(row.own_key_share) || 0,
      runs: Number(row.runs) || 0,
    })),
  };
}
