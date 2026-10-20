import { generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './ai-provider.js';
import { generationCostUsd } from './improve-cost.js';
import { getLanguageName } from './languages.js';
import { logger } from './logger.js';
import { enforceImproveQuota } from './plan-guard.js';

/**
 * The Content Editor's brief (CE-007, spec §10): Rebuild outline writes a
 * draft's goal, audience and outline from the sources the person kept in the
 * Sources tab (CE-008), each H2 answering one of the searches AI engines ran
 * (a fan-out) on a platform. It is metered from the organization's AI usage,
 * the monthly budget the Improve tab and the task writer draw from — not the
 * content brief quota, which stays with Opportunities' Generate Brief
 * (spec §3).
 */

/** The model, as the Improve tab's. */
export function contentBriefModelId() {
  return (
    process.env.IMPROVE_SUGGESTION_MODEL ||
    process.env.DEFAULT_SUGGESTION_MODEL ||
    'google/gemini-3-flash-preview'
  );
}

/** How long the model may take: the dashboard waits for it. */
const CALL_TIMEOUT_MS = 60_000;

/** What the Sources tab keeps, as the web sends it. */
export const rebuildSources = z.object({
  promptIds: z.array(z.guid()).max(100),
  fanouts: z
    .array(
      z.object({
        query: z.string().trim().min(1).max(300),
        platforms: z.array(z.string().trim().min(1).max(60)).max(12),
      }),
    )
    .max(40),
  pages: z
    .array(z.object({ url: z.string().trim().max(2048), kind: z.string().trim().max(30) }))
    .max(30),
  queries: z.array(z.string().trim().min(1).max(300)).max(20),
  /** The page's headings as written now, for a draft optimizing a page. */
  headings: z.array(z.string().trim().min(1).max(300)).max(30),
  /** The length the page type's rules ask for, in characters. */
  length: z.number().int().min(100).max(50_000),
});

const outlineSchema = z.object({
  goal: z.string().describe('What the page must achieve for the brand, in one sentence.'),
  audience: z.string().describe('Who the page is for, in one sentence.'),
  outline: z
    .array(
      z.object({
        heading: z.string().describe('The H2, worded as the answer a reader looks for.'),
        keyPoints: z.array(z.string()).max(5).describe('What the section must cover.'),
        fanout: z
          .string()
          .nullable()
          .describe('The AI search this H2 answers, copied exactly from the list, or null.'),
        platform: z
          .string()
          .nullable()
          .describe('The platform key that ran that search, from its list, or null.'),
      }),
    )
    .min(3)
    .max(10),
  keywords: z.array(z.string()).max(10),
});

const SYSTEM_PROMPT = `You are a senior content strategist for Answer Engine Optimization (AEO). You plan one web page so AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) cite it.

Rules:
- Plan an outline of H2 sections. Each H2 should answer one of the AI searches (fan-outs) listed, the most searched first, and name it exactly in "fanout" with one of its platform keys in "platform". An H2 that answers none has null for both.
- Cover the prompts listed: they are the questions the page must answer.
- Use only the facts given. Never invent numbers, prices, dates, names or claims; a key point that needs a fact says what to find out.
- When the page exists, keep its useful headings and improve them rather than starting over.
- Cited pages show what AI quotes today; plan to answer better than them, never to copy them.
- Write every field in the language asked for.`;

const norm = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Builds the brief: reads the draft and its brand, keeps the prompts that are
 * the brand's, charges the AI usage budget, asks the model, and saves the
 * brief on the draft. Throws with `.status` 404 for a draft outside the
 * brand, 422 with no sources to build from, PlanLimitError once the budget
 * is spent.
 */
export async function rebuildDraftBrief({ draftId, brandId, sources }) {
  const { data: draft, error: draftError } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brand_id, title, page_type, method, source_url')
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }

  const [brandRes, promptsRes] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('name, industry, description, organization_id, language')
      .eq('id', brandId)
      .single(),
    sources.promptIds.length
      ? supabaseAdmin
          .from('prompts')
          .select('id, text, topics!inner(brand_id)')
          .in('id', sources.promptIds)
          .eq('topics.brand_id', brandId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (brandRes.error) throw brandRes.error;
  if (promptsRes.error) throw promptsRes.error;
  const brand = brandRes.data;
  const prompts = (promptsRes.data ?? []).map((p) => p.text);

  if (!prompts.length && !sources.fanouts.length && !sources.queries.length) {
    throw Object.assign(new Error('No prompts, fan-outs or queries to build from'), {
      status: 422,
      code: 'no_sources',
    });
  }

  const modelId = contentBriefModelId();
  await enforceImproveQuota(brand.organization_id, modelId);

  const { object, usage } = await generateObject({
    model: resolveModel(modelId),
    schema: outlineSchema,
    system: SYSTEM_PROMPT,
    prompt: buildBriefPrompt({ brand, draft, prompts, sources }),
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  await recordUsage({ organizationId: brand.organization_id, draftId, modelId, usage });

  const brief = {
    goal: object.goal.trim(),
    audience: object.audience.trim(),
    outline: mapOutline(object.outline, sources.fanouts),
    keywords: [...new Set(object.keywords.map((k) => k.trim()).filter(Boolean))],
    origin: 'rebuild',
    builtAt: new Date().toISOString(),
    builtFrom: {
      prompts: prompts.length,
      fanouts: sources.fanouts.length,
      pages: sources.pages.length,
      queries: sources.queries.length,
    },
  };
  const { error: saveError } = await supabaseAdmin
    .from('content_drafts')
    .update({ brief })
    .eq('id', draftId);
  if (saveError) throw saveError;
  return brief;
}

/**
 * Keeps an H2's fan-out only when it is one the person kept, written as
 * listed, and its platform only when that search ran there.
 */
export function mapOutline(outline, fanouts) {
  const byQuery = new Map(fanouts.map((f) => [norm(f.query), f]));
  return outline.map((section) => {
    const fanout = section.fanout ? byQuery.get(norm(section.fanout)) : undefined;
    const platform =
      fanout && fanout.platforms.includes(section.platform)
        ? section.platform
        : (fanout?.platforms[0] ?? null);
    return {
      heading: section.heading.trim(),
      keyPoints: section.keyPoints.map((p) => p.trim()).filter(Boolean),
      fanout: fanout?.query ?? null,
      platform: fanout ? platform : null,
    };
  });
}

/** What the model is told: the brand, the page, and the sources kept. */
export function buildBriefPrompt({ brand, draft, prompts, sources }) {
  const list = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none');
  return `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
Description: ${brand?.description || 'N/A'}

Page: ${draft.title || 'Untitled'}
Page type: ${draft.page_type || 'not set'}
${draft.method === 'optimize' && draft.source_url ? `Existing page to improve: ${draft.source_url}` : 'A new page.'}
Length: about ${sources.length} characters.

Prompts the page must answer:
${list(prompts)}

AI searches (fan-outs) run while answering them, with the platform keys that ran each and the most searched first:
${list(sources.fanouts.map((f) => `"${f.query}" (${f.platforms.join(', ') || 'unknown'})`))}

Google searches people use (Search Console):
${list(sources.queries)}

Pages AI cites for these prompts today:
${list(sources.pages.map((p) => `${p.url} (${p.kind})`))}

${sources.headings.length ? `The page's headings now:\n${list(sources.headings)}\n\n` : ''}Write the brief in ${getLanguageName(brand?.language)}.`;
}

async function recordUsage({ organizationId, draftId, modelId, usage }) {
  const { error } = await supabaseAdmin.from('prompt_improve_usage').insert({
    organization_id: organizationId,
    content_draft_id: draftId,
    model: modelId,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    cost_usd: generationCostUsd(modelId, usage),
  });
  if (error) logger.error({ err: error, draftId }, '[content-brief] usage insert failed');
}
