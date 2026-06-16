/**
 * LLM-judged audit signals (Faz 2). The 13 rubric signals that can't be
 * measured by parsing alone — they need semantic judgment and, for some, a
 * target buyer query. We run them in a SINGLE structured-output call (one
 * model round-trip per audit, not one per signal) for cost + latency.
 *
 * Model is provider-flexible via resolveModel; default is a cheap Gemini Flash
 * (`AUDIT_LLM_MODEL`, e.g. google/gemini-3-flash-preview). Self-hosters can
 * point it at Claude/OpenAI. If the call fails the signals degrade to 'na' so
 * one bad LLM round-trip never sinks the deterministic audit.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../ai-provider.js';
import { signalsByKey } from './rubric.js';

const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

// The rubric signals judged by the model. brand-entity (Wikidata) and the
// already-deterministic signals are handled elsewhere.
export const LLM_SIGNAL_KEYS = [
  'direct-answer',
  'bluf-answer',
  'query-coverage',
  'sub-query-coverage',
  'entity-coverage',
  'info-density',
  'mega-page-coverage',
  'definitions',
  'technical-terms',
  'case-study-evidence',
  'author-credentials',
  'byline-depth',
  'press-mentions',
];

const verdictSchema = z.object({
  status: z.enum(['pass', 'warn', 'fail', 'na']),
  score: z.number().min(0).max(1).nullable(),
  reason: z.string().max(300),
});

const responseSchema = z.object(Object.fromEntries(LLM_SIGNAL_KEYS.map((k) => [k, verdictSchema])));

const SYSTEM_PROMPT = `You are an AEO/GEO content auditor. You judge whether a web page satisfies scoring signals that AI answer engines (ChatGPT, Gemini, Perplexity, Google AI Overviews) use when deciding what to cite.

CRITICAL: Evaluate the page ENTIRELY ON ITS OWN TERMS. First infer, from the page's own title and content, what topic/query this specific page is trying to serve. Judge every signal against THAT inferred intent. Never assume the page should be about some other topic, and never import outside subject matter.

Be strict and evidence-based. For each signal return:
- status: "pass" (clearly satisfied), "warn" (partially), "fail" (not satisfied), or "na" (genuinely not applicable to this page type).
- score: 0..1 (1 = fully satisfied), or null when status is "na".
- reason: ONE short sentence citing what you saw on THIS page (or its absence). No markdown.

Judge only from the provided page text and facts. Do not assume content you cannot see.`;

function buildPrompt(ctx) {
  const defs = LLM_SIGNAL_KEYS.map((k) => {
    const s = signalsByKey[k] ?? {};
    return `- ${k}: ${s.what ?? ''}`;
  }).join('\n');

  const pageText = ctx.text.slice(0, 8000);

  return `PAGE URL: ${ctx.url}
PAGE WORD COUNT: ${ctx.wordCount}

First, infer this page's own primary topic/query from its title and content. Then judge each signal against that inferred intent — the query-related signals (direct-answer, query-coverage, sub-query-coverage, entity-coverage) are about how well the page serves ITS OWN topic, not any external one.

SIGNALS TO JUDGE:
${defs}

PAGE TEXT (truncated):
"""
${pageText}
"""

Return a verdict for every signal key.`;
}

/**
 * @param {import('./context.js').AuditContext} ctx
 * @returns {Promise<Array<{ key: string, status: string, score: number|null, evidence: object }>>}
 */
export async function evaluateLlmSignals(ctx) {
  const modelString = process.env.AUDIT_LLM_MODEL || DEFAULT_MODEL;

  try {
    const { object } = await generateObject({
      model: resolveModel(modelString),
      schema: responseSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(ctx),
    });

    return LLM_SIGNAL_KEYS.map((key) => {
      const v = object[key];
      if (!v) {
        return { key, status: 'na', score: null, evidence: { reason: 'no verdict returned' } };
      }
      return {
        key,
        status: v.status,
        score: v.status === 'na' ? null : v.score,
        evidence: { reason: v.reason, model: modelString },
      };
    });
  } catch (err) {
    console.error('[audit] LLM signals failed:', err.message, { model: modelString });
    // Degrade gracefully — deterministic signals still score the page.
    return LLM_SIGNAL_KEYS.map((key) => ({
      key,
      status: 'na',
      score: null,
      evidence: { error: 'LLM evaluation unavailable' },
    }));
  }
}
