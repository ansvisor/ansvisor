/**
 * Centralized handler for a Cloro scraper result.
 *
 * Used by both:
 *  - The polling fallback path in tracking-worker.js
 *  - The /cloro/callback webhook endpoint
 *
 * Given a parsed Cloro AI response and the prompt/brand context, this:
 *   1. Counts brand mentions in the response text
 *   2. Runs sentiment analysis (only if brand was mentioned)
 *   3. Computes visibility metrics + competitor mentions via parseResponse
 *   4. Inserts a `prompt_results` row
 *   5. Normalizes any captured shopping_cards into prompt_result_shopping_cards
 */

import supabaseAdmin from '../config/supabase.js';
import { analyzeSentimentAI } from './ai-tracker.js';
import { parseResponse, countBrandMentions } from './response-parser.js';
import { normalizeShoppingCards, matchCardBrand } from './shopping-cards.js';
import { logger } from './logger.js';

/**
 * @param {object} args
 * @param {{ text: string, citations: Array, model: string, shopping_cards: Array }} args.aiResponse
 *   Already parsed via parseScraperResponse (cloro-scraper.js)
 * @param {string} args.scraperId           Cloro scraper id (e.g. 'chatgpt-web')
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

  const metrics = parseResponse(aiResponse, brandInfo, sentimentResult.sentiment, competitors);

  const { data: inserted, error } = await supabaseAdmin
    .from('prompt_results')
    .insert({
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
    })
    .select('id')
    .single();

  if (error) {
    logger.error({ err: error }, '[cloro-result] failed to insert result');
    throw error;
  }

  // Best-effort normalization of any shopping cards on this result.
  // Failures here must not abort the result insert — the raw cards are
  // already persisted on prompt_results.shopping_cards and the backfill
  // script can re-derive the normalized rows later.
  await persistShoppingCards({
    promptResultId: inserted.id,
    brandId,
    platform: scraperId,
    region,
    rawCards: aiResponse.shopping_cards ?? [],
    brandInfo: { brandId, brandName: brandInfo.brandName, domains: brandInfo.domains },
    competitors,
  });

  return { inserted: true };
}

/**
 * Normalize and insert shopping cards into the analytical table.
 *
 * Exported so the backfill script can reuse the exact same code path
 * against historical prompt_results rows without duplicating the parse +
 * brand-match logic.
 *
 * @param {object} args
 * @param {string} args.promptResultId
 * @param {string} args.brandId
 * @param {string} args.platform
 * @param {string|null} args.region
 * @param {unknown[]} args.rawCards
 * @param {{ brandId: string, brandName: string, domains: string[] }} args.brandInfo
 * @param {Array<{ id: string, name: string, domain: string|null }>} args.competitors
 * @returns {Promise<number>} number of rows inserted (0 if none / on failure)
 */
export async function persistShoppingCards({
  promptResultId,
  brandId,
  platform,
  region,
  rawCards,
  brandInfo,
  competitors,
}) {
  const normalized = normalizeShoppingCards(platform, rawCards);
  if (normalized.length === 0) return 0;

  const rows = normalized.map((card) => {
    const match = matchCardBrand(card, brandInfo, competitors);
    return {
      prompt_result_id: promptResultId,
      brand_id: brandId,
      position: card.position,
      product_title: card.product_title,
      product_brand: card.product_brand,
      price_amount: card.price_amount,
      price_currency: card.price_currency,
      image_url: card.image_url,
      merchant_url: card.merchant_url,
      merchant_domain: card.merchant_domain,
      rating: card.rating,
      review_count: card.review_count,
      raw: card.raw,
      matched_brand_id: match.matched_brand_id,
      matched_brand_role: match.matched_brand_role,
      platform,
      region: region ?? null,
    };
  });

  // `onConflict: 'prompt_result_id,position' ignoreDuplicates: true` keeps
  // the call idempotent — re-running the backfill or a retry on the same
  // prompt_result won't duplicate or error.
  const { error } = await supabaseAdmin
    .from('prompt_result_shopping_cards')
    .upsert(rows, { onConflict: 'prompt_result_id,position', ignoreDuplicates: true });

  if (error) {
    logger.error(
      { err: error, promptResultId, platform, cardCount: rows.length },
      '[cloro-result] shopping card normalization failed',
    );
    return 0;
  }

  return rows.length;
}
