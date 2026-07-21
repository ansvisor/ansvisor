import { Router } from 'express';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { requireFeature } from '../lib/plan-guard.js';
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
 * Tracked-data signals for topic generation (#463 follow-up): high-volume /
 * low-competition prompts and underperforming topics, mined from the brand's
 * own prompt_volumes and prompt_results. Returns null when the brand has no
 * usable data yet (nothing tracked, no volume analysis) — generation then
 * runs on the brand profile alone, exactly like onboarding.
 */
async function loadTopicSignals(brandId) {
  const [{ data: prompts }, { data: topicRows }, { data: results }] = await Promise.all([
    supabaseAdmin
      .from('prompts')
      .select('id, text, topic_id, prompt_sets!inner(brand_id), prompt_volumes(est_ai_volume)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .limit(200),
    supabaseAdmin.from('topics').select('id, name').eq('brand_id', brandId).eq('is_active', true),
    // #155 — shopping results are excluded from every aggregate.
    supabaseAdmin
      .from('prompt_results')
      .select('prompt_id, mention_count, citation_count, competitor_mentions')
      .eq('brand_id', brandId)
      .neq('platform', 'chatgpt-shopping')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);
  if (!prompts?.length || !results?.length) return null;

  const topicNameById = new Map((topicRows || []).map((t) => [t.id, t.name]));

  // Per-prompt aggregates over the recent results window.
  const byPrompt = new Map();
  for (const r of results) {
    const agg = byPrompt.get(r.prompt_id) || { runs: 0, visible: 0, competitors: new Set() };
    agg.runs += 1;
    if ((r.mention_count || 0) > 0 || (r.citation_count || 0) > 0) agg.visible += 1;
    const mentions = r.competitor_mentions;
    if (Array.isArray(mentions)) {
      for (const m of mentions) {
        const name = typeof m === 'string' ? m : m?.name;
        if (name) agg.competitors.add(name);
      }
    } else if (mentions && typeof mentions === 'object') {
      for (const name of Object.keys(mentions)) agg.competitors.add(name);
    }
    byPrompt.set(r.prompt_id, agg);
  }

  const enriched = prompts
    .map((p) => {
      const pv = p.prompt_volumes;
      const volume = (Array.isArray(pv) ? pv[0]?.est_ai_volume : pv?.est_ai_volume) || 0;
      const agg = byPrompt.get(p.id);
      return {
        text: p.text,
        topicName: topicNameById.get(p.topic_id) || null,
        volume,
        runs: agg?.runs || 0,
        visibleRate: agg && agg.runs > 0 ? agg.visible / agg.runs : null,
        competitorCount: agg ? agg.competitors.size : null,
      };
    })
    .filter((p) => p.runs > 0);
  if (!enriched.length) return null;

  // Gap prompts: real demand (volume), weak brand presence, few competitors
  // already owning the answer — the space a new topic can still win.
  const gaps = enriched
    .filter((p) => p.volume > 0 && p.visibleRate !== null && p.visibleRate < 0.5)
    .sort((a, b) => b.volume - a.volume || (a.competitorCount ?? 99) - (b.competitorCount ?? 99))
    .slice(0, 8);

  // Weakest existing topics by visible-answer rate (needs a few runs to mean
  // anything) — candidates for adjacent, more winnable topic variants.
  const topicAgg = new Map();
  for (const p of enriched) {
    if (!p.topicName || p.visibleRate === null) continue;
    const t = topicAgg.get(p.topicName) || { runs: 0, visible: 0 };
    t.runs += p.runs;
    t.visible += p.visibleRate * p.runs;
    topicAgg.set(p.topicName, t);
  }
  const weakTopics = [...topicAgg.entries()]
    .filter(([, t]) => t.runs >= 5)
    .map(([name, t]) => ({ name, visibleRate: t.visible / t.runs }))
    .sort((a, b) => a.visibleRate - b.visibleRate)
    .slice(0, 3);

  if (!gaps.length && !weakTopics.length) return null;
  return { gaps, weakTopics };
}

function formatTopicSignals(signals) {
  if (!signals) return '';
  const pct = (rate) => `${Math.round(rate * 100)}%`;
  const lines = [];
  if (signals.gaps.length) {
    lines.push(
      `Opportunity signal (from this brand's tracked prompts — high user demand, weak brand presence, little competition):`,
      ...signals.gaps.map(
        (g) =>
          `  • [~${g.volume.toLocaleString('en-US')}/mo, visible in ${pct(g.visibleRate)} of answers, ${g.competitorCount ?? '?'} competitors cited${g.topicName ? `, topic: ${g.topicName}` : ''}] ${g.text}`,
      ),
      `Prioritize NEW topics that cover the themes behind these prompts — demand exists and no one owns the answer yet.`,
    );
  }
  if (signals.weakTopics.length) {
    lines.push(
      `Weakest existing topics by AI visibility (consider adjacent, more winnable angles — do NOT re-suggest these names):`,
      ...signals.weakTopics.map(
        (t) => `  • ${t.name} (visible in ${pct(t.visibleRate)} of answers)`,
      ),
    );
  }
  return `\n${lines.join('\n')}\n`;
}

/**
 * Two-phase generation (web research → structured extraction), shared by the
 * ephemeral onboarding endpoint below and the persisted Topics-page
 * suggestions (#463). `signals` (optional) injects tracked-prompt data into
 * the research phase; onboarding has none and passes nothing.
 */
async function generateTopicIdeas({
  brandName,
  industry,
  description,
  website,
  language,
  signals,
}) {
  const langName = getLanguageName(language);
  const topicModel = process.env.TOPIC_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';

  const researchPrompt = `Search the web and research "${brandName}" (${website || 'no website provided'}).
Industry: ${industry || 'Not specified'}
Description: ${description || 'Not specified'}
${formatTopicSignals(signals)}
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
router.post(
  '/suggestions/:brandId/refresh',
  requireFeature('topic_suggestions'),
  async (req, res) => {
    try {
      const brandId = req.params.brandId;
      await assertBrandAccess(brandId, req.user.id);

      const { data: brand } = await supabaseAdmin
        .from('brands')
        .select('name, industry, description, language')
        .eq('id', brandId)
        .single();
      if (!brand) return res.status(404).json({ error: 'Brand not found' });

      const [{ data: primaryDomain }, signals] = await Promise.all([
        supabaseAdmin
          .from('brand_domains')
          .select('domain')
          .eq('brand_id', brandId)
          .order('is_primary', { ascending: false })
          .limit(1)
          .maybeSingle(),
        loadTopicSignals(brandId),
      ]);

      const ideas = await generateTopicIdeas({
        brandName: brand.name,
        industry: brand.industry,
        description: brand.description,
        website: primaryDomain?.domain,
        language: brand.language,
        signals,
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
  },
);

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
