/**
 * Reports routes (Simple Reports MVP).
 *
 *   POST /api/reports/summary   { brandId, snapshot, dateFrom, dateTo, model? }
 *                               → { success, summary }
 *
 * Generates the AI executive summary for a report from the metric snapshot the
 * web action assembled (insights KPIs, share of voice, competitor comparison,
 * citations overview). The snapshot itself is saved to the `reports` table by
 * the Server Action — this endpoint only turns numbers into prose, following
 * the content.js brief-generation pattern (resolveModel + one LLM round-trip,
 * no retry loop: generation is user-triggered and re-runnable).
 */

import { Router } from 'express';
import { generateText } from 'ai';
import { resolveModel } from '../lib/ai-provider.js';
import { assertBrandAccess } from '../lib/access.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

const SUMMARY_SYSTEM_PROMPT = `You are an AI search visibility analyst writing the executive summary of a brand's AI visibility report.

You will receive a JSON snapshot of the brand's metrics for the report period: overall visibility KPIs (with deltas vs the previous period), share of voice, a competitor comparison, and a citations overview.

Write a 1-2 paragraph executive summary in English for a marketing executive:
- Lead with the overall picture (visibility, mentions, citations) and how it changed.
- Call out the most notable competitor dynamics (who leads, who moved).
- Mention citation reach (domains/URLs) only if it adds signal.
- Be concrete: use the numbers from the snapshot. Never invent metrics that are not present.
- No headings, no bullet points, no markdown — plain prose only.`;

router.post('/summary', async (req, res) => {
  const userId = req.user?.id;
  const { brandId, snapshot, dateFrom, dateTo, model } = req.body || {};

  if (!brandId || !snapshot || typeof snapshot !== 'object') {
    return res.status(400).json({ success: false, message: 'brandId and snapshot are required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const { data: brandRow } = await supabaseAdmin
      .from('brands')
      .select('name')
      .eq('id', brandId)
      .single();
    const brandName = brandRow?.name || 'the brand';

    const userPrompt = `Brand: ${brandName}
Report period: ${dateFrom || 'unknown'} to ${dateTo || 'unknown'}

Metric snapshot (JSON):
${JSON.stringify(snapshot, null, 2)}

Write the executive summary.`;

    const { text: summary } = await generateText({
      model: resolveModel(model),
      system: SUMMARY_SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    return res.json({ success: true, summary: summary.trim() });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'report summary generation failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
