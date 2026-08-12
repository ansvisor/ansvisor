/**
 * Provider-agnostic brand sentiment analysis.
 *
 * Replaces the OpenAI-only implementation in openai-tracker.js, which called
 * `openai.responses.create()` directly and therefore made OPENAI_API_KEY
 * mandatory for every self-hosted install — even one tracking Claude only, or
 * reading every engine through Cloro. Sentiment runs on both paths (the API
 * tracking worker and the Cloro result handler), so that single hard-coded
 * client was the last thing forcing an OpenAI account.
 *
 * Routing now goes through resolveModel(), so SENTIMENT_MODEL accepts any
 * configured provider: "anthropic/claude-haiku-4-5", "google/gemini-3-flash",
 * "openrouter/…". Default is unchanged from the previous behaviour.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './ai-provider.js';
import { logger } from './logger.js';

/** Preserves the pre-existing default so upgrades are a no-op. */
const DEFAULT_SENTIMENT_MODEL = 'openai/gpt-5-mini';

/** Longest response slice sent for analysis — unchanged from the original. */
const MAX_RESPONSE_CHARS = 3000;

export const sentimentSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const SENTIMENT_SYSTEM_PROMPT =
  'You are a brand sentiment analyzer. Given an AI-generated response and a brand name, determine the sentiment toward that brand. Base the verdict only on how the response portrays that specific brand, not on its overall tone.';

/**
 * Analyze sentiment of an AI response toward a specific brand.
 *
 * Never throws: a failure here must not lose an otherwise valid tracking
 * result, so it degrades to neutral exactly as the previous implementation did.
 *
 * @param {string} responseText - The AI-generated response text
 * @param {string} brandName - The brand name to analyze sentiment for
 * @returns {Promise<{ sentiment: 'positive'|'neutral'|'negative', confidence: number, reason: string }>}
 */
export async function analyzeSentimentAI(responseText, brandName) {
  try {
    const model = resolveModel(process.env.SENTIMENT_MODEL || DEFAULT_SENTIMENT_MODEL);

    const { object } = await generateObject({
      model,
      schema: sentimentSchema,
      system: SENTIMENT_SYSTEM_PROMPT,
      prompt: `Brand: "${brandName}"\n\nAI Response:\n${responseText.slice(0, MAX_RESPONSE_CHARS)}`,
    });

    return object;
  } catch (err) {
    logger.error({ err }, '[sentiment-ai] failed, falling back to neutral');
    return { sentiment: 'neutral', confidence: 0, reason: 'Analysis failed' };
  }
}
