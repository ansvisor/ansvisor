import { Router } from 'express';
import { generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from '../lib/ai-provider.js';
import { classifyPromptIntent } from '../lib/intent-extraction.js';
import { getLanguageName } from '../lib/languages.js';
import { requireFeature } from '../lib/plan-guard.js';
import { withRetry } from '../lib/retry.js';

const router = Router();

async function assertBrandAccess(brandId, userId) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name, description, organization_id, language')
    .eq('id', brandId)
    .single();
  if (!brand) {
    const err = new Error('Brand not found');
    err.status = 404;
    throw err;
  }
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .single();
  if (!profile || profile.organization_id !== brand.organization_id) {
    const err = new Error('Unauthorized');
    err.status = 403;
    throw err;
  }
  return { brand, profile };
}

async function loadSuggestionContext(brandId) {
  const [
    { data: brand },
    { data: existingPrompts },
    { data: existingTopics },
    { data: recentResults },
  ] = await Promise.all([
    supabaseAdmin.from('brands').select('name, description, language').eq('id', brandId).single(),
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
        estVolume: z
          .number()
          .int()
          .min(0)
          .max(100000)
          .describe('Estimated monthly AI search volume (rough)'),
      }),
    )
    .min(6)
    .max(12),
});

const SUGGESTION_TTL_HOURS = 48;

async function generateSuggestions(brandId) {
  const ctx = await loadSuggestionContext(brandId);
  const langName = getLanguageName(ctx.brand.language);
  const currentYear = new Date().getFullYear();

  const system = `You are an AEO (Answer Engine Optimization) strategist. You suggest NEW search prompts a brand should track in AI engines (ChatGPT, Perplexity, Gemini, Claude). Current year: ${currentYear}.

RULES:
- Suggest 8 prompts that are NOT already tracked by this brand.
- Each prompt: 30-100 chars, generic, no brand names, written in ${langName}.
- Group each prompt under a short topic label (2-4 words). Reuse existing topic labels when they fit; otherwise create a clean new one.
- Pick prompts where the brand could realistically appear AND where its competitors are already getting cited.
- Volume bias: prioritize prompt ideas that resemble (in topic and intent) the HIGH-volume prompts already tracked. Avoid suggesting prompts close in topic to LOW-volume ones unless there is a strong competitor gap.
- estVolume must be a realistic monthly AI search volume; calibrate it against the volume samples shown — do not output flat round numbers like 1000 for everything.
- Reasons must be concrete: cite the gap, the trend, or the competitor activity. Avoid generic platitudes.
- Diversity: mix comparison, how-to, best-of, recommendation, and problem-solving intents.`;

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

${volumeBlock}

Suggest the next 8 prompts this brand should start tracking, with topic, reason and a calibrated monthly AI search volume (estVolume).`;

  const promptModel = process.env.PROMPT_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';
  const aiModel = resolveModel(promptModel);

  const { object } = await generateObject({
    model: aiModel,
    schema: newSuggestionSchema,
    system,
    prompt: userPrompt,
  });

  return object.suggestions;
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

router.post(
  '/suggestions/:brandId/refresh',
  requireFeature('prompt_suggestions'),
  async (req, res) => {
    try {
      await assertBrandAccess(req.params.brandId, req.user.id);
      const suggestions = await generateSuggestions(req.params.brandId);

      await supabaseAdmin
        .from('prompt_suggestions')
        .delete()
        .eq('brand_id', req.params.brandId)
        .eq('status', 'new');

      const expiresAt = new Date(Date.now() + SUGGESTION_TTL_HOURS * 60 * 60 * 1000).toISOString();

      const rows = [];
      for (const s of suggestions) {
        const topicId = await findOrCreateTopic(req.params.brandId, s.topic);
        rows.push({
          brand_id: req.params.brandId,
          suggested_text: s.text,
          topic_name: s.topic,
          topic_id: topicId,
          reason: s.reason,
          est_volume: s.estVolume,
          source: 'llm',
          status: 'new',
          expires_at: expiresAt,
        });
      }

      const { data: inserted, error } = await supabaseAdmin
        .from('prompt_suggestions')
        .insert(rows)
        .select();
      if (error) throw error;

      return res.json({ suggestions: inserted });
    } catch (error) {
      const status = error.status || 500;
      req.log.error({ err: error }, 'prompt-suggestions refresh error');
      return res.status(status).json({ error: error.message || 'Failed to generate suggestions' });
    }
  },
);

router.get('/suggestions/:brandId', async (req, res) => {
  try {
    await assertBrandAccess(req.params.brandId, req.user.id);
    const { data, error } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('*')
      .eq('brand_id', req.params.brandId)
      .eq('status', 'new')
      .order('generated_at', { ascending: false });
    if (error) throw error;

    const stale = (data || []).every((r) => new Date(r.expires_at).getTime() < Date.now());
    return res.json({
      suggestions: data || [],
      stale: data?.length === 0 || stale,
    });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'prompt-suggestions list error');
    return res.status(status).json({ error: error.message || 'Failed to load suggestions' });
  }
});

router.post('/suggestions/:id/dismiss', async (req, res) => {
  try {
    const { data: suggestion } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('brand_id')
      .eq('id', req.params.id)
      .single();
    if (!suggestion) return res.status(404).json({ error: 'Not found' });
    await assertBrandAccess(suggestion.brand_id, req.user.id);

    const { error } = await supabaseAdmin
      .from('prompt_suggestions')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'prompt-suggestions dismiss error');
    return res.status(status).json({ error: error.message || 'Failed to dismiss' });
  }
});

router.post('/suggestions/:id/accept', async (req, res) => {
  try {
    const { promptId } = req.body || {};
    if (!promptId) {
      return res.status(400).json({ error: 'promptId is required' });
    }
    const { data: suggestion } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('brand_id')
      .eq('id', req.params.id)
      .single();
    if (!suggestion) return res.status(404).json({ error: 'Not found' });
    await assertBrandAccess(suggestion.brand_id, req.user.id);

    const { error } = await supabaseAdmin
      .from('prompt_suggestions')
      .update({
        status: 'added',
        added_prompt_id: promptId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'prompt-suggestions accept error');
    return res.status(status).json({ error: error.message || 'Failed to accept' });
  }
});

const promptSuggestionSchema = z.object({
  prompts: z
    .array(
      z.object({
        text: z
          .string()
          .describe('A short, generic search query (30-100 characters) WITHOUT any brand names'),
        category: z
          .enum([
            'industry',
            'comparison',
            'how-to',
            'use-case',
            'recommendation',
            'alternative',
            'problem-solving',
          ])
          .describe('Category of the prompt'),
      }),
    )
    .length(10),
});

function getSystemPrompt(langName) {
  const currentYear = new Date().getFullYear();
  return `You are an AEO (Answer Engine Optimization) expert. Given brand information, generate exactly 10 search prompts that real users would type into AI search engines (ChatGPT, Perplexity, Gemini, Claude, etc.). Current year: ${currentYear}.

CRITICAL RULES:
- Do NOT use the brand name in prompts. These must be generic, high-volume industry queries.
- Each prompt MUST be between 30 and 100 characters long. Aim for 40-80 characters.
- The goal is to measure whether the brand appears organically in AI responses when users search for general topics.
- Think about what potential customers search BEFORE they know about any specific brand.
- Focus on high search-volume queries that are relevant to what the brand does.

Generate prompts like these (generic, no brand names):
- "Best project management tools for remote teams"
- "How to automate email marketing campaigns"
- "Top CRM software for small businesses ${currentYear}"
- "What is the best way to manage inventory for e-commerce"
- "Free alternatives to enterprise automation platforms"

Do NOT generate prompts like these (brand-specific, low value):
- "What is [BrandName]?"
- "[BrandName] pricing"
- "[BrandName] vs [Competitor]"
- "How to use [BrandName]"

Include a diverse mix of:
- Industry best-of queries ("Best [category] tools", "Top [industry] software")
- How-to queries related to the brand's domain ("How to [solve problem the brand solves]")
- Comparison/listicle queries ("Top 10 [product category] in ${currentYear}")
- Use-case queries ("Best tool for [specific use case]")
- Problem-solving queries ("How to fix/improve [pain point]")
- Recommendation queries ("What [tool type] should I use for [scenario]")
- Alternative/options queries ("Free [product category] options", "Open source [category]")

Make prompts natural, realistic, and high search-volume — things real users actually search for.
Each prompt must have a category: industry, comparison, how-to, use-case, recommendation, alternative, or problem-solving.
IMPORTANT: All prompts MUST be written in ${langName}.`;
}

/**
 * POST /api/prompts/suggest
 * Body: { brandName, industry, description?, model? }
 * Returns: { prompts: [{ text, category }] }
 */
router.post('/suggest', requireFeature('prompt_suggestions'), async (req, res) => {
  try {
    const { brandName, industry, description, model, language } = req.body;
    const langName = getLanguageName(language);

    if (!brandName) {
      return res.status(400).json({ error: 'brandName is required' });
    }

    const userPrompt = `Brand context (DO NOT use the brand name "${brandName}" in any prompt):
Industry: ${industry || 'Not specified'}
Description: ${description || 'Not specified'}
Language: ${langName} — write ALL prompts in this language.

Based on this brand's industry and context, generate 10 short, generic search prompts (each 30-100 characters, aim for 40-80) that potential customers would type into AI search engines. These prompts should be queries where this brand COULD naturally appear in AI responses — but the prompts themselves must NOT contain any brand names.`;

    const promptModel = process.env.PROMPT_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';
    const aiModel = resolveModel(model || promptModel);

    // #379 — bounded retry so one transient failure or schema miss doesn't
    // drop the whole suggestion step.
    const { object } = await withRetry(
      () =>
        generateObject({
          model: aiModel,
          schema: promptSuggestionSchema,
          system: getSystemPrompt(langName),
          prompt: userPrompt,
        }),
      { attempts: 3, baseDelayMs: 500, label: 'prompt-suggest' },
    );

    return res.json({ prompts: object.prompts });
  } catch (error) {
    req.log.error({ err: error }, 'prompt suggestion error');
    return res.status(500).json({
      error: 'Failed to generate prompt suggestions',
      details: error.message,
    });
  }
});

const topicPromptSchema = z.object({
  topicPrompts: z.array(
    z.object({
      topic: z.string(),
      prompts: z.array(z.string().min(30).max(100)).length(5),
    }),
  ),
});

/**
 * POST /api/prompts/from-topics
 * Body: { brandName, industry, description?, topics: string[] }
 * Returns: { topicPrompts: [{ topic, prompts: string[] }] }
 */
router.post('/from-topics', async (req, res) => {
  try {
    const { brandName, industry, description, topics, language } = req.body;
    const langName = getLanguageName(language);

    if (!brandName || !topics?.length) {
      return res.status(400).json({ error: 'brandName and topics are required' });
    }

    const promptModel = process.env.PROMPT_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';
    const aiModel = resolveModel(promptModel);

    const topicList = topics.map((t, i) => `${i + 1}. ${t}`).join('\n');

    // #379 — this is the onboarding prompts step's generator; a single
    // transient failure here used to strand the user with an empty step.
    const { object } = await withRetry(
      () =>
        generateObject({
          model: aiModel,
          schema: topicPromptSchema,
          system: `You are an AEO (Answer Engine Optimization) expert. Generate exactly 5 search prompts per topic that real users would type into AI search engines. Current year: ${new Date().getFullYear()}.

RULES:
- Keep prompts SHORT and concise — between 30 and 100 characters. Aim for 40-80 characters.
- Write them like real quick searches, e.g. "best CRM for small business" or "top email marketing tools ${new Date().getFullYear()}".
- Do NOT use the brand name "${brandName}" in the prompts.
- Each prompt should be relevant to the specific topic it belongs to.
- Focus on queries where the brand could organically appear in AI-generated answers.
- Make prompts diverse: include comparisons, how-tos, best-of lists, recommendations, alternatives.
IMPORTANT: All prompts MUST be written in ${langName}.`,
          prompt: `Brand: ${brandName}
Industry: ${industry || 'Not specified'}
Description: ${description || 'Not specified'}
Language: ${langName} — write ALL prompts in this language.

Generate 5 search prompts for each of these topics:
${topicList}

Return the exact topic names as provided above.`,
        }),
      { attempts: 3, baseDelayMs: 500, label: 'prompts-from-topics' },
    );

    return res.json({ topicPrompts: object.topicPrompts });
  } catch (error) {
    req.log.error({ err: error }, 'topic prompt generation error');
    return res.status(500).json({
      error: 'Failed to generate prompts from topics',
      details: error.message,
    });
  }
});

// POST /api/prompts/fanout-intents — classify the search intent of observed
// query fan-out sub-queries (#333). Intent is brand-independent, so it's cached
// globally per normalized query string in `fanout_query_intents`; only
// cache-misses hit the LLM. Body: { queries: string[] }.
const FANOUT_INTENT_MAX_QUERIES = 200;
const FANOUT_INTENT_CONCURRENCY = 6;
// Cache-lookup batch size — keeps each `.in('query', ...)` URL well under
// PostgREST / proxy length limits even with long sub-queries.
const FANOUT_INTENT_LOOKUP_CHUNK = 40;

function normalizeIntentQuery(raw) {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 512) : '';
}

router.post('/fanout-intents', async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.queries) ? req.body.queries : [];
    // Normalize + dedup; cap the batch so a crafted call can't fan out into
    // hundreds of LLM calls.
    const queries = [...new Set(raw.map(normalizeIntentQuery).filter(Boolean))].slice(
      0,
      FANOUT_INTENT_MAX_QUERIES,
    );
    if (queries.length === 0) return res.json({ intents: {} });

    // 1. Read the cache in bounded chunks — a single `.in('query', ...)` over
    // up to 200 text values can blow past PostgREST's URL length limit. A read
    // error must surface (500), not silently fall through to classifying every
    // query via the LLM.
    const intents = {};
    for (let i = 0; i < queries.length; i += FANOUT_INTENT_LOOKUP_CHUNK) {
      const chunk = queries.slice(i, i + FANOUT_INTENT_LOOKUP_CHUNK);
      const { data: cached, error: cacheErr } = await supabaseAdmin
        .from('fanout_query_intents')
        .select('query, intent')
        .in('query', chunk);
      if (cacheErr) throw cacheErr;
      for (const row of cached ?? []) intents[row.query] = row.intent;
    }

    // 2. Classify the misses (bounded concurrency), then persist them.
    const misses = queries.filter((q) => !(q in intents));
    if (misses.length > 0) {
      const aiModel = resolveModel();
      const fresh = [];
      for (let i = 0; i < misses.length; i += FANOUT_INTENT_CONCURRENCY) {
        const chunk = misses.slice(i, i + FANOUT_INTENT_CONCURRENCY);
        const settled = await Promise.allSettled(
          chunk.map((q) => classifyPromptIntent(q, aiModel).then((intent) => ({ q, intent }))),
        );
        for (const s of settled) {
          if (s.status === 'fulfilled') {
            intents[s.value.q] = s.value.intent;
            fresh.push({ query: s.value.q, intent: s.value.intent });
          }
        }
      }
      if (fresh.length > 0) {
        await supabaseAdmin
          .from('fanout_query_intents')
          .upsert(fresh, { onConflict: 'query', ignoreDuplicates: true });
      }
    }

    return res.json({ intents });
  } catch (error) {
    req.log.error({ err: error }, 'fanout intents classification error');
    return res.status(500).json({ error: error.message });
  }
});

export default router;
