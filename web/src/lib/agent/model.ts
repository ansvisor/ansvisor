import { createAnthropic } from '@ai-sdk/anthropic';

/**
 * Single source of truth for the in-product agent's LLM. Reuses the same
 * provider + model the brief-generation flow on aeo-server uses
 * (claude-sonnet-4-6) so behavior + cost shape stay consistent across the
 * product. Self-hosters supply ANTHROPIC_API_KEY in their own env.
 */
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const AGENT_MODEL = anthropic('claude-sonnet-4-6');
