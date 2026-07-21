export const FEATURES = [
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
  'white_label',
  'sso_saml',
  // In-product AI agent — chat panel that calls the MCP read tools to
  // answer questions about the brand's AI search performance. Gated on
  // cloud by plan; self-host gets it unconditionally because the
  // underlying tool calls run against the user's own infrastructure.
  'ai_agent',
  // Shopping analytics — the Shopping dashboard page (cards from
  // Perplexity / AI Mode / Copilot, your products vs competitors,
  // merchant breakdown). Free / Starter get the headline KPI only;
  // Growth+ and self-host get the full set of tabs.
  'shopping_analytics',
] as const;

export type Feature = (typeof FEATURES)[number];

export type PlanId = 'self_hosted' | 'starter' | 'growth' | 'enterprise';

export interface PlanLimits {
  maxBrands: number;
  maxPrompts: number;
  maxPlatforms: number;
  maxTeamMembers: number;
  maxDomainsPerBrand: number;
  maxVolumeAnalyses: number;
  /**
   * Monthly content brief generations (AI brief per opportunity).
   * -1 = unlimited. Enterprise is -1 by default and set per customer via
   * organizations.plan_overrides.maxBriefGenerations in the DB.
   */
  maxBriefGenerations: number;
  /**
   * Monthly Site Audit runs. -1 = unlimited (self-hosted / enterprise).
   * Starter 100, Growth 500.
   */
  maxSiteAudits: number;
  maxDailyOnDemand: number;
  onDemandCooldownMinutes: number;
  features: readonly Feature[];
  /** If set, only these scraper IDs are available. Undefined = all. */
  allowedScrapers?: readonly string[];
  /** If set, only these model IDs are available. Undefined = all, [] = none. */
  allowedModels?: readonly string[];
}

export interface PlanPricing {
  monthly: number;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  pricing: PlanPricing | null;
  limits: PlanLimits;
  highlighted?: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  self_hosted: {
    id: 'self_hosted',
    name: 'Self-Hosted',
    tagline: 'Full control on your own infrastructure',
    pricing: null,
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
      ],
      // Self-host runs against the operator's own infrastructure / API
      // keys — no platform quota to enforce.
    },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'Track your brand across AI platforms',
    pricing: { monthly: 49 },
    limits: {
      maxBrands: 1,
      maxPrompts: 50,
      maxPlatforms: 2,
      maxTeamMembers: -1,
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
        'topic_suggestions',
        'prompt_volumes',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        // Cloud is BYOK across the board: the customer pastes their own
        // Anthropic key in Settings → Agent and we just use it. Plan no
        // longer gates the feature — only "did you paste a key?" does.
        // Self-host gets the feature unconditionally via env.
        'ai_agent',
      ],
    },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    tagline: 'For brands that need deep insights',
    pricing: { monthly: 249 },
    highlighted: true,
    limits: {
      maxBrands: 4,
      maxPrompts: 200,
      maxPlatforms: 8,
      maxTeamMembers: -1,
      maxDomainsPerBrand: 10,
      maxVolumeAnalyses: 10,
      maxBriefGenerations: 50,
      maxSiteAudits: 500,
      maxDailyOnDemand: 10,
      onDemandCooldownMinutes: 5,
      // API-model tracking (Claude) is not part of Growth — scraper engines
      // only. Enterprise can get it per customer via plan_overrides below.
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
      ],
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For agencies and large teams at scale',
    pricing: null,
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
      // API-model tracking (Claude) is a per-customer opt-in on Enterprise:
      // default off; enable by setting
      // organizations.plan_overrides = { "allowedModels": ["claude-sonnet-5"] }.
      // getOrgPlan / the server's applyPlanOverrides merge that over these
      // limits, so no code change is needed to switch a customer on.
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
      ],
      // Enterprise — no platform quota; usage governed by contract.
    },
  },
} as const;

export const PLAN_ORDER: PlanId[] = ['starter', 'growth', 'enterprise'];

export const SUBSCRIBABLE_PLANS: PlanId[] = ['starter', 'growth'];

/**
 * Self-hosted instances bypass all limits.
 * Cloud is determined by NEXT_PUBLIC_IS_CLOUD env var.
 */
export function isCloud(): boolean {
  return process.env.NEXT_PUBLIC_IS_CLOUD === 'true';
}

export function getPlan(planId: string | null | undefined): Plan {
  if (!isCloud()) return PLANS.self_hosted;
  return PLANS[(planId as PlanId) ?? 'starter'] ?? PLANS.starter;
}

/**
 * Whether a Stripe subscription_status entitles the org to its paid plan.
 * `trialing` counts — it's a paid plan inside its free-trial window — so it must
 * NOT be downgraded to starter limits. Mirrors the server's isSubscriptionActive
 * (server/src/config/plans.js); keep the two in sync.
 */
export function isSubscriptionActive(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing';
}

export function hasFeature(plan: Plan, feature: Feature): boolean {
  return plan.limits.features.includes(feature);
}

export function isWithinLimit(
  plan: Plan,
  key: keyof Omit<PlanLimits, 'features' | 'allowedScrapers' | 'allowedModels'>,
  currentCount: number,
): boolean {
  const limit = plan.limits[key];
  if (limit === -1) return true;
  return currentCount < limit;
}

export function getMinimumPlanForFeature(feature: Feature): PlanId {
  for (const id of PLAN_ORDER) {
    if (PLANS[id].limits.features.includes(feature)) return id;
  }
  return 'enterprise';
}
