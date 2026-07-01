/**
 * Standalone opportunity generation function used by the tracking worker.
 * Calls the content generate endpoint logic directly without HTTP.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './ai-provider.js';
import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

const opportunitySchema = z.object({
  opportunities: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        type: z.enum(['owned', 'earned']),
        impact: z.enum(['high', 'medium', 'low']),
        relatedPromptIndex: z.number(),
      }),
    )
    .min(1)
    .max(20),
});

const SYSTEM_PROMPT = `You are an AEO content strategist. Given a brand's AI visibility data, generate specific, actionable content recommendations.
Rules:
- Each recommendation must be concrete and actionable.
- Reference specific data points: volumes, visibility scores, competitor gaps.
- Focus on content that will improve the brand's visibility in AI-generated answers.
- Categorize as "owned" or "earned".
- Generate between 5 and 15 opportunities.`;

function computeScore(volume, visibility, competitorGap, intent) {
  const weights = {
    comparison: 1.0,
    'best-top': 0.95,
    'vs-review': 0.9,
    recommendation: 0.85,
    'how-to': 0.75,
    'problem-solving': 0.7,
    'what-is': 0.6,
    other: 0.5,
  };
  const nv = Math.min(volume / 50000, 1);
  const vg = (100 - (visibility || 0)) / 100;
  const cg = Math.min((competitorGap || 0) / 100, 1);
  const iw = weights[intent] || 0.5;
  return Math.round(Math.min(nv * 40 + vg * 30 + cg * 20 + iw * 10, 100) * 100) / 100;
}

export async function generateContentOpportunities(brandId) {
  logger.info({ brandId }, '[opportunities] generating');

  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('id, name, description, industry')
    .eq('id', brandId)
    .single();
  if (!brand) return;

  const { data: domains } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);

  const { data: promptSets } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  if (!promptSets?.length) return;

  const setIds = promptSets.map((ps) => ps.id);
  const { data: prompts } = await supabaseAdmin
    .from('prompts')
    .select('id, text, category')
    .in('prompt_set_id', setIds)
    .eq('is_active', true);
  if (!prompts?.length) return;

  const promptIds = prompts.map((p) => p.id);

  const [volRes, resRes, compRes] = await Promise.all([
    supabaseAdmin.from('prompt_volumes').select('*').in('prompt_id', promptIds),
    supabaseAdmin
      .from('prompt_results')
      .select('prompt_id, visibility_score, competitor_mentions')
      .in('prompt_id', promptIds)
      .order('created_at', { ascending: false }),
    supabaseAdmin.from('competitors').select('name').eq('brand_id', brandId),
  ]);

  const volMap = {};
  for (const v of volRes.data || []) volMap[v.prompt_id] = v;

  const resMap = {};
  for (const r of resRes.data || []) {
    if (!resMap[r.prompt_id]) resMap[r.prompt_id] = [];
    resMap[r.prompt_id].push(r);
  }

  const testedPrompts = prompts.filter((p) => (resMap[p.id] || []).length > 0);
  if (!testedPrompts.length) return;

  const scored = testedPrompts
    .map((p) => {
      const vol = volMap[p.id];
      const res = resMap[p.id] || [];
      const avgVis = res.length
        ? Math.round(res.reduce((s, r) => s + r.visibility_score, 0) / res.length)
        : 0;
      const compMentions = {};
      for (const r of res) {
        const cms =
          typeof r.competitor_mentions === 'string'
            ? JSON.parse(r.competitor_mentions)
            : r.competitor_mentions;
        for (const cm of cms || [])
          compMentions[cm.name] = (compMentions[cm.name] || 0) + (cm.visibility_score || 0);
      }
      const cg = Object.values(compMentions).length
        ? Math.round(
            Object.values(compMentions).reduce((a, b) => a + b, 0) /
              Object.values(compMentions).length,
          ) - avgVis
        : 0;

      return {
        promptId: p.id,
        text: p.text,
        category: p.category || 'unknown',
        estAiVolume: vol?.est_ai_volume || 0,
        intent: vol?.intent || 'other',
        keywords: vol?.keywords || [],
        avgVisibility: avgVis,
        competitorGap: cg,
        competitorsCited: Object.keys(compMentions),
        score: computeScore(vol?.est_ai_volume || 0, avgVis, cg, vol?.intent || 'other'),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  if (!scored.length) return;

  const userPrompt = `Brand: ${brand.name}
Industry: ${brand.industry || 'Not specified'}
Domain: ${(domains || []).map((d) => d.domain).join(', ') || 'N/A'}
Competitors: ${(compRes.data || []).map((c) => c.name).join(', ') || 'None'}

Prompt Data:
${scored.map((p, i) => `[${i}] "${p.text}" | Intent: ${p.intent} | AI Vol: ${p.estAiVolume}/mo | Vis: ${p.avgVisibility}% | Gap: ${p.competitorGap}%`).join('\n')}

Generate actionable content opportunities.`;

  const { object } = await generateObject({
    model: resolveModel(),
    schema: opportunitySchema,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  const { data: existing } = await supabaseAdmin
    .from('content_opportunities')
    .select('prompt_id, title')
    .eq('brand_id', brandId)
    .eq('status', 'new');

  const seen = new Set(
    (existing || []).map(
      (opportunity) =>
        `${opportunity.prompt_id}::${(opportunity.title || '').toLowerCase().trim()}`,
    ),
  );

  const rows = object.opportunities
    .map((opp) => {
      const rel = scored[opp.relatedPromptIndex] || scored[0];
      return { rel, opp };
    })
    .filter(({ rel, opp }) => {
      const key = `${rel.promptId}::${opp.title.toLowerCase().trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ rel, opp }) => ({
      brand_id: brandId,
      prompt_id: rel.promptId,
      title: opp.title,
      description: opp.description,
      type: opp.type,
      impact: opp.impact,
      opportunity_score: rel.score,
      status: 'new',
      source_data: {
        promptText: rel.text,
        estAiVolume: rel.estAiVolume,
        visibilityScore: rel.avgVisibility,
        competitorGap: rel.competitorGap,
        intent: rel.intent,
        keywords: rel.keywords,
        competitorsCited: rel.competitorsCited,
      },
    }));

  if (rows.length > 0) await supabaseAdmin.from('content_opportunities').insert(rows);
  logger.info(
    { brandId, generated: rows.length, alreadyPending: (existing || []).length },
    '[opportunities] generated new opportunities',
  );
}
