import { Router } from 'express';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { resolveModel } from '../lib/ai-provider.js';
import { withRetry } from '../lib/retry.js';
import { getLanguageName } from '../lib/languages.js';

const router = Router();

const topicSchema = z.object({
  topics: z
    .array(
      z.object({
        name: z
          .string()
          .describe('A concise topic name (3-8 words) relevant to the brand for AEO tracking'),
      }),
    )
    .min(6)
    .max(12),
});

/**
 * Two-phase generation (web research → structured extraction), shared by the
 * ephemeral onboarding endpoint below and the persisted Topics-page
 * suggestions (#463).
 */
async function generateTopicIdeas({ brandName, industry, description, website, language }) {
  const langName = getLanguageName(language);
  const topicModel = process.env.TOPIC_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';

  const researchPrompt = `Search the web and research "${brandName}" (${website || 'no website provided'}).
Industry: ${industry || 'Not specified'}
Description: ${description || 'Not specified'}

Find 8-12 relevant TOPICS that this brand should track for Answer Engine Optimization (AEO). Topics should represent key areas where users might ask AI assistants about this brand or its industry.

IMPORTANT: Do NOT include the brand name "${brandName}" in any topic. Topics must be generic industry terms.

Good topics examples:
- "Best [product category] tools"
- "[Industry] best practices"
- "[Product category] comparison"
- "[Specific feature] solutions"
- "[Use case] automation"

Each topic must focus on a SINGLE concept. Do NOT combine two ideas with "and" or "&" in a single topic. For example, instead of "Fabric types and care", create two separate topics: "Fabric types" and "Fabric care".

Topics should be diverse: include competitive comparisons, product features, industry trends, use cases, and problem-solving areas.

IMPORTANT: Generate all topic names in ${langName}.`;

  // #379 — retry the WHOLE two-phase flow: a schema miss in the structuring
  // phase re-runs the research too, not just the last call.
  const { object } = await withRetry(
    async () => {
      const { text: research } = await generateText({
        model: resolveModel(topicModel, { useSearchGrounding: true }),
        prompt: researchPrompt,
      });

      return generateObject({
        model: resolveModel(topicModel),
        schema: topicSchema,
        system: `Extract AEO tracking topics from the research below. Each topic should be concise (3-8 words) and represent an area where AI assistants might mention or discuss "${brandName}". Do NOT include the brand name "${brandName}" in any topic — keep them generic. Include a mix of: competitive comparisons, product/service features, industry trends, use cases, and problem-solving topics. Each topic MUST focus on a single concept — never combine two ideas with "and" or "&". IMPORTANT: All topic names MUST be written in ${langName}.`,
        prompt: research,
      });
    },
    { attempts: 3, baseDelayMs: 500, label: 'topic-suggest' },
  );

  return object.topics;
}

/**
 * POST /api/topics/suggest
 * Body: { brandName, industry, description?, website?, language? }
 * Returns: { topics: [{ name }] }
 */
router.post('/suggest', async (req, res) => {
  try {
    const { brandName, industry, description, website, language } = req.body;

    if (!brandName) {
      return res.status(400).json({ error: 'brandName is required' });
    }

    const topics = await generateTopicIdeas({
      brandName,
      industry,
      description,
      website,
      language,
    });
    return res.json({ topics });
  } catch (error) {
    req.log.error({ err: error }, 'topic suggestion error');
    return res.status(500).json({
      error: 'Failed to generate topic suggestions',
      details: error.message,
    });
  }
});

/**
 * GET /api/topics/suggestions/:brandId
 * Returns the persisted suggestions still awaiting a decision (#463).
 * Never triggers generation — the Topics page load path must stay LLM-free.
 */
router.get('/suggestions/:brandId', async (req, res) => {
  try {
    await assertBrandAccess(req.params.brandId, req.user.id);
    const { data, error } = await supabaseAdmin
      .from('topic_suggestions')
      .select('*')
      .eq('brand_id', req.params.brandId)
      .eq('status', 'new')
      .order('generated_at', { ascending: false });
    if (error) throw error;
    return res.json({ suggestions: data || [] });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'topic-suggestions list error');
    return res.status(status).json({ error: error.message || 'Failed to load suggestions' });
  }
});

/**
 * POST /api/topics/suggestions/:brandId/refresh
 * Generates a fresh batch with the same flow onboarding uses, then persists
 * it — excluding topics the brand already tracks and names it previously
 * dismissed or added, so decided suggestions never reappear (#463).
 */
router.post('/suggestions/:brandId/refresh', async (req, res) => {
  try {
    const brandId = req.params.brandId;
    await assertBrandAccess(brandId, req.user.id);

    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('name, industry, description, language')
      .eq('id', brandId)
      .single();
    if (!brand) return res.status(404).json({ error: 'Brand not found' });

    const { data: primaryDomain } = await supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId)
      .order('is_primary', { ascending: false })
      .limit(1)
      .maybeSingle();

    const ideas = await generateTopicIdeas({
      brandName: brand.name,
      industry: brand.industry,
      description: brand.description,
      website: primaryDomain?.domain,
      language: brand.language,
    });

    const [{ data: existingTopics }, { data: decided }] = await Promise.all([
      supabaseAdmin.from('topics').select('name').eq('brand_id', brandId),
      supabaseAdmin
        .from('topic_suggestions')
        .select('name')
        .eq('brand_id', brandId)
        .in('status', ['dismissed', 'added']),
    ]);
    const taken = new Set(
      [...(existingTopics || []), ...(decided || [])].map((r) => r.name.trim().toLowerCase()),
    );

    const seen = new Set();
    const fresh = ideas.filter((t) => {
      const key = t.name.trim().toLowerCase();
      if (!key || taken.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Replace the undecided batch wholesale — same behavior as prompt
    // suggestions refresh. Dismissed/added rows are never touched.
    await supabaseAdmin
      .from('topic_suggestions')
      .delete()
      .eq('brand_id', brandId)
      .eq('status', 'new');

    if (fresh.length === 0) {
      return res.json({ suggestions: [] });
    }

    const { data: inserted, error } = await supabaseAdmin
      .from('topic_suggestions')
      .insert(
        fresh.map((t) => ({
          brand_id: brandId,
          name: t.name.trim(),
          source: 'llm',
          status: 'new',
        })),
      )
      .select();
    if (error) throw error;

    return res.json({ suggestions: inserted });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'topic-suggestions refresh error');
    return res.status(status).json({ error: error.message || 'Failed to generate suggestions' });
  }
});

/**
 * POST /api/topics/suggestions/:id/dismiss
 * Marks a suggestion dismissed; its name is excluded from future refreshes.
 */
router.post('/suggestions/:id/dismiss', async (req, res) => {
  try {
    const { data: suggestion } = await supabaseAdmin
      .from('topic_suggestions')
      .select('brand_id')
      .eq('id', req.params.id)
      .single();
    if (!suggestion) return res.status(404).json({ error: 'Not found' });
    await assertBrandAccess(suggestion.brand_id, req.user.id);

    const { error } = await supabaseAdmin
      .from('topic_suggestions')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'topic-suggestions dismiss error');
    return res.status(status).json({ error: error.message || 'Failed to dismiss' });
  }
});

/**
 * POST /api/topics/suggestions/:id/accept
 * Body: { topicId } — the topic the web app just created via the singular
 * createTopic action. This only records the outcome; topic creation itself
 * happens RLS-checked in the web app.
 */
router.post('/suggestions/:id/accept', async (req, res) => {
  try {
    const { topicId } = req.body || {};
    if (!topicId) {
      return res.status(400).json({ error: 'topicId is required' });
    }
    const { data: suggestion } = await supabaseAdmin
      .from('topic_suggestions')
      .select('brand_id')
      .eq('id', req.params.id)
      .single();
    if (!suggestion) return res.status(404).json({ error: 'Not found' });
    await assertBrandAccess(suggestion.brand_id, req.user.id);

    const { error } = await supabaseAdmin
      .from('topic_suggestions')
      .update({
        status: 'added',
        added_topic_id: topicId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'topic-suggestions accept error');
    return res.status(status).json({ error: error.message || 'Failed to accept' });
  }
});

export default router;
