import { Router } from 'express';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../lib/ai-provider.js';
import { getLanguageName } from '../lib/languages.js';
import { withRetry } from '../lib/retry.js';

const router = Router();

const competitorSchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string().describe('Company/brand display name'),
        domain: z.string().describe('Root domain without protocol, e.g. "asana.com"'),
      }),
    )
    .min(3)
    .max(10),
});

/**
 * POST /api/competitors/suggest
 * Body: { brandName, industry, description? }
 * Returns: { competitors: [{ name, domain }] }
 *
 * Uses OpenAI Responses API with web search to find real competitors,
 * then structures the results with generateObject.
 */
router.post('/suggest', async (req, res) => {
  try {
    const { brandName, industry, description, language } = req.body;
    const langName = getLanguageName(language);

    if (!brandName) {
      return res.status(400).json({ error: 'brandName is required' });
    }

    const competitorModel =
      process.env.COMPETITOR_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';

    // Phase 1: web search to find real competitors
    const researchPrompt = `Search the web and find 5-10 direct competitors of "${brandName}".
Industry: ${industry || 'Not specified'}
Description: ${description || 'Not specified'}

Find REAL companies that compete directly with "${brandName}" — selling similar products/services to similar audiences, especially in the ${langName}-speaking market. For each competitor, provide the company name and their actual website domain.`;

    // #379 — retry the WHOLE two-phase flow: the schema's .min(3) means a
    // Phase-2 under-count throws NoObjectGeneratedError, and re-running the
    // research gives the structuring phase fresh material to work with.
    const { object } = await withRetry(
      async () => {
        const { text: research } = await generateText({
          model: resolveModel(competitorModel, { useSearchGrounding: true }),
          prompt: researchPrompt,
        });

        // Phase 2: structure the research into the schema
        return generateObject({
          model: resolveModel(competitorModel),
          schema: competitorSchema,
          system: `Extract competitor information from the research below. Only include companies with REAL, verified domains. Return the root domain (e.g. "monday.com"), not full URLs. Do NOT include "${brandName}" itself.`,
          prompt: research,
        });
      },
      { attempts: 3, baseDelayMs: 500, label: 'competitor-suggest' },
    );

    return res.json({ competitors: object.competitors });
  } catch (error) {
    req.log.error({ err: error }, 'competitor suggestion error');
    return res.status(500).json({
      error: 'Failed to generate competitor suggestions',
      details: error.message,
    });
  }
});

export default router;
