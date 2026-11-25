/**
 * Prompt suggestions from the brand's own data and an AI model (Prompts page
 * › Suggestions): what one refresh reads, asks for and stores. Moved out of
 * routes/prompts.js so the nightly run can refresh them too.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { getLanguageName } from './languages.js';
import { reserveRelevanceAllowance, settleRelevanceUsage } from './plan-guard.js';
import { withRetry } from './retry.js';
import { getGscSuggestionCandidates } from './gsc-suggestions.js';
import { getGaSuggestionCandidates } from './ga-suggestions.js';
import {
  getCatalogProductCandidates,
  getCatalogSuggestionCandidates,
} from './catalog-suggestions.js';
import { RELEVANCE_SCALE, ratingCostUsd, toRelevance } from './suggestion-relevance.js';
import { yearRule } from './current-year.js';
import { isLiveBusinessHubRow } from './business-hub/topic-prompts.js';

export async function loadSuggestionContext(brandId) {
  const [
    { data: brand },
    { data: existingPrompts },
    { data: existingTopics },
    { data: recentResults },
  ] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('name, description, language, region')
      .eq('id', brandId)
      .single(),
    supabaseAdmin
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id), prompt_volumes(est_ai_volume, intent)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .limit(80),
    supabaseAdmin
      .from('topics')
      .select('name')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .limit(40),
    supabaseAdmin
      .from('prompt_results')
      .select('competitor_mentions')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const competitorCount = new Map();
  for (const row of recentResults || []) {
    const mentions = row.competitor_mentions;
    if (!mentions) continue;
    if (Array.isArray(mentions)) {
      for (const m of mentions) {
        const name = typeof m === 'string' ? m : m?.name;
        if (name) competitorCount.set(name, (competitorCount.get(name) || 0) + 1);
      }
    } else if (typeof mentions === 'object') {
      for (const [name, val] of Object.entries(mentions)) {
        const n = typeof val === 'number' ? val : 1;
        competitorCount.set(name, (competitorCount.get(name) || 0) + n);
      }
    }
  }
  const topCompetitors = [...competitorCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => name);

  const promptVolumeSamples = [];
  let volumeSum = 0;
  let volumeCount = 0;
  let highVolumeMax = 0;
  for (const p of existingPrompts || []) {
    const pv = p.prompt_volumes;
    const vol = Array.isArray(pv) ? pv[0]?.est_ai_volume : pv?.est_ai_volume;
    const intent = Array.isArray(pv) ? pv[0]?.intent : pv?.intent;
    if (typeof vol === 'number' && vol > 0) {
      volumeSum += vol;
      volumeCount += 1;
      if (vol > highVolumeMax) highVolumeMax = vol;
      promptVolumeSamples.push({ text: p.text, volume: vol, intent });
    }
  }
  const avgVolume = volumeCount > 0 ? Math.round(volumeSum / volumeCount) : 0;
  promptVolumeSamples.sort((a, b) => b.volume - a.volume);
  const topByVolume = promptVolumeSamples.slice(0, 6);
  const bottomByVolume = promptVolumeSamples.slice(-4).reverse();

  return {
    brand: brand || {},
    existingPromptTexts: (existingPrompts || []).map((p) => p.text),
    existingTopicNames: (existingTopics || []).map((t) => t.name),
    topCompetitors,
    volume: {
      avg: avgVolume,
      max: highVolumeMax,
      coveredCount: volumeCount,
      totalPrompts: (existingPrompts || []).length,
      topByVolume,
      bottomByVolume,
    },
  };
}

/** Prompts read to keep a suggestion from repeating one the brand has. */
const BRAND_PROMPTS_READ = 1000;

/** A prompt's text as two are compared: case, spacing and an ending "?" aside. */
const promptKey = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s?.!]+$/, '')
    .trim();

/**
 * The texts of the brand's prompts, paused ones too (up to
 * BRAND_PROMPTS_READ): a suggestion repeating one is left out, and a catalog
 * product one of them names isn't asked about. [] when they can't be read.
 */
export async function brandPromptTexts(brandId, log) {
  const { data, error } = await supabaseAdmin
    .from('prompts')
    .select('text, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .limit(BRAND_PROMPTS_READ);
  if (error) {
    log.warn({ err: error }, 'prompt-suggestions refresh: tracked prompts not read');
    return [];
  }
  return (data ?? []).map((row) => row.text).filter((text) => typeof text === 'string');
}

/**
 * Suggestions generated per refresh. The schema floor sits well below it: a
 * model that returns a few short of the target should still produce a list,
 * not fail the whole refresh on validation.
 */
const SUGGESTIONS_PER_REFRESH = 25;
const MIN_SUGGESTIONS = 15;
// Floors for suggestions drawn from the brand's own data, when it has any —
// about two in five from Search Console and one in four from Analytics, and
// a few shopping questions from its catalog (ECOM-003).
const MIN_FROM_SEARCH_CONSOLE = 10;
const MIN_FROM_ANALYTICS = 6;
const MIN_FROM_CATALOG = 5;
// And a few buyer questions about its top products (AC plan P-8).
const MIN_FROM_PRODUCTS = 3;

const newSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        text: z
          .string()
          .min(20)
          .max(120)
          .describe('A short, generic search query without any brand names'),
        topic: z
          .string()
          .min(3)
          .max(60)
          .describe(
            'A 2-4 word topic label that groups this prompt (e.g. "EV Range", "Reliability", "Pricing")',
          ),
        reason: z
          .string()
          .min(20)
          .max(220)
          .describe(
            'One sentence explaining why this prompt matters for the brand (gap, trend, competitor coverage)',
          ),
        // No .max() ceiling: the prompt tells the model to calibrate volumes
        // against the brand's real tracked volumes, so on high-volume brands
        // it legitimately estimates six figures — a hard schema cap then
        // rejects the WHOLE batch deterministically ("No object generated"),
        // and retrying can't help. Out-of-range protection is a clamp at the
        // insert site instead.
        estVolume: z.number().int().min(0).describe('Estimated monthly AI search volume (rough)'),
        sourceQuery: z
          .string()
          .max(200)
          .optional()
          .describe(
            'ONLY when this suggestion was derived from one of the provided Search Console queries: the EXACT original query string, verbatim. Omit for all other suggestions.',
          ),
        sourcePage: z
          .string()
          .max(500)
          .optional()
          .describe(
            'ONLY when this suggestion was derived from one of the provided Analytics pages: the EXACT landing page path, verbatim. Omit for all other suggestions.',
          ),
        sourceCategory: z
          .string()
          .max(750)
          .optional()
          .describe(
            'ONLY when this suggestion was derived from one of the provided catalog categories: the EXACT category name, verbatim. Omit for all other suggestions.',
          ),
        sourceProduct: z
          .string()
          .max(1000)
          .optional()
          .describe(
            'ONLY when this suggestion was derived from one of the provided top products: the EXACT product title, verbatim. Omit for all other suggestions.',
          ),
      }),
    )
    .min(MIN_SUGGESTIONS)
    .max(SUGGESTIONS_PER_REFRESH),
});

// Relevance (VIS-011), asked for while the org's monthly allowance covers it.
// No bounds, for the same reason as estVolume: toRelevance clamps at the insert.
const ratedSuggestionSchema = z.object({
  suggestions: z
    .array(
      newSuggestionSchema.shape.suggestions.element.extend({
        relevance: z
          .number()
          .describe(
            `How closely this prompt fits what the brand offers and who it serves, 0-${RELEVANCE_SCALE}`,
          ),
      }),
    )
    .min(MIN_SUGGESTIONS)
    .max(SUGGESTIONS_PER_REFRESH),
});

const SUGGESTION_TTL_HOURS = 48;

/** Model calls one refresh may make (withRetry's attempts). */
const REFRESH_ATTEMPTS = 3;

/**
 * Reserves rating for this refresh (VIS-011): its worst case, every retry,
 * against the org's monthly allowance. Null when that doesn't fit or the
 * allowance can't be read: the refresh then leaves relevance out rather than
 * risk the budget.
 */
async function reserveRating(orgId, brandId, modelId, log) {
  try {
    const reservation = await reserveRelevanceAllowance(orgId, {
      brandId,
      modelId,
      costUsd: ratingCostUsd(modelId, {
        suggestions: SUGGESTIONS_PER_REFRESH,
        attempts: REFRESH_ATTEMPTS,
      }),
    });
    return reservation.unlimited || reservation.id ? reservation : null;
  } catch (err) {
    log.error({ err }, 'suggestion relevance allowance error');
    return null;
  }
}

/**
 * Lowers the reservation to what rating added to the attempts made, failed
 * ones included. A failure is logged, not thrown: the suggestions the user
 * asked for still go out, and the worst case stays charged.
 */
async function settleRating(log, reservation, { modelId, attempts, usage }) {
  if (!reservation.id) return;
  try {
    await settleRelevanceUsage(reservation.id, {
      attempts,
      usage,
      costUsd: ratingCostUsd(modelId, { suggestions: SUGGESTIONS_PER_REFRESH, attempts }),
    });
  } catch (err) {
    log.error({ err }, 'suggestion relevance usage settle error');
  }
}

async function generateSuggestions(brandId, { orgId, log }) {
  const ctx = await loadSuggestionContext(brandId);
  const langName = getLanguageName(ctx.brand.language);

  // Real Search Console demand (#648) — [] for brands without GSC, which
  // keeps every prompt block below byte-identical to the pre-GSC behavior.
  const gscCandidates = await getGscSuggestionCandidates(
    brandId,
    ctx.brand,
    ctx.existingPromptTexts,
  );

  // The brand's own analytics (#705) — [] without a mapped GA4 property or
  // synced traffic, which keeps every prompt block below unchanged for
  // brands that have neither.
  const gaCandidates = await getGaSuggestionCandidates(brandId, ctx.existingPromptTexts);

  // What the brand sells (ECOM-003): its catalog's categories and price bands
  // — [] without a catalog, which keeps every prompt block below unchanged.
  // Its top products (AC plan P-8) ride in the same call: best-selling or
  // most shown on AI shopping cards, none a prompt of the brand already names.
  const trackedTexts = await brandPromptTexts(brandId, log);
  const [catalogCandidates, productCandidates] = await Promise.all([
    getCatalogSuggestionCandidates(brandId),
    getCatalogProductCandidates(brandId, { trackedTexts }),
  ]);

  const promptModel = process.env.PROMPT_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';
  const aiModel = resolveModel(promptModel);
  const reservation = await reserveRating(orgId, brandId, promptModel, log);
  const rate = reservation !== null;

  const system = `You are an AEO (Answer Engine Optimization) strategist. You suggest NEW search prompts a brand should track in AI engines (ChatGPT, Perplexity, Gemini, Claude).

RULES:
- Suggest ${SUGGESTIONS_PER_REFRESH} prompts that are NOT already tracked by this brand.
${yearRule()}
- Every suggestion must be distinct: no two may be rephrasings of the same question.
- Each prompt: 30-100 chars, generic, no brand names, written in ${langName}.
- Group each prompt under a short topic label (2-4 words). Reuse existing topic labels when they fit; otherwise create a clean new one.
- Pick prompts where the brand could realistically appear AND where its competitors are already getting cited.
- Volume bias: prioritize prompt ideas that resemble (in topic and intent) the HIGH-volume prompts already tracked. Avoid suggesting prompts close in topic to LOW-volume ones unless there is a strong competitor gap.
- estVolume must be a realistic monthly AI search volume; calibrate it against the volume samples shown — do not output flat round numbers like 1000 for everything.
- Reasons must be concrete: cite the gap, the trend, or the competitor activity. Avoid generic platitudes.${
    rate
      ? `
- relevance: a whole number 0-${RELEVANCE_SCALE}. ${RELEVANCE_SCALE} = the brand's core offering, 6 = adjacent but a realistic fit, below 6 = off its business. Be strict.`
      : ''
  }
- Diversity: mix comparison, how-to, best-of, recommendation, and problem-solving intents.${
    gscCandidates.length
      ? `
- REAL SEARCH DEMAND: a list of actual Google Search Console queries for this brand is provided — proven demand the brand does not track yet. Derive at least ${Math.min(MIN_FROM_SEARCH_CONSOLE, gscCandidates.length)} suggestions from those queries: rephrase each raw query as a natural question a user would ask an AI assistant, preserving its intent exactly (never invent a different topic). For each such suggestion set sourceQuery to the EXACT original query string, verbatim. Never set sourceQuery on suggestions that did not come from that list.`
      : ''
  }${
    gaCandidates.length
      ? `
- THE BRAND'S OWN ANALYTICS: a list of pages from this brand's Google Analytics is provided, each with what the page itself says it is about. Derive at least ${Math.min(MIN_FROM_ANALYTICS, gaCandidates.length)} suggestions from those pages. Write the prompt at the level of the need the page serves, NOT the page's product name or URL — a model number nobody types into an AI assistant becomes the category question that leads to it ("best noise-cancelling headphones", not "ANS-2400 Pro Black"). For each such suggestion set sourcePage to the EXACT landing page path, verbatim. Never set sourcePage on suggestions that did not come from that list, and never set both sourceQuery and sourcePage on the same suggestion.`
      : ''
  }${
    catalogCandidates.length
      ? `
- WHAT THE BRAND SELLS: a list of its product catalog's categories is provided, each with how many products it sells and their price band. Derive at least ${Math.min(MIN_FROM_CATALOG, catalogCandidates.length)} shopping suggestions from those categories: the questions a shopper asks an AI assistant before buying in the category — best-of, under a budget (use the category's price band and currency, written as a shopper writes it), for a use or a person, or which type to choose. Use the category's own words, not the brand's or a product's name. For each such suggestion set sourceCategory to the EXACT category name, verbatim. Never set sourceCategory on suggestions that did not come from that list, and never set it together with sourceQuery or sourcePage.`
      : ''
  }${
    productCandidates.length
      ? `
- THE BRAND'S TOP PRODUCTS: a list of its best-selling products, or those AI shopping answers show most, is provided, each with its type and category. Derive at least ${Math.min(MIN_FROM_PRODUCTS, productCandidates.length)} buyer suggestions from those products: what a shopper asks an AI assistant before buying a product like it — the best product of its type for a use or a person ("best {product type} for {use}"), or, when shoppers know it by its model name, how it compares with a named rival ("{product} vs {rival product}"). Never use the brand's own name. For each such suggestion set sourceProduct to the EXACT product title as listed, verbatim. Never set sourceProduct on suggestions that did not come from that list, and never set it together with sourceQuery, sourcePage or sourceCategory.`
      : ''
  }`;

  const v = ctx.volume;
  const volumeBlock =
    v && v.coveredCount > 0
      ? `Volume signal (from prompt_volumes for tracked prompts):
- Coverage: ${v.coveredCount}/${v.totalPrompts} tracked prompts have estimated AI volume
- Average AI volume: ~${v.avg.toLocaleString('en-US')}/mo
- Highest tracked: ~${v.max.toLocaleString('en-US')}/mo
- Top-volume tracked prompts (for topic/intent inspiration, do NOT duplicate):
${v.topByVolume.map((p) => `  • [~${p.volume.toLocaleString('en-US')}/mo${p.intent ? `, ${p.intent}` : ''}] ${p.text}`).join('\n')}
- Lowest-volume tracked prompts (avoid suggesting similar ones):
${v.bottomByVolume.map((p) => `  • [~${p.volume.toLocaleString('en-US')}/mo${p.intent ? `, ${p.intent}` : ''}] ${p.text}`).join('\n')}`
      : 'Volume signal: no AI volume data analyzed yet for tracked prompts.';

  const userPrompt = `Brand: ${ctx.brand.name}
Description: ${ctx.brand.description || '(none)'}

Existing tracked prompts (DO NOT duplicate these):
${ctx.existingPromptTexts.length ? ctx.existingPromptTexts.map((p, i) => `${i + 1}. ${p}`).join('\n') : '(none yet)'}

Existing topics for this brand (prefer reusing):
${ctx.existingTopicNames.length ? ctx.existingTopicNames.join(', ') : '(none)'}

Top competitors currently cited in this brand's tracked AI responses:
${ctx.topCompetitors.length ? ctx.topCompetitors.join(', ') : '(no data yet)'}

${volumeBlock}${
    gscCandidates.length
      ? `

Real Google Search Console queries for this brand (last 28 days, NOT tracked yet — proven demand):
${gscCandidates
  .map(
    (c) =>
      `  • "${c.query}" — ${c.impressions.toLocaleString('en-US')} impressions, ${c.clicks.toLocaleString('en-US')} clicks${c.avgPosition != null ? `, avg position ${c.avgPosition}` : ''}`,
  )
  .join('\n')}`
      : ''
  }${
    gaCandidates.length
      ? `

Pages from this brand's own Google Analytics (last 28 days, none covered by a tracked prompt):
${gaCandidates
  .map((c) => {
    const evidence =
      c.kind === 'revenue_blind_spot'
        ? `#${c.rank} by ${c.revenue > 0 ? 'revenue' : 'conversions'} (${c.revenue > 0 ? `${c.revenue.toLocaleString('en-US')} revenue, ` : ''}${c.transactions || c.keyEvents} conversions, ${c.sessions.toLocaleString('en-US')} sessions)`
        : `${c.aiSessions.toLocaleString('en-US')} AI-referred sessions${c.aiPlatforms.length ? ` from ${c.aiPlatforms.join(', ')}` : ''}`;
    return `  • ${c.landingPage} — ${evidence}\n    the page says: ${c.pageText.slice(0, 300)}`;
  })
  .join('\n')}`
      : ''
  }

${
  catalogCandidates.length
    ? `

The brand's product catalog categories (live products, price band):
${catalogCandidates
  .map(
    (c) =>
      `  • "${c.category}" — ${c.products.toLocaleString('en-US')} products${c.currency ? `, ${c.priceLow}–${c.priceHigh} ${c.currency} (most under ${c.priceUnder} ${c.currency})` : ''}`,
  )
  .join('\n')}`
    : ''
}${
    productCandidates.length
      ? `

The brand's top products (in stock; best-selling or most shown on AI shopping cards, last 30 days), by category:
${productCandidates
  .slice()
  .sort((a, b) => (a.category ?? '~').localeCompare(b.category ?? '~'))
  .map((p) => {
    const evidence = [
      p.cardPrompts > 0 ? `shown on shopping cards for ${p.cardPrompts} tracked prompts` : null,
      p.orders > 0 ? `${p.orders.toLocaleString('en-US')} orders` : null,
      p.aiVisits > 0 ? `${p.aiVisits.toLocaleString('en-US')} AI visits` : null,
    ].filter(Boolean);
    return `  • "${p.product}"${p.category ? ` — in "${p.category}"` : ''}${p.productType ? `, type: ${p.productType}` : ''}${evidence.length ? `; ${evidence.join(', ')}` : ''}`;
  })
  .join('\n')}`
      : ''
  }

Suggest the next ${SUGGESTIONS_PER_REFRESH} prompts this brand should start tracking, with topic, reason and a calibrated monthly AI search volume (estVolume).`;

  // #379 pattern — bounded retry: generateObject throws "No object generated:
  // response did not match schema" when the model misses a constraint (short
  // reason, <6 items, non-integer estVolume, …); a fresh sample usually
  // passes, so one miss must not fail the whole refresh.
  let attempts = 0;
  let usage;
  try {
    const { object, usage: callUsage } = await withRetry(
      () => {
        attempts += 1;
        return generateObject({
          model: aiModel,
          schema: rate ? ratedSuggestionSchema : newSuggestionSchema,
          system,
          prompt: userPrompt,
        });
      },
      { attempts: REFRESH_ATTEMPTS, baseDelayMs: 500, label: 'suggestion-refresh' },
    );
    usage = callUsage;
    return {
      suggestions: object.suggestions,
      gscCandidates,
      gaCandidates,
      catalogCandidates,
      productCandidates,
      trackedTexts,
    };
  } finally {
    if (rate) await settleRating(log, reservation, { modelId: promptModel, attempts, usage });
  }
}

async function findOrCreateTopic(brandId, topicName) {
  if (!topicName) return null;
  const { data: existing } = await supabaseAdmin
    .from('topics')
    .select('id')
    .eq('brand_id', brandId)
    .ilike('name', topicName)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created, error } = await supabaseAdmin
    .from('topics')
    .insert({ brand_id: brandId, name: topicName, is_active: true })
    .select('id')
    .single();
  if (error) return null;
  return created?.id ?? null;
}

/**
 * Puts a refreshed batch in place of the brand's undecided suggestions
 * (status 'new'), in the batch's order. The new rows go in first and the old
 * ones are removed only then: a failed insert (a database without 00362
 * turning down source 'catalog', say) leaves the list as it was rather than
 * empty. A text the old batch already has is refreshed in its row, since a
 * brand keeps one undecided suggestion per text
 * (idx_prompt_suggestions_brand_text_active).
 *
 * Suggestions from ChatGPT Business Hub's topics (00527) stay their 30 days:
 * a refresh never removes or rewrites one, a refreshed text one of them has
 * is left out, and they are listed after the batch. One past its 30 days
 * goes with the old batch.
 */
async function replaceNewSuggestions(brandId, generated, log) {
  const { data: current, error: currentError } = await supabaseAdmin
    .from('prompt_suggestions')
    .select('*')
    .eq('brand_id', brandId)
    .eq('status', 'new');
  if (currentError) throw currentError;
  const textKey = (text) => text.toLowerCase();
  const now = Date.now();
  const kept = (current ?? []).filter((row) => isLiveBusinessHubRow(row, now));
  const keptTexts = new Set(kept.map((row) => textKey(row.suggested_text)));
  const replaceable = (current ?? []).filter((row) => !isLiveBusinessHubRow(row, now));
  const rows = generated.filter((row) => !keptTexts.has(textKey(row.suggested_text)));
  const currentByText = new Map(replaceable.map((row) => [textKey(row.suggested_text), row]));

  const fresh = rows.filter((row) => !currentByText.has(textKey(row.suggested_text)));
  let inserted = [];
  if (fresh.length) {
    const { data, error } = await supabaseAdmin.from('prompt_suggestions').insert(fresh).select();
    if (error) throw error;
    inserted = data ?? [];
  }
  const byText = new Map(inserted.map((row) => [textKey(row.suggested_text), row]));

  // A repeated text takes the new reason, volume and expiry; its old row
  // stays as it was if that update fails, and is left out once decided.
  const generatedAt = new Date().toISOString();
  for (const row of rows) {
    const old = currentByText.get(textKey(row.suggested_text));
    if (!old || byText.has(textKey(row.suggested_text))) continue;
    const { data, error } = await supabaseAdmin
      .from('prompt_suggestions')
      .update({ ...row, generated_at: generatedAt })
      .eq('id', old.id)
      .eq('status', 'new')
      .select()
      .maybeSingle();
    if (error) log.warn({ err: error, id: old.id }, 'prompt-suggestions refresh: kept an old row');
    const refreshed = error ? old : data;
    if (refreshed) byText.set(textKey(row.suggested_text), refreshed);
  }

  // Only then the rest of the old batch goes; one decided meanwhile stays.
  const refreshed = new Set([...byText.values()].map((row) => row.id));
  const stale = replaceable.filter((row) => !refreshed.has(row.id)).map((row) => row.id);
  if (stale.length) {
    const { error } = await supabaseAdmin
      .from('prompt_suggestions')
      .delete()
      .in('id', stale)
      .eq('status', 'new');
    if (error) log.warn({ err: error }, 'prompt-suggestions refresh: old batch not removed');
  }

  return [
    ...new Set(rows.map((row) => byText.get(textKey(row.suggested_text))).filter(Boolean)),
    ...kept,
  ];
}

/**
 * Generates a fresh batch of prompt suggestions for the brand and puts it in
 * place of its undecided ones (replaceNewSuggestions). Shared by the Prompts
 * page's Refresh (routes/prompts.js) and the nightly run when every need has
 * an opportunity (auto-prompt-suggestions.js).
 *
 * @param {string} brandId
 * @param {{ orgId: string, log: import('pino').Logger }} opts
 * @returns {Promise<object[]>} the brand's undecided suggestions now
 */
export async function refreshBrandSuggestions(brandId, { orgId, log }) {
  const {
    suggestions,
    gscCandidates,
    gaCandidates,
    catalogCandidates,
    productCandidates,
    trackedTexts,
  } = await generateSuggestions(brandId, {
    orgId,
    log,
  });

  const expiresAt = new Date(Date.now() + SUGGESTION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  // Provenance: a suggestion is 'gsc' only when its sourceQuery matches a
  // provided candidate — a hallucinated sourceQuery degrades to a plain
  // 'llm' row instead of carrying fabricated metrics. Matching is
  // case/whitespace-normalized so a cosmetic LLM rewrite doesn't silently
  // drop real provenance.
  const normalizeQuery = (q) => q.trim().toLowerCase();
  const candidateByQuery = new Map(gscCandidates.map((c) => [normalizeQuery(c.query), c]));
  const candidateByPage = new Map(gaCandidates.map((c) => [normalizeQuery(c.landingPage), c]));
  const candidateByCategory = new Map(
    catalogCandidates.map((c) => [normalizeQuery(c.category), c]),
  );
  const candidateByProduct = new Map(productCandidates.map((c) => [normalizeQuery(c.product), c]));
  // A suggestion repeating a prompt the brand has is no suggestion.
  const tracked = new Set(trackedTexts.map(promptKey));

  const rows = [];
  for (const s of suggestions) {
    if (tracked.has(promptKey(s.text))) continue;
    const topicId = await findOrCreateTopic(brandId, s.topic);
    const candidate = s.sourceQuery
      ? candidateByQuery.get(normalizeQuery(s.sourceQuery))
      : undefined;
    // Search Console wins a tie: it is proven demand for a phrasing, while
    // the page is an inference about what would lead there. A suggestion
    // claiming both is claiming something the generators never offered.
    const gaCandidate =
      !candidate && s.sourcePage ? candidateByPage.get(normalizeQuery(s.sourcePage)) : undefined;
    // The catalog only when neither Google source claims it: both are
    // measured demand, the catalog is what the brand sells. A product
    // before its category: it says more of what the prompt is about.
    const productCandidate =
      !candidate && !gaCandidate && s.sourceProduct
        ? candidateByProduct.get(normalizeQuery(s.sourceProduct))
        : undefined;
    const catalogCandidate =
      !candidate && !gaCandidate && !productCandidate && s.sourceCategory
        ? candidateByCategory.get(normalizeQuery(s.sourceCategory))
        : undefined;
    rows.push({
      brand_id: brandId,
      suggested_text: s.text,
      topic_name: s.topic,
      topic_id: topicId,
      reason: s.reason,
      // Sanity clamp replacing the removed schema ceiling — one absurd
      // estimate must cap out, not reject the whole generated batch.
      est_volume: Math.min(s.estVolume, 10_000_000),
      relevance: toRelevance(s.relevance),
      source: candidate
        ? 'gsc'
        : gaCandidate
          ? 'ga'
          : catalogCandidate || productCandidate
            ? 'catalog'
            : 'llm',
      source_data: candidate
        ? {
            query: candidate.query,
            impressions: candidate.impressions,
            clicks: candidate.clicks,
            avgPosition: candidate.avgPosition,
            badge: candidate.badge,
            competitionIndex: candidate.competitionIndex ?? null,
          }
        : gaCandidate
          ? {
              landingPage: gaCandidate.landingPage,
              kind: gaCandidate.kind,
              rank: gaCandidate.rank,
              sessions: gaCandidate.sessions,
              keyEvents: gaCandidate.keyEvents,
              transactions: gaCandidate.transactions,
              revenue: gaCandidate.revenue,
              aiSessions: gaCandidate.aiSessions,
              aiPlatforms: gaCandidate.aiPlatforms,
              pageTitle: gaCandidate.page?.title ?? null,
            }
          : productCandidate
            ? {
                product: productCandidate.product,
                productId: productCandidate.productId,
                productType: productCandidate.productType,
                category: productCandidate.category,
                categoryId: productCandidate.categoryId,
                cardPrompts: productCandidate.cardPrompts,
                orders: productCandidate.orders,
              }
            : catalogCandidate
              ? {
                  category: catalogCandidate.category,
                  categoryId: catalogCandidate.categoryId ?? null,
                  products: catalogCandidate.products,
                  priceLow: catalogCandidate.priceLow,
                  priceHigh: catalogCandidate.priceHigh,
                  priceUnder: catalogCandidate.priceUnder,
                  currency: catalogCandidate.currency,
                }
              : null,
      status: 'new',
      expires_at: expiresAt,
    });
  }

  return replaceNewSuggestions(brandId, rows, log);
}
