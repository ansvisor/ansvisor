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
  medianCost,
  typicalCostUsd,
} from './improve-cost.js';
import { RELEVANCE_BUDGET_SHARE } from './suggestion-relevance.js';

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
 * is signed. It sets the Improve budget to the same 1% share of the contract
 * the other plans get of their price (never below the plan default), unless
 * `improveMonthlyBudgetUsd` is set explicitly, which wins. The relevance
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

function startOfCurrentMonth() {
  const start = new Date();
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
  if (!isCloud() || !orgId) return startOfCurrentMonth();

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('subscription_ends_at, subscription_status')
    .eq('id', orgId)
    .maybeSingle();

  const endsAt = org?.subscription_ends_at ? new Date(org.subscription_ends_at) : null;
  if (!endsAt || Number.isNaN(endsAt.getTime()) || !isSubscriptionActive(org.subscription_status)) {
    return startOfCurrentMonth();
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
  return { spent, typical: medianCost(costs.slice(0, 20)) };
}

/**
 * Improve-tab budget (PROMPT-003): a monthly USD budget per organization,
 * 1% of the plan price (plan.limits.improveMonthlyBudgetUsd), charged with
 * each generation's real token cost so the share holds for any model. Users
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

/** Throws PlanLimitError (429) once the period's Improve budget is spent. */
export async function enforceImproveQuota(orgId, modelId) {
  const quota = await getImproveQuotaStatus(orgId, modelId);
  if (!quota.unlimited && quota.remainingUsd <= 0) {
    throw new PlanLimitError(
      `This month's suggestion budget on the ${quota.planName} plan is used up. It resets when your subscription renews.`,
      429,
    );
  }
  return quota;
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

async function countSiteAuditUsageThisMonth(orgId) {
  const periodStart = await quotaPeriodStart(orgId);
  const { count } = await supabaseAdmin
    .from('site_audit_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('used_at', periodStart.toISOString());
  return count || 0;
}

/**
 * Enforce the monthly Site Audit quota for an organization. Counts completed
 * audits this calendar month against plan.limits.maxSiteAudits (Starter 100,
 * Growth 500, Enterprise/Self-hosted unlimited). Throws PlanLimitError (429)
 * when exhausted; returns { plan, remaining } otherwise.
 */
export async function enforceSiteAuditQuota(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const max = plan.limits.maxSiteAudits;
  if (max === -1) return { plan, remaining: -1 };

  const used = await countSiteAuditUsageThisMonth(orgId);
  if (used >= max) {
    throw new PlanLimitError(
      `Monthly Site Audit limit reached (${used}/${max}) on the ${plan.name} plan. Resets when your subscription renews — upgrade for more.`,
      429,
    );
  }

  return { plan, remaining: max - used };
}

/**
 * Get current Site Audit quota status without enforcing.
 * Returns { used, limit, remaining }.
 */
export async function getSiteAuditQuotaStatus(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const max = plan.limits.maxSiteAudits;
  if (max === -1) return { used: 0, limit: -1, remaining: -1 };

  const used = await countSiteAuditUsageThisMonth(orgId);
  return { used, limit: max, remaining: Math.max(0, max - used) };
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
