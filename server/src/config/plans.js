/**
 * Plan definitions — must stay in sync with frontend (aeo/src/config/plans.ts).
 * Self-hosted instances bypass all limits (IS_CLOUD !== "true").
 */

export const PLANS = {
  self_hosted: {
    id: 'self_hosted',
    name: 'Self-Hosted',
    limits: {
      maxBrands: -1,
      maxPrompts: -1,
      maxPlatforms: 8,
      maxTeamMembers: -1,
      maxDomainsPerBrand: -1,
      maxVolumeAnalyses: -1,
      maxBriefGenerations: -1,
      improveMonthlyBudgetUsd: -1,
      relevanceMonthlyBudgetUsd: -1,
      maxOpportunitiesPerMonth: -1,
      maxOpportunitiesPerRequest: 5,
      maxSiteAudits: -1,
      maxBotEventsPerMonth: -1,
      maxBotRawRecordsPerMonth: -1,
      maxDailyOnDemand: -1,
      onDemandCooldownMinutes: 0,
      features: [
        'basic_insights',
        'prompt_suggestions',
        'topic_suggestions',
        'prompt_volumes',
        'advanced_analytics',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'ai_agent',
        'shopping_analytics',
        'prompt_improve',
      ],
    },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    limits: {
      maxBrands: 1,
      maxPrompts: 50,
      maxPlatforms: 2,
      maxTeamMembers: -1,
      maxDomainsPerBrand: 3,
      maxVolumeAnalyses: 4,
      maxBriefGenerations: 10,
      // A $1 trial of Improve, not 1% of the $49 price: enough for a few
      // generations a month, so Starter can see what it does (Growth+ was
      // PROMPT-003's call). Shared with the Content Editor's AI later.
      improveMonthlyBudgetUsd: 1,
      // 0.1% of the $49 price, spent rating suggestions' relevance (VIS-011).
      relevanceMonthlyBudgetUsd: 0.049,
      maxOpportunitiesPerMonth: 10,
      maxOpportunitiesPerRequest: 3,
      maxSiteAudits: 100,
      // AI bot report (AT-010, spec §6.3): verified bot rows stored a month.
      // Starter sees the report locked; Growth 2M, Enterprise 20M (adjustable
      // through plan_overrides); -1 = no cap.
      maxBotEventsPerMonth: 0,
      // Raw log records a month a Vercel drain or Logpush job may send
      // (AT-010, spec §6.3): Growth 20M, Enterprise 200M.
      maxBotRawRecordsPerMonth: 0,
      maxDailyOnDemand: 3,
      onDemandCooldownMinutes: 15,
      allowedScrapers: ['chatgpt-web', 'copilot-web'],
      allowedModels: [],
      features: [
        'basic_insights',
        'advanced_analytics',
        'prompt_suggestions',
        'topic_suggestions',
        'prompt_volumes',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'ai_agent',
        'prompt_improve',
      ],
    },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    limits: {
      maxBrands: 4,
      maxPrompts: 200,
      maxPlatforms: 8,
      maxTeamMembers: -1,
      maxDomainsPerBrand: 10,
      maxVolumeAnalyses: 10,
      maxBriefGenerations: 50,
      // 1% of the $249 price, spent on Improve model calls (PROMPT-003).
      improveMonthlyBudgetUsd: 2.49,
      // 0.1% of the $249 price, spent rating suggestions' relevance (VIS-011).
      relevanceMonthlyBudgetUsd: 0.249,
      maxOpportunitiesPerMonth: 50,
      maxOpportunitiesPerRequest: 5,
      maxSiteAudits: 500,
      maxBotEventsPerMonth: 2_000_000,
      maxBotRawRecordsPerMonth: 20_000_000,
      maxDailyOnDemand: 10,
      onDemandCooldownMinutes: 5,
      // API-model tracking (Claude) is not part of Growth — scraper engines
      // only. Enterprise can get it per customer via plan_overrides.
      allowedModels: [],
      features: [
        'basic_insights',
        'prompt_suggestions',
        'topic_suggestions',
        'prompt_volumes',
        'advanced_analytics',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'ai_agent',
        'shopping_analytics',
        'prompt_improve',
      ],
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    limits: {
      maxBrands: -1,
      maxPrompts: -1,
      maxPlatforms: 8,
      maxTeamMembers: -1,
      maxDomainsPerBrand: -1,
      maxVolumeAnalyses: -1,
      // Per-customer: override via organizations.plan_overrides in the DB.
      maxBriefGenerations: -1,
      // 1% of the $499 floor. plan_overrides.contractMonthlyUsd raises it to 1%
      // of the contract; an explicit plan_overrides.improveMonthlyBudgetUsd wins.
      improveMonthlyBudgetUsd: 4.99,
      // 0.1% of the $499 floor, raised to 0.1% of contractMonthlyUsd; an
      // explicit plan_overrides.relevanceMonthlyBudgetUsd wins.
      relevanceMonthlyBudgetUsd: 0.499,
      maxOpportunitiesPerMonth: -1,
      maxOpportunitiesPerRequest: 5,
      maxSiteAudits: -1,
      maxBotEventsPerMonth: 20_000_000,
      maxBotRawRecordsPerMonth: 200_000_000,
      maxDailyOnDemand: -1,
      onDemandCooldownMinutes: 0,
      // API-model tracking (Claude) is a per-customer opt-in on Enterprise:
      // default off; enable via
      // organizations.plan_overrides = { "allowedModels": ["claude-sonnet-5"] }.
      allowedModels: [],
      features: [
        'basic_insights',
        'prompt_suggestions',
        'topic_suggestions',
        'prompt_volumes',
        'advanced_analytics',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'white_label',
        'sso_saml',
        'ai_agent',
        'shopping_analytics',
        'prompt_improve',
      ],
    },
  },
};

export function isCloud() {
  return process.env.IS_CLOUD === 'true';
}

/**
 * Whether an organization's Stripe subscription is in a state that grants
 * access to billed features. `trialing` counts — it's a paid plan in its
 * free-trial period. Everything else (incomplete, canceled, past_due,
 * unpaid) does NOT grant access.
 *
 * Self-hosted instances always return true since billing doesn't apply.
 */
export function isSubscriptionActive(status) {
  if (!isCloud()) return true;
  return status === 'active' || status === 'trialing';
}

export function getPlan(planId) {
  if (!isCloud()) return PLANS.self_hosted;
  return PLANS[planId] || PLANS.starter;
}

export function hasFeature(plan, feature) {
  return plan.limits.features.includes(feature);
}

export function isWithinLimit(plan, key, currentCount) {
  const limit = plan.limits[key];
  if (limit === -1) return true;
  return currentCount < limit;
}
