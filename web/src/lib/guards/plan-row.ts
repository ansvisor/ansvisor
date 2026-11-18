import { type Plan, getPlan, isCloud, isSubscriptionActive } from '@/config/plans';

/**
 * Reading an organization row's plan, with no database client: plan-guard.ts
 * imports the server's Supabase client (next/headers), so client components
 * that need a row's plan (Settings › Roles & access through lib/chat) read it
 * from here.
 */

/**
 * The organization columns {@link planFromOrgRow} reads. add_on_prompts and
 * add_on_brands (00546) are what the plan's subscription adds: Growth's
 * extra tracking tier and extra brands.
 */
export const ORG_PLAN_COLUMNS =
  'plan, subscription_status, plan_overrides, add_on_prompts, add_on_brands';

/** An organization row as {@link ORG_PLAN_COLUMNS} reads it. */
export interface OrgPlanRow {
  plan?: unknown;
  subscription_status?: unknown;
  plan_overrides?: unknown;
  add_on_prompts?: unknown;
  add_on_brands?: unknown;
}

/**
 * The plan an organization row is entitled to, for callers that read the row
 * themselves (the MCP server has no user session, so it reads with the
 * service role).
 */
export function planFromOrgRow(data: OrgPlanRow | null): Plan {
  if (!isCloud()) return getPlan('self_hosted');

  // `trialing` is a paid plan in its trial window — treat it as active so
  // trial customers get their actual plan's limits (seats, brands, prompts…)
  // instead of being silently dropped to starter.
  if (!isSubscriptionActive(data?.subscription_status as string | null | undefined)) {
    return getPlan('starter');
  }

  return withAddOns(ownPlan(data), data);
}

/** The plans whose subscription can carry extra tracking and brands. */
const ADD_ON_PLANS = new Set(['growth']);

/** A count the row holds: a whole number above 0, else 0. */
const addOnCount = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;

/**
 * The plan with what its subscription adds (00546): Growth's extra tracking
 * on top of its prompt locations, its extra brands on top of its brands. A
 * limit that is already unlimited stays so; other plans never add any.
 */
function withAddOns(plan: Plan, data: OrgPlanRow | null): Plan {
  if (!ADD_ON_PLANS.has(plan.id)) return plan;
  const prompts = addOnCount(data?.add_on_prompts);
  const brands = addOnCount(data?.add_on_brands);
  if (!prompts && !brands) return plan;
  const add = (base: number, extra: number) => (base === -1 ? -1 : base + extra);
  return {
    ...plan,
    limits: {
      ...plan.limits,
      maxPrompts: add(plan.limits.maxPrompts, prompts),
      maxBrands: add(plan.limits.maxBrands, brands),
    },
  };
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
 * which it never chose, without the add-ons that ended with it. What
 * choosing a plan again gives it back.
 */
export function usagePlanFromOrgRow(data: OrgPlanRow | null): { plan: Plan; ended: boolean } {
  if (isCloud() && !isSubscriptionActive(data?.subscription_status as string | null | undefined)) {
    return { plan: ownPlan(data), ended: true };
  }
  return { plan: planFromOrgRow(data), ended: false };
}
