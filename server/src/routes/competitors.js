import { Router } from 'express';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../lib/ai-provider.js';
import { getLanguageName } from '../lib/languages.js';
import { withRetry } from '../lib/retry.js';
import { webResearch } from '../lib/web-research.js';

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

/** English country name for a region code ("TR" → "Turkey"), or null. */
function countryName(region) {
  const code = String(region || '')
    .split('-')[0]
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/competitors/suggest
 * Body: { brandName, industry, description?, website?, region?, language? }
 * Returns: { competitors: [{ name, domain }] }
 *
 * Researches the brand with the model's web search, then structures the
 * results with generateObject. The website pins down which company the name
 * means, and the region which market its competitors come from.
 */
router.post('/suggest', async (req, res) => {
  try {
    const { brandName, industry, description, website, region, language } = req.body;
    const langName = getLanguageName(language);
    const country = countryName(region);

    if (!brandName) {
      return res.status(400).json({ error: 'brandName is required' });
    }

    const competitorModel =
      process.env.COMPETITOR_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';

    // Phase 1: web search to find real competitors
    const market = country ? `in ${country}` : `in the ${langName}-speaking market`;
    const researchPrompt = `Search the web and find 5-10 direct competitors of "${brandName}"${website ? ` (${website})` : ''}.
Industry: ${industry || 'Not specified'}
Description: ${description || 'Not specified'}
Market: ${country || 'Not specified'}, language ${langName}

${website ? `First look up ${website} to understand exactly what "${brandName}" sells and to whom — the name alone may refer to other companies.\n\n` : ''}Then find REAL companies that compete directly with it — selling similar products/services to similar audiences ${market}. Prefer companies a customer ${market} would actually compare it with over global brands outside that market. For each competitor, provide the company name and their actual website domain.`;

    // #379 — retry the WHOLE two-phase flow: the schema's .min(3) means a
    // Phase-2 under-count throws NoObjectGeneratedError, and re-running the
    // research gives the structuring phase fresh material to work with.
    const { object } = await withRetry(
      async () => {
        const research = await webResearch(competitorModel, researchPrompt);
        req.log.info(
          { model: competitorModel, searched: research.searched, sources: research.sources },
          'competitor research',
        );

        // Phase 2: structure the research into the schema
        return generateObject({
          model: resolveModel(competitorModel),
          schema: competitorSchema,
          system: `Extract competitor information from the research below. Only include companies with REAL, verified domains. Return the root domain (e.g. "monday.com"), not full URLs. Do NOT include "${brandName}"${website ? ` (${website})` : ''} itself.`,
          prompt: research.text,
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
