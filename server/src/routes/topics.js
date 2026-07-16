import { Router } from 'express';
import { generateText, generateObject } from 'ai';
import { z } from 'zod';
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
 * POST /api/topics/suggest
 * Body: { brandName, industry, description?, website?, language? }
 * Returns: { topics: [{ name }] }
 */
router.post('/suggest', async (req, res) => {
  try {
    const { brandName, industry, description, website, language } = req.body;
    const langName = getLanguageName(language);

    if (!brandName) {
      return res.status(400).json({ error: 'brandName is required' });
    }

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

    return res.json({ topics: object.topics });
  } catch (error) {
    req.log.error({ err: error }, 'topic suggestion error');
    return res.status(500).json({
      error: 'Failed to generate topic suggestions',
      details: error.message,
    });
  }
});

export default router;
