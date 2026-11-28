import { type Plan, getPlan, isCloud, isSubscriptionActive } from '@/config/plans';
import { includedSlots, slotPlatform } from '@/config/tracking-slots';

/**
 * Reading an organization row's plan, with no database client: plan-guard.ts
 * imports the server's Supabase client (next/headers), so client components
 * that need a row's plan (Settings › Roles & access through lib/chat) read it
 * from here.
 */

/**
 * The organization columns {@link planFromOrgRow} reads. add_on_prompts and
 * add_on_brands (00546) are what the plan's subscription adds: Growth's
 * extra tracking tier and extra brands; add_on_slots (00564) the tracking
 * slots it bought per platform.
 */
export const ORG_PLAN_COLUMNS =
  'plan, subscription_status, plan_overrides, add_on_prompts, add_on_brands, add_on_slots';

/** An organization row as {@link ORG_PLAN_COLUMNS} reads it. */
export interface OrgPlanRow {
  plan?: unknown;
  subscription_status?: unknown;
  plan_overrides?: unknown;
  add_on_prompts?: unknown;
  add_on_brands?: unknown;
  add_on_slots?: unknown;
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

/** The plans whose workspaces buy extra brands themselves: Growth and Enterprise (00566). */
const BRAND_ADD_ON_PLANS = new Set(['growth', 'enterprise']);

/** A count the row holds: a whole number above 0, else 0. */
const addOnCount = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;

/**
 * The plan with what its subscription adds (00546): Growth's extra tracking
 * on top of its prompt locations, its extra brands on top of its brands
 * (Enterprise's too, 00566). A
 * limit that is already unlimited stays so; other plans never add any. Then
 * its tracking slots per platform (withSlots).
 */
function withAddOns(plan: Plan, data: OrgPlanRow | null): Plan {
  let next = plan;
  const prompts = ADD_ON_PLANS.has(plan.id) ? addOnCount(data?.add_on_prompts) : 0;
  const brands = BRAND_ADD_ON_PLANS.has(plan.id) ? addOnCount(data?.add_on_brands) : 0;
  if (prompts || brands) {
    const add = (base: number, extra: number) => (base === -1 ? -1 : base + extra);
    next = {
      ...plan,
      limits: {
        ...plan.limits,
        maxPrompts: add(plan.limits.maxPrompts, prompts),
        maxBrands: add(plan.limits.maxBrands, brands),
      },
    };
  }
  return SLOT_PLANS.has(plan.id) ? withSlots(next, data?.add_on_slots) : next;
}

/** The plans whose workspaces buy tracking slots themselves (00564). */
const SLOT_PLANS = new Set(['growth', 'enterprise']);

/** Whether a plan sells tracking slots (00564): Growth and Enterprise. */
export function sellsSlots(planId: string): boolean {
  return SLOT_PLANS.has(planId);
}

/** The extra slots a row holds per platform: whole numbers above 0, platforms slots are sold for. */
export function boughtSlots(value: unknown): Record<string, number> {
  const bought: Record<string, number> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bought;
  for (const [id, slots] of Object.entries(value as Record<string, unknown>)) {
    if (slotPlatform(id) && addOnCount(slots)) bought[id] = slots as number;
  }
  return bought;
}

/**
 * The plan with its tracking slots per platform (00564): its own prompt
 * locations on each of its platforms, plus the slots bought for each. Its
 * prompt locations become the largest platform's slots, and each platform
 * then waits on its own (prompt-slots.ts). A plan with no limit has no slots.
 */
export function withSlots(plan: Plan, addOnSlots: unknown): Plan {
  if (plan.limits.maxPrompts < 0) return plan;
  const slots = includedSlots(plan.limits);
  for (const [id, extra] of Object.entries(boughtSlots(addOnSlots))) {
    slots[id] = (slots[id] ?? 0) + extra;
  }
  return {
    ...plan,
    slots,
    limits: {
      ...plan.limits,
      maxPrompts: Math.max(plan.limits.maxPrompts, ...Object.values(slots)),
    },
  };
}

/**
 * The platforms a prompt may be set to run on: on a plan with tracking slots,
 * each platform with slots (and ChatGPT Shopping, which runs beside ChatGPT);
 * otherwise the plan's `allowedScrapers`, or null for every one.
 */
export function promptPlatformsAllowed(plan: Plan): ReadonlySet<string> | null {
  if (plan.slots) {
    return new Set([
      ...Object.entries(plan.slots)
        .filter(([, slots]) => slots !== 0)
        .map(([id]) => id),
      'chatgpt-shopping',
    ]);
  }
  return plan.limits.allowedScrapers ? new Set(plan.limits.allowedScrapers) : null;
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
