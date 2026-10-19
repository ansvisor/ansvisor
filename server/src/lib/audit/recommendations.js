/**
 * AI fix recommendations (Faz 3). After an audit scores the page, we send the
 * failing/warning signals that an LLM can genuinely help with to one batched
 * call and get back prioritized, page-specific recommendations — including
 * ready-to-paste drafts (a meta description, an H1, a BLUF paragraph, FAQ
 * Q&A + JSON-LD, suggested citations, etc.).
 *
 * Mechanical/config signals (add a video, enable HTTPS, fix viewport,
 * alt-text…) are excluded — their generic howToFix is already actionable and
 * the LLM can't add page-specific value.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../ai-provider.js';
import { signalsByKey } from './rubric.js';
import { withRetry } from '../retry.js';
import { logger } from '../logger.js';

const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

// Signals where a tailored recommendation / drafted content is worthwhile.
export const RECOMMENDABLE_SIGNALS = new Set([
  // structure (draftable)
  'h1-quality',
  'h2-coverage',
  'faq-schema',
  'json-ld-relevance',
  'open-graph',
  'meta-description',
  // authority
  'outbound-authority-links',
  'citation-density',
  'statistic-density',
  'quotations',
  'author-byline',
  // content
  'direct-answer',
  'bluf-answer',
  'query-coverage',
  'sub-query-coverage',
  'entity-coverage',
  'info-density',
  'mega-page-coverage',
  'definitions',
  'technical-terms',
  'readability',
  'length',
  // e-e-a-t
  'first-person',
  'case-study-evidence',
  'author-credentials',
  'byline-depth',
  'press-mentions',
]);

const recommendationsSchema = z.object({
  recommendations: z.array(
    z.object({
      signalKey: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
      recommendation: z.string().max(600),
      draft: z.string().max(2000).nullable(),
    }),
  ),
});

const SYSTEM_PROMPT = `You are an AEO/GEO content strategist. For each failing signal you are given, write ONE concrete recommendation tailored specifically to THIS page — never generic boilerplate, never restate the rule.

When the fix is content the user can paste, put the ready-to-use text in "draft":
- meta-description → a 130–155 char description
- h1-quality → a single improved H1
- bluf-answer / direct-answer → an opening paragraph that leads with the answer
- faq-schema → 3–5 Q&A pairs AND a valid FAQPage JSON-LD block
- definitions → the key terms defined inline
- outbound-authority-links / citation-density → specific authoritative sources to cite
- readability → a simplified rewrite of one representative paragraph (shorter sentences, plainer words)
- length → which specific sections to expand or trim (draft can be null)

When suggesting sources to cite (outbound-authority-links, citation-density, statistic-density), prefer the most recent, currently-authoritative references and do not present older material as if it were current. Never invent URLs or fabricate statistics/dates — only suggest sources you are confident exist.

Keep "recommendation" to 1–3 sentences. Set "draft" to null when the fix isn't a paste-able snippet. Prioritize by impact. Only return items you can make genuinely specific and useful.`;

/**
 * @param {import('./context.js').AuditContext} ctx
 * @param {{ results: Array<{key:string,status:string,evidence:object}>, queries?: string[] }} opts
 * @returns {Promise<Array<{ signalKey: string, label: string, category: string|null, priority: string, recommendation: string, draft: string|null }>>}
 */
export async function generateRecommendations(ctx, { results } = {}) {
  const failing = (results || []).filter(
    (r) => RECOMMENDABLE_SIGNALS.has(r.key) && (r.status === 'fail' || r.status === 'warn'),
  );
  if (failing.length === 0) return [];

  const modelString = process.env.AUDIT_LLM_MODEL || DEFAULT_MODEL;

  const issues = failing
    .map((r) => {
      const s = signalsByKey[r.key] ?? {};
      const finding = r.evidence?.reason ? ` | finding: ${r.evidence.reason}` : '';
      return `- ${r.key} [${r.status}, impact: ${s.impactTier ?? 'standard'}]: ${s.what ?? ''}${finding}`;
    })
    .join('\n');

  const pageText = ctx.text.slice(0, 6000);

  // Anchor the model to the real current date — without it, the LLM defaults to
  // its training-data sense of "now" and suggests stale (e.g. 2024) sources for
  // outbound-authority-links / citation-density.
  const today = new Date(ctx.now ?? Date.now()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  try {
    const { object } = await withRetry(
      () =>
        generateObject({
          model: resolveModel(modelString),
          schema: recommendationsSchema,
          system: SYSTEM_PROMPT,
          prompt: `Today's date is ${today}.

PAGE URL: ${ctx.url}

Improve THIS page for its own topic/intent (infer it from the content below). Never introduce subject matter the page isn't already about.

FAILING SIGNALS TO FIX:
${issues}

PAGE TEXT (truncated):
"""
${pageText}
"""

Return prioritized, page-specific recommendations.`,
        }),
      { label: 'recommendations' },
    );

    return (object.recommendations || [])
      .filter((r) => RECOMMENDABLE_SIGNALS.has(r.signalKey))
      .map((r) => ({
        signalKey: r.signalKey,
        label: signalsByKey[r.signalKey]?.label ?? r.signalKey,
        category: signalsByKey[r.signalKey]?.category ?? null,
        priority: r.priority,
        recommendation: r.recommendation,
        draft: r.draft || null,
      }));
  } catch (err) {
    logger.error({ err, model: modelString }, '[audit] recommendations failed');
    return [];
  }
}
