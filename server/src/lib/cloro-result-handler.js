/**
 * Centralized handler for a Cloro scraper result.
 */

import supabaseAdmin from '../config/supabase.js';
import { analyzeSentimentAI } from './ai-tracker.js';
import { parseResponse, countBrandMentions } from './response-parser.js';

/**
 * @param {object} args
 * @param {{ text: string, citations: Array, model: string, shopping_cards: Array, inline_products: Array }} args.aiResponse
 * @param {string} args.scraperId
 * @param {string} args.promptId
 * @param {string} args.brandId
 * @param {string|null} args.region
 * @param {{ brandName: string, domains: string[] }} args.brandInfo
 * @param {Array<{ id: string, name: string, domain: string }>} args.competitors
 * @returns {Promise<{ inserted: boolean }>}
 */
export async function handleScraperResult({
  aiResponse,
  scraperId,
  promptId,
  brandId,
  region,
  brandInfo,
  competitors,
}) {
  const mentionCount = countBrandMentions(aiResponse.text, brandInfo);
  const sentimentResult =
    mentionCount > 0
      ? await analyzeSentimentAI(aiResponse.text, brandInfo.brandName)
      : { sentiment: 'neutral', confidence: 0, reason: 'Brand not mentioned' };

  const metrics = parseResponse(
    aiResponse,
    brandInfo,
    sentimentResult.sentiment,
    competitors,
  );

  const { error } = await supabaseAdmin.from('prompt_results').insert({
    prompt_id: promptId,
    brand_id: brandId,
    platform: scraperId,
    response: aiResponse.text,
    citations: aiResponse.citations,
    mention_count: metrics.mentionCount,
    citation_count: metrics.citationCount,
    sentiment: sentimentResult.sentiment,
    visibility_score: metrics.visibilityScore,
    model_used: aiResponse.model,
    region: region ?? null,
    competitor_mentions: metrics.competitorMentions,
    shopping_cards: aiResponse.shopping_cards ?? [],
    inline_products: aiResponse.inline_products ?? [],
  });

  if (error) {
    console.error('[cloro-result] Failed to insert result:', error.message);
    throw error;
  }

  return { inserted: true };
}
