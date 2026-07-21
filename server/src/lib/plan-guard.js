import supabaseAdmin from '../config/supabase.js';
import {
  getPlan,
  hasFeature,
  isWithinLimit,
  isCloud,
  isSubscriptionActive,
} from '../config/plans.js';
import { anchoredPeriodStart } from './quota-period.js';

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
 */
export function applyPlanOverrides(plan, org) {
  if (org?.plan === 'enterprise' && org.plan_overrides && typeof org.plan_overrides === 'object') {
    return { ...plan, limits: { ...plan.limits, ...org.plan_overrides } };
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
