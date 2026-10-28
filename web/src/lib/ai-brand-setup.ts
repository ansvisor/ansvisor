/**
 * Client-side helpers for the three AI calls that are shared between the
 * onboarding wizard and the "add a brand" page.
 *
 * Each function owns session lookup, Authorization header construction, and
 * the POST itself. On success it returns typed data; on failure it throws so
 * the caller can decide what to show the user.
 *
 * These are plain async functions, not server actions — they run in the browser
 * and reach the API via the proxy at BROWSER_API_BASE_URL.
 */

import { createClient } from '@/lib/supabase/client';
import { BROWSER_API_BASE_URL } from '@/config/api';

const API_BASE = BROWSER_API_BASE_URL;

async function getAuthHeader(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return `Bearer ${session?.access_token}`;
}

// ── Shared request body shape ──────────────────────────────────────────────────

export interface BrandSetupParams {
  brandName: string;
  description: string;
  website: string;
  language: string;
}

/**
 * The longest the API takes each field (server/src/lib/brand-setup-input.js).
 * What's sent is cut to them, so a long description kept on the brand never
 * fails a suggestion. A topic is held to `topic` where it's typed: its name
 * comes back with its prompts, so it isn't cut here.
 */
export const BRAND_SETUP_LIMITS = { name: 200, website: 200, description: 2000, topic: 100 };

/** At most `max` UTF-16 units, as the API's limits count them, never half of an emoji's pair. */
function cut(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value.length <= max) return value;
  const end = /[\uD800-\uDBFF]/.test(value[max - 1]) ? max - 1 : max;
  return value.slice(0, end);
}

// ── Topic suggestions ──────────────────────────────────────────────────────────

export interface SuggestTopicsResult {
  /** Flat list of topic name strings returned by the server. */
  topics: string[];
}

/**
 * POST /api/topics/suggest
 *
 * Returns the list of suggested topic names.
 * Throws if the request fails.
 */
export async function suggestTopics(params: BrandSetupParams): Promise<SuggestTopicsResult> {
  const authorization = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api/topics/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      brandName: cut(params.brandName, BRAND_SETUP_LIMITS.name),
      industry: '',
      description: cut(params.description, BRAND_SETUP_LIMITS.description),
      website: cut(params.website, BRAND_SETUP_LIMITS.website),
      language: params.language,
    }),
  });

  if (!res.ok) throw new Error('Failed to suggest topics');
  const data = await res.json();
  const topics = (data.topics || []).map((t: { name: string }) => t.name);
  return { topics };
}

// ── Prompt generation from topics ─────────────────────────────────────────────

export interface TopicPromptGroup {
  topic: string;
  prompts: string[];
}

export interface GeneratePromptsResult {
  topicPrompts: TopicPromptGroup[];
}

/**
 * POST /api/prompts/from-topics
 *
 * Returns per-topic prompt groups.
 * Throws if the request fails.
 */
export async function generatePromptsFromTopics(
  params: BrandSetupParams,
  topics: string[],
): Promise<GeneratePromptsResult> {
  const authorization = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api/prompts/from-topics`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      brandName: cut(params.brandName, BRAND_SETUP_LIMITS.name),
      industry: '',
      description: cut(params.description, BRAND_SETUP_LIMITS.description),
      topics,
      language: params.language,
    }),
  });

  if (!res.ok) throw new Error('Failed to generate prompts');
  const data = await res.json();
  const topicPrompts = (data.topicPrompts || []).map(
    (tp: { topic: string; prompts: string[] }) => ({
      topic: tp.topic,
      prompts: tp.prompts,
    }),
  );
  return { topicPrompts };
}

// ── Competitor suggestions ─────────────────────────────────────────────────────

export interface SuggestedCompetitor {
  name: string;
  domain: string;
}

export interface SuggestCompetitorsResult {
  competitors: SuggestedCompetitor[];
  /** Whether the research found the brand sells products online (an online store). */
  isEcommerce: boolean;
}

/**
 * POST /api/competitors/suggest
 *
 * Returns the list of suggested competitors (name + domain), and whether the
 * brand itself sells products online. Throws if the request fails.
 */
export async function suggestCompetitors(
  params: BrandSetupParams & { region?: string },
): Promise<SuggestCompetitorsResult> {
  const authorization = await getAuthHeader();
  const res = await fetch(`${API_BASE}/api/competitors/suggest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization,
    },
    body: JSON.stringify({
      brandName: cut(params.brandName, BRAND_SETUP_LIMITS.name),
      industry: '',
      description: cut(params.description, BRAND_SETUP_LIMITS.description),
      // The site tells the model which company the name means, the region
      // which market its competitors should come from.
      website: cut(params.website, BRAND_SETUP_LIMITS.website),
      region: params.region,
      language: params.language,
    }),
  });

  if (!res.ok) throw new Error('Failed to suggest competitors');
  const data = await res.json();
  const competitors = (data.competitors || []).map((c: { name: string; domain: string }) => ({
    name: c.name,
    domain: c.domain,
  }));
  return { competitors, isEcommerce: data.isEcommerce === true };
}
