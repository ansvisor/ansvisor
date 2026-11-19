import { createClient } from '@/lib/supabase/server';
import {
  type Feature,
  type Plan,
  type PlanLimits,
  getPlan,
  hasFeature,
  isCloud,
  isWithinLimit,
} from '@/config/plans';
import { ORG_PLAN_COLUMNS, planFromOrgRow } from './plan-row';

// The row-to-plan reads moved to plan-row.ts, which client components can
// import; kept here for the server callers that already read them from here.
export { ORG_PLAN_COLUMNS, planFromOrgRow, usagePlanFromOrgRow } from './plan-row';

export async function getOrgPlan(organizationId: string): Promise<Plan> {
  if (!isCloud()) return getPlan('self_hosted');

  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', organizationId)
    .single();

  return planFromOrgRow(data);
}

export class PlanLimitError extends Error {
  public readonly requiredPlan: string;
  /**
   * Production masks a server action's thrown message but keeps its digest,
   * so the browser can still say this refusal in the person's language
   * (LOC-008, lib/server-error.ts), as SubscriptionInactiveError's does.
   */
  readonly digest = 'plan_limit';

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
