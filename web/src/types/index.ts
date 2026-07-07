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
  language?: string;
  trackingCode?: string;
  shoppingModeEnabled: boolean;
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
  googleVolumes: Record<string, number>;
  totalGoogleVolume: number;
  aiVolumeMultiplier: number;
  estAiVolume: number;
  competitionIndex: number | null;
  competition: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  locationCode?: number;
  languageCode?: string;
  fetchedAt: string;
}

export type ContentOpportunityStatus = 'new' | 'sent' | 'in_progress' | 'done' | 'dismissed';

export type ContentOpportunityImpact = 'high' | 'medium' | 'low';

export type ContentOpportunityType = 'owned' | 'earned';

export interface ContentOpportunitySourceData {
  promptText?: string;
  estAiVolume?: number;
  visibilityScore?: number;
  competitorGap?: number;
  intent?: string;
  keywords?: string[];
  competitorsCited?: string[];
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

export interface ContentOpportunity {
  id: string;
  brandId: string;
  promptId?: string;
  title: string;
  description?: string;
  type: ContentOpportunityType;
  impact: ContentOpportunityImpact;
  opportunityScore: number;
  status: ContentOpportunityStatus;
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
