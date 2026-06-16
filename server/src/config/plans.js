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
      maxSiteAudits: -1,
      maxDailyOnDemand: -1,
      onDemandCooldownMinutes: 0,
      features: [
        'basic_insights',
        'prompt_suggestions',
        'prompt_volumes',
        'advanced_analytics',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'ai_agent',
        'shopping_analytics',
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
      maxTeamMembers: 1,
      maxDomainsPerBrand: 3,
      maxVolumeAnalyses: 4,
      maxBriefGenerations: 10,
      maxSiteAudits: 100,
      maxDailyOnDemand: 3,
      onDemandCooldownMinutes: 15,
      allowedScrapers: ['chatgpt-web', 'perplexity-web'],
      allowedModels: [],
      features: [
        'basic_insights',
        'advanced_analytics',
        'prompt_suggestions',
        'prompt_volumes',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'ai_agent',
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
      maxTeamMembers: 3,
      maxDomainsPerBrand: 10,
      maxVolumeAnalyses: 10,
      maxBriefGenerations: 50,
      maxSiteAudits: 500,
      maxDailyOnDemand: 10,
      onDemandCooldownMinutes: 5,
      features: [
        'basic_insights',
        'prompt_suggestions',
        'prompt_volumes',
        'advanced_analytics',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'ai_agent',
        'shopping_analytics',
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
      maxSiteAudits: -1,
      maxDailyOnDemand: -1,
      onDemandCooldownMinutes: 0,
      features: [
        'basic_insights',
        'prompt_suggestions',
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
