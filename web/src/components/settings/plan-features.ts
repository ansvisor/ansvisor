'use client';

import { useTranslations } from 'next-intl';
import { PLANS, type PlanId } from '@/config/plans';

export interface PlanFeature {
  text: string;
  /** A longer word on it, shown on hover. */
  hint?: string;
}

/** A plan's monthly AI allowance as a multiple of Starter's; null when either has none. */
export function aiUsageMultiple(planId: PlanId): number | null {
  const starterAi = PLANS.starter.limits.improveMonthlyBudgetUsd;
  const planAi = PLANS[planId].limits.improveMonthlyBudgetUsd;
  return starterAi > 0 && planAi > 0 ? Math.round(planAi / starterAi) : null;
}

/**
 * A plan card's list, as the pricing page puts it: brands, seats, prompts,
 * the answer engines it tracks, content briefs and site audits a month,
 * AI usage as a multiple of Starter's, then what the plan adds. Billing's
 * cards and the plan dialog show the same list.
 */
export function usePlanFeatures(): (planId: PlanId) => PlanFeature[] {
  const tCards = useTranslations('settings.planCards');
  return (planId) => {
    const { limits } = PLANS[planId];
    const aiUsage = aiUsageMultiple(planId);
    const items = [
      limits.maxBrands === -1
        ? tCards('unlimitedBrands')
        : tCards('brands', { count: limits.maxBrands }),
      limits.maxTeamMembers === -1
        ? tCards('unlimitedSeats')
        : tCards('seats', { count: limits.maxTeamMembers }),
      tCards('prompts', { count: limits.maxPrompts }),
      tCards(`${planId}.engines`),
      tCards('briefs', { count: limits.maxBriefGenerations }),
      tCards('audits', { count: limits.maxSiteAudits }),
    ].map((text) => ({ text }));
    return [
      ...items,
      ...(aiUsage
        ? [{ text: tCards('aiUsage', { count: aiUsage }), hint: tCards('aiUsageHint') }]
        : []),
      ...(tCards.raw(`${planId}.extras`) as string[]).map((text) => ({ text })),
    ];
  };
}
