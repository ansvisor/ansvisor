import supabaseAdmin from '../config/supabase.js';
import {
  getPlan,
  hasFeature,
  isWithinLimit,
  isCloud,
  isSubscriptionActive,
} from '../config/plans.js';
import { anchoredPeriodStart, shiftMonthClamped } from './quota-period.js';
import {
  IMPROVE_BUDGET_SHARE,
  estimateGenerationsLeft,
  generationCostUsd,
  medianCost,
  typicalCostUsd,
} from './improve-cost.js';
import { logger } from './logger.js';
import { RELEVANCE_BUDGET_SHARE } from './suggestion-relevance.js';
import { AUDIT_RUN_TIMEOUT_MS } from './audit/history.js';
import {
  autoAuditEnabled,
  dueRun,
  pendingRuns,
  perRunSlots,
  runSchedule,
} from './audit/auto-audit.js';

export class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'PlanLimitError';
    this.statusCode = statusCode;
  }
}

/**
 * Enterprise orgs can have per-customer limit overrides stored in
 * organizations.plan_overrides (jsonb) — mirrors web getOrgPlan().
 *
 * `contractMonthlyUsd` is the contract's monthly value, entered when the deal
 * is signed. It sets the Improve budget to 1% of the contract (never below
 * the plan default), unless `improveMonthlyBudgetUsd` is set explicitly,
 * which wins. The relevance
 * budget (VIS-011) follows the same rule at 0.1%, rounded down so it never
 * passes the share.
 */
export function applyPlanOverrides(plan, org) {
  if (
    org?.plan === 'enterprise' &&
    org.plan_overrides &&
    typeof org.plan_overrides === 'object' &&
    !Array.isArray(org.plan_overrides)
  ) {
    const overrides = org.plan_overrides;
    const limits = { ...plan.limits, ...overrides };
    const usd = Number(overrides.contractMonthlyUsd);
    if (overrides.improveMonthlyBudgetUsd === undefined && Number.isFinite(usd) && usd > 0) {
      limits.improveMonthlyBudgetUsd = Math.max(
        plan.limits.improveMonthlyBudgetUsd ?? 0,
        Math.round(usd * IMPROVE_BUDGET_SHARE * 100) / 100,
      );
    }
    if (overrides.relevanceMonthlyBudgetUsd === undefined && Number.isFinite(usd) && usd > 0) {
      limits.relevanceMonthlyBudgetUsd = Math.max(
        plan.limits.relevanceMonthlyBudgetUsd ?? 0,
        Math.floor(usd * RELEVANCE_BUDGET_SHARE * 1e6) / 1e6,
      );
    }
    return { ...plan, limits };
  }
  return plan;
}

/**
 * Resolve an organization's plan directly by org id.
 * Self-hosted → returns self_hosted plan (unlimited).
 */
async function resolveOrgPlanByOrgId(orgId) {
  if (!isCloud()) return getPlan('self_hosted');

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan, subscription_status, plan_overrides')
    .eq('id', orgId)
    .single();

  // Block feature access for orgs without an active or trialing Stripe
  // subscription. Previously this fell back to starter, which silently
  // granted billed features (volume fetch, content generation, etc.) to
  // unsubscribed signups.
  if (!isSubscriptionActive(org?.subscription_status)) {
    throw new PlanLimitError(
      'An active subscription or free trial is required. Please choose a plan to continue.',
      402,
    );
  }

  return applyPlanOverrides(getPlan(org.plan), org);
}

/**
 * Resolve the user's organization id, or null if none.
 */
export async function getOrgIdForUser(userId) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return profile?.organization_id || null;
}

/**
 * Resolve the user's organization plan from the database.
 * Self-hosted → returns self_hosted plan (unlimited).
 */
async function resolveOrgPlan(userId) {
  if (!isCloud()) return getPlan('self_hosted');

  const orgId = await getOrgIdForUser(userId);
  if (!orgId) {
    throw new PlanLimitError('No organization found for user.', 400);
  }

  return resolveOrgPlanByOrgId(orgId);
}

/**
 * Enforce that the user's plan includes a specific feature.
 * Throws PlanLimitError if not.
 */
export async function enforceFeature(userId, feature) {
  const plan = await resolveOrgPlan(userId);
  if (!hasFeature(plan, feature)) {
    throw new PlanLimitError(
      `Your ${plan.name} plan does not include "${feature}". Please upgrade.`,
    );
  }
  return plan;
}

/**
 * Enforce that the user's plan has not exceeded a numeric limit.
 * Throws PlanLimitError if limit reached.
 */
export async function enforceLimit(userId, limitKey, currentCount) {
  const plan = await resolveOrgPlan(userId);
  if (!isWithinLimit(plan, limitKey, currentCount)) {
    const max = plan.limits[limitKey];
    throw new PlanLimitError(
      `Plan limit reached: maximum ${max} ${limitKey} on the ${plan.name} plan. Please upgrade.`,
    );
  }
  return plan;
}

/**
 * Enforce monthly volume analysis quota.
 * Returns { plan, remaining, orgId } on success, throws PlanLimitError if quota exceeded.
 */
export async function enforceVolumeQuota(userId) {
  const plan = await resolveOrgPlan(userId);
  const maxAnalyses = plan.limits.maxVolumeAnalyses;
  if (maxAnalyses === -1) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .single();
    return { plan, remaining: -1, orgId: profile?.organization_id };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (!profile?.organization_id) {
    throw new PlanLimitError('No organization found for user.', 400);
  }

  const periodStart = await quotaPeriodStart(profile.organization_id);

  const { count } = await supabaseAdmin
    .from('volume_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id)
    .gte('used_at', periodStart.toISOString());

  const used = count || 0;
  if (used >= maxAnalyses) {
    throw new PlanLimitError(
      `Monthly volume analysis limit reached (${used}/${maxAnalyses}). Resets when your subscription renews.`,
    );
  }

  return { plan, remaining: maxAnalyses - used, orgId: profile.organization_id };
}

/**
 * Get current volume quota status without enforcing.
 * Returns { used, limit, remaining }.
 */
export async function getVolumeQuotaStatus(userId) {
  const plan = await resolveOrgPlan(userId);
  const maxAnalyses = plan.limits.maxVolumeAnalyses;
  if (maxAnalyses === -1) return { used: 0, limit: -1, remaining: -1 };

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (!profile?.organization_id) return { used: 0, limit: maxAnalyses, remaining: maxAnalyses };

  const periodStart = await quotaPeriodStart(profile.organization_id);

  const { count } = await supabaseAdmin
    .from('volume_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id)
    .gte('used_at', periodStart.toISOString());

  const used = count || 0;
  return { used, limit: maxAnalyses, remaining: maxAnalyses - used };
}

function startOfCurrentMonth(now = new Date()) {
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Start of the monthly quota window containing `now`, anchored to the
 * subscription's billing day (`subscription_ends_at` = Stripe's
 * current_period_end, kept fresh by the webhook). Quotas renew when the
 * customer's payment renews — not on the 1st of the calendar month, which
 * made a renewal day feel like a limit that never reset (#500).
 *
 * Orgs without an active subscription (free, incomplete, self-host paths
 * that still reach here) fall back to the calendar month. Window math lives
 * in quota-period.js.
 */
export async function quotaPeriodStart(orgId, now = new Date()) {
  if (!isCloud() || !orgId) return startOfCurrentMonth(now);

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('subscription_ends_at, subscription_status')
    .eq('id', orgId)
    .maybeSingle();

  const endsAt = org?.subscription_ends_at ? new Date(org.subscription_ends_at) : null;
  if (!endsAt || Number.isNaN(endsAt.getTime()) || !isSubscriptionActive(org.subscription_status)) {
    return startOfCurrentMonth(now);
  }

  return anchoredPeriodStart(endsAt, now);
}

async function countBriefUsageThisMonth(orgId) {
  const periodStart = await quotaPeriodStart(orgId);
  const { count } = await supabaseAdmin
    .from('brief_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('used_at', periodStart.toISOString());
  return count || 0;
}

/**
 * Enforce the monthly content-brief generation quota for an organization.
 * Org-based (not user-based) so both the dashboard route and the internal
 * MCP route charge the same pool. Returns { plan, remaining } on success,
 * throws PlanLimitError when the quota is exhausted.
 */
export async function enforceBriefQuota(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const max = plan.limits.maxBriefGenerations;
  if (max === -1) return { plan, remaining: -1 };

  const used = await countBriefUsageThisMonth(orgId);
  if (used >= max) {
    throw new PlanLimitError(
      `Monthly content brief limit reached (${used}/${max}) on the ${plan.name} plan. Resets when your subscription renews — upgrade for more.`,
    );
  }

  return { plan, remaining: max - used };
}

/**
 * Get current brief quota status without enforcing.
 * Returns { used, limit, remaining }.
 */
export async function getBriefQuotaStatus(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const max = plan.limits.maxBriefGenerations;
  if (max === -1) return { used: 0, limit: -1, remaining: -1 };

  const used = await countBriefUsageThisMonth(orgId);
  return { used, limit: max, remaining: Math.max(0, max - used) };
}

/** How many of the org's latest calls its typical cost is the median of. */
const RECENT_CALLS = 20;

async function improveSpendThisPeriod(orgId) {
  const periodStart = await quotaPeriodStart(orgId);
  const { data } = await supabaseAdmin
    .from('prompt_improve_usage')
    .select('cost_usd')
    .eq('organization_id', orgId)
    .gte('used_at', periodStart.toISOString())
    .order('used_at', { ascending: false })
    .limit(5000);
  const costs = (data ?? []).map((r) => Number(r.cost_usd) || 0);
  const spent = costs.reduce((a, b) => a + b, 0);
  return { spent, typical: medianCost(costs.slice(0, RECENT_CALLS)) };
}

/**
 * Improve-tab budget (PROMPT-003): a monthly USD budget per organization
 * (plan.limits.improveMonthlyBudgetUsd: Starter $1, Growth $5, Enterprise
 * $10 or 1% of its contract), charged with each generation's real token
 * cost so the budget holds for any model. Users
 * see an estimate of generations left, not dollars. -1 is unlimited.
 */
export async function getImproveQuotaStatus(orgId, modelId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  if (budget === -1) return { unlimited: true, planName: plan.name };
  const { spent, typical } = await improveSpendThisPeriod(orgId);
  const remaining = Math.max(0, budget - spent);
  return {
    unlimited: false,
    planName: plan.name,
    budgetUsd: budget,
    spentUsd: spent,
    remainingUsd: remaining,
    generationsLeft: estimateGenerationsLeft(remaining, typical ?? typicalCostUsd(modelId)),
    percentLeft: budget > 0 ? Math.round((remaining / budget) * 100) : 0,
  };
}

/**
 * Holds a call's share of the workspace's AI budget before it runs (00243),
 * so calls running at once can't all pass a nearly spent budget: the
 * period's spend, reservations included, is read and the call's estimated
 * cost written under a per-organization lock. A call runs while the spend
 * is under the budget, as it did when the spend was only read; once it is
 * spent, PlanLimitError (429).
 *
 * Returns the call's meter:
 *   - charge(usage): one model attempt at its real token cost. The first
 *     turns the reservation into it; any later one (a retry, a second call)
 *     adds its own row. Errors are logged, not thrown: what the user paid
 *     for still goes out.
 *   - release(): when nothing was charged (the call failed before an
 *     answer), the reservation goes. Safe to call more than once; call it
 *     in a finally.
 * An unlimited budget (self-hosted) reserves nothing; charge() still writes
 * the rows, as before.
 */
export async function reserveAiBudget(
  orgId,
  { feature, modelId, promptId = null, actionId = null, draftId = null },
) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  let reservedId = null;
  if (budget !== -1) {
    const since = (await quotaPeriodStart(orgId)).toISOString();
    const { data, error } = await supabaseAdmin.rpc('reserve_ai_usage', {
      p_organization_id: orgId,
      p_since: since,
      p_budget: budget,
      p_cost: await holdCostUsd(orgId, modelId, since),
      p_feature: feature,
      p_model: modelId,
      p_prompt_id: promptId,
      p_action_id: actionId,
      p_content_draft_id: draftId,
    });
    if (error) throw new Error(error.message);
    if (!data) {
      throw new PlanLimitError(
        `This month's suggestion budget on the ${plan.name} plan is used up. It resets when your subscription renews.`,
        429,
      );
    }
    reservedId = data;
  }

  let charged = false;
  return {
    async charge(usage) {
      const cost = {
        model: modelId,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        cost_usd: generationCostUsd(modelId, usage),
      };
      const first = reservedId && !charged;
      charged = true;
      const { error } = first
        ? await supabaseAdmin.from('prompt_improve_usage').update(cost).eq('id', reservedId)
        : await supabaseAdmin.from('prompt_improve_usage').insert({
            organization_id: orgId,
            feature,
            prompt_id: promptId,
            action_id: actionId,
            content_draft_id: draftId,
            ...cost,
          });
      if (error) logger.error({ err: error, orgId, feature }, '[ai-budget] usage write failed');
    },
    async release() {
      if (!reservedId || charged) return;
      charged = true;
      const { error } = await supabaseAdmin
        .from('prompt_improve_usage')
        .delete()
        .eq('id', reservedId);
      if (error) logger.error({ err: error, orgId, feature }, '[ai-budget] release failed');
    },
    /**
     * A call sent and then aborted (the run's Stop): the provider finishes
     * and bills it all the same, so the hold stays as its cost and release()
     * leaves it. With no hold (an unlimited budget), it is written at what a
     * hold would be.
     */
    async keep() {
      if (charged) return;
      charged = true;
      if (reservedId) return;
      const since = (await quotaPeriodStart(orgId)).toISOString();
      const { error } = await supabaseAdmin.from('prompt_improve_usage').insert({
        organization_id: orgId,
        feature,
        prompt_id: promptId,
        action_id: actionId,
        content_draft_id: draftId,
        model: modelId,
        cost_usd: await holdCostUsd(orgId, modelId, since),
      });
      if (error) logger.error({ err: error, orgId, feature }, '[ai-budget] usage write failed');
    },
  };
}

/**
 * What a call holds before it runs: the org's median cost over its last
 * RECENT_CALLS calls this period, never less than the model's typical one.
 * Calls average about twice the typical estimate and reach five times it (a
 * whole page, a long draft), so holding only the estimate let each call in
 * flight pass the budget by the difference. Holds in flight count at their
 * own size, so they don't raise the median. A read that fails holds the
 * typical cost.
 */
async function holdCostUsd(orgId, modelId, since) {
  const typical = typicalCostUsd(modelId);
  const { data, error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .select('cost_usd')
    .eq('organization_id', orgId)
    .gte('used_at', since)
    .order('used_at', { ascending: false })
    .limit(RECENT_CALLS);
  if (error) {
    logger.error({ err: error, orgId }, '[ai-budget] recent costs read failed');
    return typical;
  }
  const recent = medianCost((data ?? []).map((r) => Number(r.cost_usd) || 0));
  return Math.max(typical, recent ?? 0);
}

/** What the workspace's AI budget is spent on, as prompt_improve_usage.feature says (00242). */
export const AI_USAGE_FEATURES = ['improve', 'content', 'action_center'];

const tenths = (n) => Math.round(n * 10) / 10;

/**
 * This period's AI usage, for the Billing page's meter: how much of the
 * workspace's AI budget (plan.limits.improveMonthlyBudgetUsd, the one
 * Improve, the Content Editor's AI and the Action Center's task writer all
 * charge) is used, by feature, and when it renews. Shares of the budget, in
 * percent to a tenth; dollars stay on the server, as the Improve tab's quota
 * does. Spend past the budget (calls already running when it ran out) reads
 * as 100%, its features scaled to fit. Rows whose feature isn't known (from
 * before 00242, their item deleted) count as 'other', listed only when there
 * are some. Unlimited plans (self-hosted) show no meter.
 */
export async function getAiUsage(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const periodStart = await quotaPeriodStart(orgId);
  const base = {
    plan: plan.id,
    planName: plan.name,
    periodStart: periodStart.toISOString(),
    periodEnd: shiftMonthClamped(periodStart, 1).toISOString(),
  };
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  if (budget === -1) return { ...base, unlimited: true, percentUsed: null, features: [] };

  const { data, error } = await supabaseAdmin.rpc('ai_usage_by_feature', {
    p_organization_id: orgId,
    p_since: base.periodStart,
  });
  if (error) throw new Error(error.message);
  const spentOn = new Map((data ?? []).map((r) => [r.feature, Number(r.cost_usd) || 0]));
  const spent = [...spentOn.values()].reduce((a, b) => a + b, 0);
  const scale = budget > 0 && spent > budget ? budget / spent : 1;
  const percentOf = (usd) => (budget > 0 ? tenths((usd * scale * 100) / budget) : 0);
  const other = spentOn.get('other') ?? 0;
  return {
    ...base,
    unlimited: false,
    // 100 only once it's spent, as reserveAiBudget stops there (a budget of
    // 0 included); just under reads as 99.9, never rounded up to "used up".
    percentUsed:
      budget <= 0 || spent >= budget ? 100 : Math.min(99.9, tenths((spent * 100) / budget)),
    features: [
      ...AI_USAGE_FEATURES.map((feature) => ({
        feature,
        percent: percentOf(spentOn.get(feature) ?? 0),
      })),
      ...(other > 0 ? [{ feature: 'other', percent: percentOf(other) }] : []),
    ],
  };
}

/**
 * Suggestion-relevance allowance (VIS-011): a monthly USD budget per
 * organization, 0.1% of the plan price (plan.limits.relevanceMonthlyBudgetUsd),
 * separate from Improve's. Reserves a refresh's worst case (`costUsd`)
 * before it rates, atomically per organization
 * (reserve_suggestion_relevance), so concurrent refreshes can't overshoot.
 * Returns { unlimited, id }: id is the usage row to settle once the model
 * answers (settleRelevanceUsage), or null when what's left can't cover it.
 */
export async function reserveRelevanceAllowance(orgId, { brandId, modelId, costUsd }) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const budget = plan.limits.relevanceMonthlyBudgetUsd ?? -1;
  if (budget === -1) return { unlimited: true, id: null };

  const { data, error } = await supabaseAdmin.rpc('reserve_suggestion_relevance', {
    p_organization_id: orgId,
    p_brand_id: brandId,
    p_model: modelId,
    p_since: (await quotaPeriodStart(orgId)).toISOString(),
    p_budget: budget,
    p_cost: costUsd,
  });
  if (error) throw new Error(error.message);
  return { unlimited: false, id: data ?? null };
}

/**
 * Lowers a reservation to what the refresh's attempts cost, with the call's
 * own tokens to check the estimate against. A failed update leaves the
 * worst case charged: the budget errs high, never low.
 */
export async function settleRelevanceUsage(id, { attempts, costUsd, usage }) {
  const { error } = await supabaseAdmin
    .from('suggestion_relevance_usage')
    .update({
      attempts,
      cost_usd: costUsd,
      input_tokens: usage?.inputTokens ?? null,
      output_tokens: usage?.outputTokens ?? null,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

async function countOpportunityUsage(orgId, since) {
  const { count } = await supabaseAdmin
    .from('opportunity_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('used_at', since.toISOString());
  return count || 0;
}

/**
 * Get the monthly content opportunity quota without enforcing (CONTENT-001).
 * Returns { used, limit, remaining }; limit -1 is unlimited.
 */
export async function getOpportunityQuotaStatus(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const max = plan.limits.maxOpportunitiesPerMonth ?? -1;
  if (max === -1) return { used: 0, limit: -1, remaining: -1 };

  const used = await countOpportunityUsage(orgId, await quotaPeriodStart(orgId));
  return { used, limit: max, remaining: Math.max(0, max - used) };
}

/**
 * Claim up to `count` of this period's opportunity slots before generating.
 * Atomic per organization (claim_opportunity_usage), so concurrent runs can't
 * overshoot. Returns { unlimited, ids }: link each id to the opportunity it
 * becomes (linkOpportunitySlots) and hand back the rest (releaseOpportunitySlots).
 */
export async function claimOpportunitySlots(orgId, count) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const max = plan.limits.maxOpportunitiesPerMonth ?? -1;
  if (max === -1) return { unlimited: true, ids: [] };
  if (count <= 0) return { unlimited: false, ids: [] };

  const { data, error } = await supabaseAdmin.rpc('claim_opportunity_usage', {
    p_organization_id: orgId,
    p_since: (await quotaPeriodStart(orgId)).toISOString(),
    p_limit: max,
    p_count: count,
  });
  if (error) throw new Error(error.message);
  // A setof uuid comes back as bare ids or as one-key rows, by client version.
  const ids = (data ?? []).map((r) => (typeof r === 'string' ? r : Object.values(r)[0]));
  return { unlimited: false, ids };
}

/**
 * What one "+ New" request may ask for (CONTENT-003): the plan's per-request
 * cap and what is left of the month, with the period's end for the message
 * when nothing is. remaining -1 means unlimited.
 */
export async function getOpportunityRequestAllowance(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const quota = await getOpportunityQuotaStatus(orgId);
  const perRequest = plan.limits.maxOpportunitiesPerRequest ?? 5;
  const periodEnd = shiftMonthClamped(await quotaPeriodStart(orgId), 1).toISOString();
  return {
    planId: plan.id,
    perRequest,
    remaining: quota.remaining,
    max: quota.remaining === -1 ? perRequest : Math.min(perRequest, quota.remaining),
    periodEnd,
  };
}

/** Point each claimed slot at the opportunity it was used for. */
export async function linkOpportunitySlots(pairs) {
  for (const { usageId, opportunityId } of pairs) {
    const { error } = await supabaseAdmin
      .from('opportunity_usage')
      .update({ opportunity_id: opportunityId })
      .eq('id', usageId);
    if (error) throw new Error(error.message);
  }
}

/** Hand back slots that were claimed but not used (merged, skipped or failed). */
export async function releaseOpportunitySlots(ids) {
  if (!ids.length) return;
  const { error } = await supabaseAdmin.from('opportunity_usage').delete().in('id', ids);
  if (error) throw new Error(error.message);
}

/**
 * Both monthly content counters with the period they belong to, for the
 * Content page and GET /content/usage (CONTENT-001). Opportunities and briefs
 * are separate pools that renew together with the subscription.
 */
export async function getContentUsage(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const periodStart = await quotaPeriodStart(orgId);
  const [opportunities, briefs] = await Promise.all([
    getOpportunityQuotaStatus(orgId),
    getBriefQuotaStatus(orgId),
  ]);
  return {
    plan: plan.id,
    planName: plan.name,
    periodStart: periodStart.toISOString(),
    periodEnd: shiftMonthClamped(periodStart, 1).toISOString(),
    opportunities: {
      ...opportunities,
      // What one "+ New" request may ask for (CONTENT-003).
      perRequest: plan.limits.maxOpportunitiesPerRequest ?? 5,
    },
    briefs,
  };
}

/** Audits charged this period, and those of them auto-audit runs started. */
async function countSiteAuditUsage(orgId, periodStart) {
  const since = periodStart.toISOString();
  const count = (source) => {
    let query = supabaseAdmin
      .from('site_audit_usage')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('used_at', since);
    if (source) query = query.eq('source', source);
    return query;
  };
  const [all, auto] = await Promise.all([count(null), count('auto')]);
  if (all.error) throw new Error(all.error.message);
  if (auto.error) throw new Error(auto.error.message);
  return { used: all.count || 0, autoUsed: auto.count || 0 };
}

// How long a running audit holds a quota slot (AUDIT_RUN_TIMEOUT_MS): one
// older than that was cut short by a restart and will never complete.
const SITE_AUDIT_IN_FLIGHT_MS = AUDIT_RUN_TIMEOUT_MS;

/**
 * Audits of the org's brands still running (only `source`'s, when given).
 * They're charged when they complete, so each holds a slot until then:
 * otherwise a run started while others are in flight could take the quota
 * past its limit.
 */
async function countRunningSiteAudits(orgId, source) {
  const since = new Date(Date.now() - SITE_AUDIT_IN_FLIGHT_MS).toISOString();
  let query = supabaseAdmin
    .from('site_audits')
    .select('id, brands!inner(organization_id)', { count: 'exact', head: true })
    .eq('status', 'running')
    .eq('brands.organization_id', orgId)
    .gte('created_at', since);
  if (source) query = query.eq('source', source);
  const { count } = await query;
  return count || 0;
}

/**
 * The org's Site Audit settings (SA-006). No row is the defaults: auto-audit
 * as the plan has it (null), no e-mail.
 */
async function readSiteAuditSettings(orgId) {
  const { data, error } = await supabaseAdmin
    .from('site_audit_settings')
    .select('auto_audit, email_after_run')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { autoAudit: data?.auto_audit ?? null, emailAfterRun: data?.email_after_run ?? false };
}

/**
 * Where the org's auto-audit stands this period (SA-006): whether it runs,
 * each run's share, the five runs and which are recorded, the share the runs
 * still to come keep out of the user's pool, and the run whose turn it is.
 */
async function siteAuditAutoStatus(orgId, limit, periodStart, now) {
  const [settings, { data: runRows, error }] = await Promise.all([
    readSiteAuditSettings(orgId),
    supabaseAdmin
      .from('site_audit_auto_runs')
      .select('run_day')
      .eq('organization_id', orgId)
      .eq('period_start', periodStart.toISOString()),
  ]);
  if (error) throw new Error(error.message);

  const enabled = autoAuditEnabled(settings.autoAudit, limit);
  const perRun = perRunSlots(limit);
  const periodEnd = shiftMonthClamped(periodStart, 1);
  const schedule = runSchedule(periodStart, periodEnd);
  const recorded = (runRows ?? []).map((r) => r.run_day);
  const pending = enabled ? pendingRuns(schedule, recorded, now) : [];
  const due = enabled ? dueRun(schedule, now) : null;
  const next = pending[0] ?? null;

  return {
    enabled,
    // The org's own choice; null follows the plan.
    setting: settings.autoAudit,
    emailAfterRun: settings.emailAfterRun,
    perRun,
    // A plan without a monthly limit keeps nothing back.
    reserved: limit === -1 ? 0 : perRun * pending.length,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    runs: schedule.map((run) => ({
      day: run.day,
      at: run.at.toISOString(),
      done: recorded.includes(run.day),
    })),
    nextRun: next
      ? { day: next.day, at: new Date(Math.max(next.at.getTime(), now.getTime())).toISOString() }
      : null,
    // The run to start now: its turn, not recorded yet.
    due: due && !recorded.includes(due.day) ? { day: due.day } : null,
  };
}

/**
 * The org's Site Audit quota this period: completed and running audits
 * against plan.limits.maxSiteAudits (Starter 100, Growth 500,
 * Enterprise/Self-hosted unlimited), and the auto-audit share.
 */
async function siteAuditQuota(orgId, now) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const limit = plan.limits.maxSiteAudits;
  const periodStart = await quotaPeriodStart(orgId, now);
  const [{ used, autoUsed }, running, autoRunning, auto] = await Promise.all([
    limit === -1 ? { used: 0, autoUsed: 0 } : countSiteAuditUsage(orgId, periodStart),
    limit === -1 ? 0 : countRunningSiteAudits(orgId),
    limit === -1 ? 0 : countRunningSiteAudits(orgId, 'auto'),
    siteAuditAutoStatus(orgId, limit, periodStart, now),
  ]);
  // The quota card tells the runs' audits (done and running) from the user's.
  return { plan, limit, used, running, auto: { ...auto, used: autoUsed, running: autoRunning } };
}

/**
 * Enforce the monthly Site Audit quota for an organization before starting
 * `count` audits. Counts completed audits this billing period, plus the ones
 * still running, against plan.limits.maxSiteAudits (Starter 100, Growth 500,
 * Enterprise/Self-hosted unlimited). A user's audits also leave the slots of
 * the auto-audit runs still to come (SA-006); a run's own audits use them.
 * Throws PlanLimitError (429) when the audits don't fit, starting none;
 * returns { plan, remaining } otherwise.
 *
 * @param {string} orgId
 * @param {number} [count]
 * @param {{ source?: 'user'|'auto', now?: Date }} [options]
 */
export async function enforceSiteAuditQuota(
  orgId,
  count = 1,
  { source = 'user', now = new Date() } = {},
) {
  const { plan, limit, used, running, auto } = await siteAuditQuota(orgId, now);
  if (limit === -1) return { plan, remaining: -1 };

  const reserved = source === 'auto' ? 0 : auto.reserved;
  const remaining = limit - used - running - reserved;
  const inFlight = running > 0 ? `, ${running} still running` : '';
  if (remaining <= 0 && reserved > 0) {
    // The spec's empty-pool message: the user's share is used, the runs' isn't.
    throw new PlanLimitError(
      `You've used your ${limit - reserved} Site Audits this month on the ${plan.name} plan${running > 0 ? ` (${running} still running)` : ''}. ${reserved} auto audits are still scheduled. Turn off auto-audit in Site Audit settings to use them now, or upgrade.`,
      429,
    );
  }
  if (remaining <= 0) {
    throw new PlanLimitError(
      `Monthly Site Audit limit reached (${used + running}/${limit}${inFlight}) on the ${plan.name} plan. Resets when your subscription renews — upgrade for more.`,
      429,
    );
  }
  if (count > remaining) {
    const kept = reserved > 0 ? ` (${reserved} more are kept for auto-audits)` : '';
    throw new PlanLimitError(
      `These ${count} audits need more than the ${remaining} left this month on the ${plan.name} plan${kept}. Select up to ${remaining}.`,
      429,
    );
  }

  return { plan, remaining };
}

/**
 * Get current Site Audit quota status without enforcing.
 * Returns { used, running, limit, remaining, auto }: remaining is the user's
 * pool, with running audits and the auto-audit runs still to come taken out;
 * auto is where auto-audit stands (siteAuditAutoStatus, plus what its runs
 * used this period and have running).
 */
export async function getSiteAuditQuotaStatus(orgId, { now = new Date() } = {}) {
  const { limit, used, running, auto } = await siteAuditQuota(orgId, now);
  if (limit === -1) return { used: 0, running: 0, limit: -1, remaining: -1, auto };
  return {
    used,
    running,
    limit,
    remaining: Math.max(0, limit - used - running - auto.reserved),
    auto,
  };
}

/**
 * Verified AI-bot rows an organization may store a month (AT-010, spec
 * §6.3): -1 = no cap, 0 = the bot report is locked (Starter). Throws
 * PlanLimitError (402) without an active subscription, like every billed
 * feature.
 */
export async function getBotEventCap(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  return plan.limits.maxBotEventsPerMonth ?? 0;
}

/**
 * Raw log records a month an organization's Vercel drains and Logpush jobs
 * may send before the server stops reading them (AT-010, spec §6.3).
 */
export async function getBotRawCap(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  return plan.limits.maxBotRawRecordsPerMonth ?? 0;
}

/**
 * Express middleware that attaches req.plan from the authenticated user.
 * Must run after auth middleware (req.user must exist).
 */
export function attachPlan() {
  return async (req, res, next) => {
    try {
      req.plan = await resolveOrgPlan(req.user.id);
      next();
    } catch (err) {
      if (err instanceof PlanLimitError) {
        return res.status(err.statusCode).json({
          success: false,
          error: 'plan_limit',
          message: err.message,
        });
      }
      next(err);
    }
  };
}

/**
 * Express middleware factory — blocks the request if the plan lacks a feature.
 * Usage: router.post('/suggest', requireFeature('prompt_suggestions'), handler)
 */
export function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      await enforceFeature(req.user.id, feature);
      next();
    } catch (err) {
      if (err instanceof PlanLimitError) {
        return res.status(err.statusCode).json({
          success: false,
          error: 'plan_limit',
          message: err.message,
        });
      }
      next(err);
    }
  };
}
