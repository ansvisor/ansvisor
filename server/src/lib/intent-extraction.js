import { generateObject } from 'ai';
import { z } from 'zod';

const parsedMultiplier = parseFloat(process.env.AI_VOLUME_MULTIPLIER);
export const AI_VOLUME_MULTIPLIER = Number.isFinite(parsedMultiplier) ? parsedMultiplier : 0.15;

export const intentKeywordSchema = z.object({
  intent: z
    .enum([
      'comparison',
      'how-to',
      'what-is',
      'best-top',
      'vs-review',
      'recommendation',
      'problem-solving',
      'other',
    ])
    .describe('The primary search intent behind this prompt'),
  keywords: z
    .array(
      z
        .string()
        .describe(
          'A short Google head term — 1 to 3 words, category-level, measurable Google Ads volume',
        ),
    )
    .length(5)
    .describe(
      'Five broad, high-volume Google head terms that capture the category the prompt belongs to',
    ),
});

export const INTENT_SYSTEM_PROMPT = `You are a keyword research expert. Given an AI search prompt, you must:

1. Determine the primary search intent (comparison, how-to, what-is, best-top, vs-review, recommendation, or problem-solving).
2. Generate exactly 5 short HEAD keywords that a user would type into Google when researching the same category.

CRITICAL: Output HEAD terms, NOT long-tail variants. Google Ads only returns search volume for keywords with measurable demand — long-tail strings like "best portable motion control for travel 2026" return 0. Drop modifiers and surface the underlying noun phrases.

Rules:
- 1 to 3 words per keyword (strict). Never more than 4.
- Generic, category-level. No brand names, no years, no superlatives ("best", "top") unless they are part of the natural head term.
- Lowercase only.
- Each of the 5 keywords must capture a different angle of the same category.
- Think "what category does this prompt belong to?" → then list the broadest searchable terms in that category.

Example A — prompt: "What are the best tools for managing remote teams?"
- Intent: best-top
- Keywords: ["project management software", "team collaboration tools", "remote work software", "team management apps", "online collaboration platform"]

Example B — prompt: "best portable motion control for travel 2026"
- Intent: best-top
- Keywords: ["camera slider", "motion control camera", "video stabilizer", "camera dolly", "time lapse equipment"]

Notice: NO "best", NO "2026", NO "for travel". Strip modifiers, keep the category nouns.`;

/**
 * Extract search intent + 5 Google head keywords from an AI search prompt.
 * Single source of truth for the volumes routes — both `/analyze` and
 * `/analyze-batch` call this so the prompt/schema can never drift apart.
 *
 * @param {string} promptText - The AI search prompt to analyze.
 * @param {import('ai').LanguageModel} aiModel - A resolved AI SDK model (from `resolveModel`).
 * @returns {Promise<{ intent: string, keywords: string[] }>}
 */
export async function extractIntentKeywords(promptText, aiModel) {
  const { object } = await generateObject({
    model: aiModel,
    schema: intentKeywordSchema,
    system: INTENT_SYSTEM_PROMPT,
    prompt: `Analyze this AI search prompt and extract intent + 5 Google keywords:\n\n"${promptText}"`,
  });
  return { intent: object.intent, keywords: object.keywords };
}

// Intent-only schema — reuses the EXACT enum from intentKeywordSchema so the
// Query Fan-out "intent" column can never drift from the Insights one.
export const intentOnlySchema = z.object({
  intent: intentKeywordSchema.shape.intent,
});

export const INTENT_ONLY_SYSTEM_PROMPT = `You classify the primary search intent behind a short query into exactly one of these labels:

- comparison: weighing multiple options against each other
- how-to: accomplishing a task or process
- what-is: a definition or understanding a concept
- best-top: finding the best / top options in a category
- vs-review: a head-to-head or a review of a specific thing
- recommendation: asking for a suggestion or what to pick
- problem-solving: fixing an issue or troubleshooting
- other: none of the above fits

Return only the single best-fitting label.`;

/**
 * Classify the primary search intent of a query — intent only, no keyword
 * extraction and no volume work, so it's a cheaper call than
 * extractIntentKeywords. Shares the same intent enum (#333).
 *
 * @param {string} text - The sub-query / prompt to classify.
 * @param {import('ai').LanguageModel} aiModel - A resolved AI SDK model (from `resolveModel`).
 * @returns {Promise<string>} one of the intent enum values
 */
export async function classifyPromptIntent(text, aiModel) {
  const { object } = await generateObject({
    model: aiModel,
    schema: intentOnlySchema,
    system: INTENT_ONLY_SYSTEM_PROMPT,
    prompt: `Classify the search intent of this query:\n\n"${text}"`,
  });
  return object.intent;
}
