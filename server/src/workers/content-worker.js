/**
 * Content opportunity generation processor.
 * Moves the LLM-based generation out of the HTTP request path.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../lib/ai-provider.js';
import { getLanguageName } from '../lib/languages.js';
import supabaseAdmin from '../config/supabase.js';
import logger from '../lib/logger.js';

const opportunitySchema = z.object({
  opportunities: z
    .array(
      z.object({
        title: z
          .string()
          .describe('A specific, actionable content recommendation backed by the data provided'),
        description: z
          .string()
          .describe(
            'A 1-2 sentence explanation of why this action matters, referencing specific metrics',
          ),
        type: z
          .enum(['owned', 'earned'])
          .describe(
            'owned = content the brand controls (blog, landing page); earned = external content (PR, guest post, review)',
          ),
        impact: z
          .enum(['high', 'medium', 'low'])
          .describe('Expected impact on AI visibility based on volume and gap'),
        relatedPromptIndex: z
          .number()
          .describe('0-based index of the prompt in the input array this opportunity relates to'),
      }),
    )
    .min(1)
    .max(20),
});

const OPPORTUNITY_SYSTEM_PROMPT = `You are an AEO (Answer Engine Optimization) content strategist. Given a brand's AI visibility data — including prompt tracking results, search volumes, and competitor mentions — generate specific, actionable content recommendations.

Rules:
- Each recommendation must be concrete and actionable (e.g. "Create a comprehensive comparison page for X" not "Improve your content").
- Reference specific data points: volumes, visibility scores, competitor gaps.
- Focus on content that will improve the brand's visibility in AI-generated answers.
- Categorize as "owned" (blog posts, landing pages, FAQ pages the brand controls) or "earned" (guest posts, PR, review sites).
- Set impact based on: volume × (100 - current visibility) × competitor gap.
- Generate between 5 and 15 opportunities depending on data richness.
- Do NOT repeat the same recommendation in different wording.`;

function computeOpportunityScore(volume, visibility, competitorGap, intent) {
  const intentWeights = {
    comparison: 1.0,
    'best-top': 0.95,
    'vs-review': 0.9,
    recommendation: 0.85,
    'how-to': 0.75,
    'problem-solving': 0.7,
    'what-is': 0.6,
    other: 0.5,
  };

  const maxVolume = 50000;
  const normalizedVolume = Math.min(volume / maxVolume, 1);
  const visibilityGap = (100 - (visibility || 0)) / 100;
  const normalizedCompGap = Math.min((competitorGap || 0) / 100, 1);
  const intentWeight = intentWeights[intent] || 0.5;

  const score =
    normalizedVolume * 40 + visibilityGap * 30 + normalizedCompGap * 20 + intentWeight * 10;

  return Math.round(Math.min(score, 100) * 100) / 100;
}

/**
 * Core logic: collect brand data, generate opportunities via LLM, save them.
 * @param {{ brandId: string, model?: string, job?: { progress: function, signal?: AbortSignal } }} opts
 */
export async function processContentJob({ brandId, model, job }) {
  job.progress({ phase: 'collecting_data', message: 'Fetching brand and prompt data...' });

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name, description, industry, organization_id, language')
    .eq('id', brandId)
    .single();

  if (!brand) throw new Error(`Brand not found: ${brandId}`);
  const langName = getLanguageName(brand.language);

  const { data: domains } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);

  const { data: promptSets } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);

  if (!promptSets?.length) {
    throw new Error('No prompt sets found. Add prompts first.');
  }

  const setIds = promptSets.map((ps) => ps.id);

  const { data: prompts } = await supabaseAdmin
    .from('prompts')
    .select('id, text, category')
    .in('prompt_set_id', setIds)
    .eq('is_active', true);

  if (!prompts?.length) {
    throw new Error('No active prompts found.');
  }

  const promptIds = prompts.map((p) => p.id);

  const [volumeResult, resultResult, competitorResult] = await Promise.all([
    supabaseAdmin.from('prompt_volumes').select('*').in('prompt_id', promptIds),
    supabaseAdmin
      .from('prompt_results')
      .select(
        'prompt_id, visibility_score, mention_count, citation_count, sentiment, competitor_mentions',
      )
      .in('prompt_id', promptIds)
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('competitors').select('id, name, domain').eq('brand_id', brandId),
  ]);

  const volumes = volumeResult.data || [];
  const results = resultResult.data || [];
  const competitors = competitorResult.data || [];

  const volumeMap = {};
  for (const v of volumes) volumeMap[v.prompt_id] = v;

  const resultMap = {};
  for (const r of results) {
    if (!resultMap[r.prompt_id]) resultMap[r.prompt_id] = [];
    resultMap[r.prompt_id].push(r);
  }

  const testedPrompts = prompts.filter((p) => (resultMap[p.id] || []).length > 0);
  if (!testedPrompts.length) {
    return { generated: 0 };
  }

  const promptDataForLLM = testedPrompts.map((p, idx) => {
    const vol = volumeMap[p.id];
    const res = resultMap[p.id] || [];

    const avgVisibility =
      res.length > 0 ? Math.round(res.reduce((s, r) => s + r.visibility_score, 0) / res.length) : 0;

    const competitorMentions = {};
    for (const r of res) {
      if (r.competitor_mentions) {
        const mentions =
          typeof r.competitor_mentions === 'string'
            ? JSON.parse(r.competitor_mentions)
            : r.competitor_mentions;
        for (const cm of mentions || []) {
          competitorMentions[cm.name] =
            (competitorMentions[cm.name] || 0) + (cm.visibility_score || 0);
        }
      }
    }

    return {
      index: idx,
      promptId: p.id,
      text: p.text,
      category: p.category || 'unknown',
      estAiVolume: vol?.est_ai_volume || 0,
      intent: vol?.intent || 'other',
      keywords: vol?.keywords || [],
      avgVisibility,
      totalResults: res.length,
      competitorsCited: Object.keys(competitorMentions),
      competitorGap:
        Object.values(competitorMentions).length > 0
          ? Math.round(
              Object.values(competitorMentions).reduce((a, b) => a + b, 0) /
                Object.values(competitorMentions).length,
            ) - avgVisibility
          : 0,
    };
  });

  const scoredPrompts = promptDataForLLM
    .map((p) => ({
      ...p,
      score: computeOpportunityScore(p.estAiVolume, p.avgVisibility, p.competitorGap, p.intent),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  if (scoredPrompts.length === 0) {
    return { generated: 0 };
  }

  job.progress({ phase: 'analyzing', message: 'Generating opportunities with AI...' });

  const userPrompt = `Brand: ${brand.name}
Industry: ${brand.industry || 'Not specified'}
Domain: ${(domains || []).map((d) => d.domain).join(', ') || 'N/A'}
Competitors: ${competitors.map((c) => c.name).join(', ') || 'None tracked'}

Prompt Data (sorted by opportunity score, highest first):
${scoredPrompts
  .map(
    (p, i) =>
      `[${i}] "${p.text}" | Category: ${p.category} | Intent: ${p.intent} | Est. AI Volume: ${p.estAiVolume}/mo | Visibility: ${p.avgVisibility}% | Competitor Gap: ${p.competitorGap > 0 ? '+' + p.competitorGap : p.competitorGap}% | Competitors Cited: ${p.competitorsCited.join(', ') || 'none'} | Keywords: ${p.keywords.join(', ')}`,
  )
  .join('\n')}

Generate actionable content opportunities based on this data. Reference specific numbers and competitors where relevant.

IMPORTANT: Write every opportunity title and description in ${langName}.`;

  const aiModel = resolveModel(model);

  const { object } = await generateObject({
    model: aiModel,
    schema: opportunitySchema,
    system: OPPORTUNITY_SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  job.progress({ phase: 'saving', message: 'Saving opportunities...' });

  await supabaseAdmin
    .from('content_opportunities')
    .delete()
    .eq('brand_id', brandId)
    .in('status', ['new']);

  const rows = object.opportunities.map((opp) => {
    const relatedPrompt = scoredPrompts[opp.relatedPromptIndex] || scoredPrompts[0];
    const score = computeOpportunityScore(
      relatedPrompt.estAiVolume,
      relatedPrompt.avgVisibility,
      relatedPrompt.competitorGap,
      relatedPrompt.intent,
    );

    return {
      brand_id: brandId,
      prompt_id: relatedPrompt.promptId,
      title: opp.title,
      description: opp.description,
      type: opp.type,
      impact: opp.impact,
      opportunity_score: score,
      status: 'new',
      source_data: {
        promptText: relatedPrompt.text,
        estAiVolume: relatedPrompt.estAiVolume,
        visibilityScore: relatedPrompt.avgVisibility,
        competitorGap: relatedPrompt.competitorGap,
        intent: relatedPrompt.intent,
        keywords: relatedPrompt.keywords,
        competitorsCited: relatedPrompt.competitorsCited,
      },
    };
  });

  const { error: insertErr } = await supabaseAdmin.from('content_opportunities').insert(rows);

  if (insertErr) {
    throw new Error(insertErr.message);
  }

  logger.info({ brandId, generated: rows.length }, 'content opportunities generated');

  return { generated: rows.length };
}
