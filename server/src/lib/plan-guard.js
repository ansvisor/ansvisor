import supabaseAdmin from '../config/supabase.js';
import {
  getPlan,
  hasFeature,
  isWithinLimit,
  isCloud,
  isSubscriptionActive,
} from '../config/plans.js';

export class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'PlanLimitError';
    this.statusCode = statusCode;
  }
}

/**
 * Resolve the user's organization plan from the database.
 * Self-hosted → returns self_hosted plan (unlimited).
 */
async function resolveOrgPlan(userId) {
  if (!isCloud()) return getPlan('self_hosted');

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (!profile?.organization_id) {
    throw new PlanLimitError('No organization found for user.', 400);
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan, subscription_status')
    .eq('id', profile.organization_id)
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

  return getPlan(org.plan);
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

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { count } = await supabaseAdmin
    .from('volume_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id)
    .gte('used_at', startOfMonth.toISOString());

  const used = count || 0;
  if (used >= maxAnalyses) {
    throw new PlanLimitError(
      `Monthly volume analysis limit reached (${used}/${maxAnalyses}). Resets on the 1st of next month.`,
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

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { count } = await supabaseAdmin
    .from('volume_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id)
    .gte('used_at', startOfMonth.toISOString());

  const used = count || 0;
  return { used, limit: maxAnalyses, remaining: maxAnalyses - used };
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
