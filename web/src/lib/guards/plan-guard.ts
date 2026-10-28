import { createClient } from '@/lib/supabase/server';
import {
  type Feature,
  type Plan,
  type PlanLimits,
  getPlan,
  hasFeature,
  isCloud,
  isSubscriptionActive,
  isWithinLimit,
} from '@/config/plans';

export async function getOrgPlan(organizationId: string): Promise<Plan> {
  if (!isCloud()) return getPlan('self_hosted');

  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('plan, subscription_status, plan_overrides')
    .eq('id', organizationId)
    .single();

  return planFromOrgRow(data);
}

/** The organization columns {@link planFromOrgRow} reads. */
export const ORG_PLAN_COLUMNS = 'plan, subscription_status, plan_overrides';

/**
 * The plan an organization row is entitled to, for callers that read the row
 * themselves (the MCP server has no user session, so it reads with the
 * service role).
 */
export function planFromOrgRow(
  data: { plan?: unknown; subscription_status?: unknown; plan_overrides?: unknown } | null,
): Plan {
  if (!isCloud()) return getPlan('self_hosted');

  // `trialing` is a paid plan in its trial window — treat it as active so
  // trial customers get their actual plan's limits (seats, brands, prompts…)
  // instead of being silently dropped to starter.
  if (!isSubscriptionActive(data?.subscription_status as string | null | undefined)) {
    return getPlan('starter');
  }

  return ownPlan(data);
}

/** The plan the organization's row names, Enterprise's overrides merged. */
function ownPlan(data: { plan?: unknown; plan_overrides?: unknown } | null): Plan {
  const plan = getPlan(data?.plan as string | null | undefined);

  // Enterprise orgs can have custom limit overrides
  if (data?.plan === 'enterprise' && data.plan_overrides) {
    const overrides = data.plan_overrides as Record<string, unknown>;
    return {
      ...plan,
      limits: { ...plan.limits, ...overrides } as typeof plan.limits,
    };
  }

  return plan;
}

/**
 * The plan to show an organization's usage against: while its subscription
 * is active, the one it's entitled to; once it has ended (read-only, the
 * Choose a plan step), the plan it was on, marked ended, not Starter's,
 * which it never chose. What choosing a plan again gives it back.
 */
export function usagePlanFromOrgRow(
  data: { plan?: unknown; subscription_status?: unknown; plan_overrides?: unknown } | null,
): { plan: Plan; ended: boolean } {
  if (isCloud() && !isSubscriptionActive(data?.subscription_status as string | null | undefined)) {
    return { plan: ownPlan(data), ended: true };
  }
  return { plan: planFromOrgRow(data), ended: false };
}

export class PlanLimitError extends Error {
  public readonly requiredPlan: string;

  constructor(message: string, requiredPlan: string) {
    super(message);
    this.name = 'PlanLimitError';
    this.requiredPlan = requiredPlan;
  }
}

export async function enforceFeature(organizationId: string, feature: Feature): Promise<void> {
  const plan = await getOrgPlan(organizationId);
  if (!hasFeature(plan, feature)) {
    throw new PlanLimitError(`This feature requires a higher plan.`, plan.name);
  }
}

export async function enforceLimit(
  organizationId: string,
  key: keyof Omit<PlanLimits, 'features' | 'allowedScrapers' | 'allowedModels'>,
  currentCount: number,
): Promise<void> {
  const plan = await getOrgPlan(organizationId);
  if (!isWithinLimit(plan, key, currentCount)) {
    const limit = plan.limits[key];
    throw new PlanLimitError(
      `Plan limit reached: maximum ${limit} for ${key}. Upgrade to increase.`,
      plan.name,
    );
  }
}
