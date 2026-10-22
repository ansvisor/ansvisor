export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  subscriptionStatus: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionEndsAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Brand {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  logoUrl?: string;
  industry?: string;
  description?: string;
  region?: string;
  /** Optional US state (USPS code) for state-level geo-targeting; US brands only (#554). */
  state?: string;
  language?: string;
  trackingCode?: string;
  shoppingModeEnabled: boolean;
  /** b2b, ecommerce or b2c (Content Editor page types); unset = guessed (siteTypeOf). */
  siteType?: string;
  isActive: boolean;
  domains: BrandDomain[];
  createdAt: string;
  updatedAt: string;
}

export interface BrandDomain {
  id: string;
  brandId: string;
  domain: string;
  country?: string;
  isPrimary: boolean;
}

export interface PromptSet {
  id: string;
  brandId: string;
  name: string;
  prompts: Prompt[];
  createdAt: string;
  updatedAt: string;
}

export interface Prompt {
  id: string;
  promptSetId: string;
  text: string;
  category?: string;
  topicId?: string;
  platforms: AIPlatform[];
  regions: string[];
  models: string[];
  isActive: boolean;
  /** Workflow state (#463 follow-up): null = no status set. */
  workStatus: 'todo' | 'in_progress' | 'done' | null;
  /** Target URLs attached to this prompt (0 when the embed isn't selected). */
  targetUrlCount: number;
  /** Target URLs cited by at least one answer. */
  citedUrlCount: number;
  createdAt: string;
}

export interface Topic {
  id: string;
  brandId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export type AIPlatform =
  | 'chatgpt'
  | 'gemini'
  | 'claude'
  | 'perplexity'
  | 'grok'
  | 'meta-ai'
  | 'copilot'
  | 'google-ai-overviews'
  | 'google-ai-mode'
  | 'chatgpt-web'
  | 'google-aio'
  | 'google-aimode'
  | 'copilot-web'
  | 'grok-web'
  | 'perplexity-web'
  | 'gemini-web';

export type CheckFrequency = 'daily' | 'weekly' | 'monthly';

export interface BrandPlatform {
  id: string;
  brandId: string;
  platform: AIPlatform;
  isEnabled: boolean;
  checkFrequency: CheckFrequency;
  apiModel?: string;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface Citation {
  url: string;
  title: string;
  startIndex: number;
  endIndex: number;
}

export interface ObservedSearchQuery {
  query: string;
  engine?: string | null;
  source_platform?: string | null;
}

export interface PromptResult {
  id: string;
  promptId: string;
  brandId: string;
  platform: AIPlatform;
  response: string;
  citations: Citation[];
  mentionCount: number;
  citationCount: number;
  sentiment: Sentiment;
  visibilityScore: number;
  modelUsed?: string;
  region?: string;
  competitorMentions?: CompetitorMention[];
  searchQueries?: ObservedSearchQuery[];
  createdAt: string;
}

export interface CompetitorMention {
  competitor_id: string;
  name: string;
  domain: string;
  mention_count: number;
  citation_count: number;
  visibility_score: number;
}

export interface Competitor {
  id: string;
  brandId: string;
  name: string;
  domain: string;
}

export interface PromptVolume {
  id: string;
  promptId: string;
  promptText: string;
  promptCategory: string;
  intent: string;
  keywords: string[];
  /** Each keyword's monthly Google volume, under the provider's spelling. */
  googleVolumes: Record<string, number>;
  /**
   * The prompt's monthly Google volume: the median of its keywords that have
   * one (00154). Named before the median replaced their sum.
   */
  totalGoogleVolume: number;
  aiVolumeMultiplier: number;
  /** totalGoogleVolume × aiVolumeMultiplier, rounded. */
  estAiVolume: number;
  competitionIndex: number | null;
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  locationCode?: number;
  languageCode?: string;
  fetchedAt: string;
}

export type ContentOpportunityStatus =
  | 'new'
  | 'reviewed'
  | 'sent'
  | 'in_progress'
  | 'done'
  | 'dismissed'
  | 'archived';

export type ContentOpportunityImpact = 'high' | 'medium' | 'low';

export type ContentOpportunityType = 'owned' | 'earned';

export type ContentOpportunityDecision =
  | 'create'
  | 'optimize'
  | 'expand'
  | 'refresh'
  | 'consolidate'
  | 'defend';

export interface ContentOpportunitySourceData {
  promptText?: string;
  estAiVolume?: number;
  visibilityScore?: number;
  competitorGap?: number;
  intent?: string;
  keywords?: string[];
  competitorsCited?: string[];
  // Cluster opportunities (#857).
  clusterLabel?: string;
  topicName?: string | null;
  relatedTopics?: (string | null)[];
  prompts?: string[];
  topCompetitorVisibility?: number;
  queries?: {
    included: number;
    excluded: number;
    top: { query: string; timesSearched: number }[];
  };
  scoreComponents?: {
    demand: number;
    visibilityGap: number;
    competitorGap: number;
    intent: number;
  };
  windowDays?: number;
  targetPages?: OpportunityPage[];
  assets?: OpportunityAsset[];
  /** Action Center actions sent from this opportunity, by asset key ('all' for the whole). */
  actions?: Record<string, string>;
  /** Actions from before the opportunity was re-opened. */
  pastActions?: string[];
  /**
   * Duplicates folded into this opportunity instead of being created
   * (CONTENT-004): clusters whose prompt and fan-out baskets matched its own.
   */
  duplicatesMerged?: number;
  /** The opportunity this one is another angle on (CONTENT-006). */
  alternativeOf?: { id: string; title: string };
  /** Sent from an Action Center task (AC-004): the action, and what the task says. */
  fromAction?: {
    actionId: string;
    actionNo: number | null;
    taskId: string;
    task?: {
      where?: string;
      why?: string;
      how?: string[];
      doneWhen?: string;
      effort?: string;
      role?: string;
    };
  };
  /** Why it was dismissed, when the user said (CONTENT-006). */
  dismissReason?: 'not_relevant' | 'wrong_angle';
  /** Why a finished opportunity went back to New (#857, Phase 4). */
  reopened?: {
    at: string;
    reason: 'score_rose' | 'gain_lost';
    previousScore: number;
    score: number;
    visibilityAfter: number | null;
    visibility: number;
  };
}

export interface OpportunityPage {
  url: string;
  title: string | null;
  aiCitations: number;
  gaSessions: number;
  lastmod: string | null;
}

/**
 * A page type of the brand's kind of site, an earned asset, or a type from
 * before opportunities followed the site; lib/content/asset-types.ts reads it.
 */
export type OpportunityAssetType = string;

export interface OpportunityAsset {
  key: string;
  type: OpportunityAssetType;
  channel: ContentOpportunityType;
  decision: ContentOpportunityDecision;
  title: string;
  pages: OpportunityPage[];
}

export interface OpportunityBasket {
  clusters: {
    id: string;
    label: string;
    need: string;
    topicName: string | null;
    prompts: { id: string; text: string }[];
  }[];
  queries: { query: string; timesSearched: number; included: boolean; reason: string }[];
}

export interface ContentBrief {
  suggestedTitle: string;
  contentType: string;
  targetWordCount: number;
  outline: { heading: string; keyPoints: string[] }[];
  targetKeywords: string[];
  competitorInsights: string;
  callToAction: string;
}

export type ContentOpportunitySource = 'system' | 'manual' | 'prompt' | 'action';

export interface ContentOpportunity {
  id: string;
  brandId: string;
  promptId?: string;
  clusterId?: string | null;
  decision?: ContentOpportunityDecision | null;
  title: string;
  description?: string;
  type: ContentOpportunityType;
  impact: ContentOpportunityImpact;
  opportunityScore: number;
  status: ContentOpportunityStatus;
  /** Where it came from: the nightly run, "+ New", or a prompt (CONTENT-003). */
  source?: ContentOpportunitySource;
  sourceData: ContentOpportunitySourceData;
  brief?: ContentBrief;
  webhookSentAt?: string;
  webhookResponse?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookConfig {
  id: string;
  brandId: string;
  name: string;
  webhookUrl: string;
  webhookSecret?: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'admin' | 'manager' | 'analyst' | 'agency_partner';

export interface UserProfile {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
  role: UserRole;
  organizationId?: string;
}

export const INDUSTRIES = [
  'Technology',
  'E-commerce & Retail',
  'Finance & Banking',
  'Healthcare',
  'Travel & Hospitality',
  'Media & Entertainment',
  'Education',
  'Food & Beverage',
  'Automotive',
  'Fashion & Apparel',
  'Real Estate',
  'Consumer Goods',
  'B2B Software (SaaS)',
  'Telecommunications',
  'Other',
] as const;

export type Industry = (typeof INDUSTRIES)[number];
